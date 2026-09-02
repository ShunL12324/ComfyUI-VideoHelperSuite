import { app } from "../../../scripts/app.js";

/*
 * Draggable trim timeline for VHS_LoadVideoTrim.
 *
 * The server side already does everything we need: /vhs/viewvideo re-encodes a
 * preview honouring start_time + frame_load_cap, and /vhs/queryvideo hands back
 * the source duration/fps as node.video_query. All that was missing upstream was
 * a way to pick the range with the mouse instead of typing numbers, so this file
 * adds one widget and touches nothing else.
 *
 * The node's own widgets stay plain widgets (NOT converted to inputs) -- that is
 * deliberate. VHS binds its preview refresh by iterating node.widgets, so a
 * widget converted to a linked input drops out of that loop and the preview goes
 * stale. Dragging here writes the widget values and fires their callbacks, which
 * is exactly what VHS's own numeric entry does.
 */

const H = 54;              // widget height
const PAD = 8;             // horizontal padding inside the widget
const TRACK_H = 16;        // height of the scrub track
const HANDLE_W = 7;        // grab handle width
const HIT = 9;             // grab tolerance in px

const C = {
    track:      "#1c1c1c",
    trackBord:  "#0f0f0f",
    region:     "#3f789e",
    regionHov:  "#5a9cc4",
    handle:     "#e8a02a",
    text:       "#cfcfcf",
    textDim:    "#8a8a8a",
    warn:       "#c05a5a",
};

function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : `${s.toFixed(2)}s`;
}

function getW(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

/** Effective rate that frame_load_cap is counted in (post force_rate). */
function effRate(node) {
    const fr = getW(node, "force_rate")?.value;
    if (fr && fr > 0) return fr;
    return node.video_query?.source?.fps || 0;
}

function sourceDuration(node) {
    return node.video_query?.source?.duration || 0;
}

/** Write widget values, fire their callbacks, and refresh the preview params. */
function commit(node, start, dur) {
    const total = sourceDuration(node);
    start = Math.max(0, Math.min(start, total));
    dur = Math.max(0, Math.min(dur, total - start));

    const sw = getW(node, "start_time");
    const dw = getW(node, "duration");
    if (sw) { sw.value = Math.round(start * 1000) / 1000; sw.callback?.(sw.value); }
    if (dw) { dw.value = Math.round(dur * 1000) / 1000; dw.callback?.(dw.value); }

    // The preview endpoint speaks start_time (seconds) + frame_load_cap (frames).
    const rate = effRate(node);
    node.updateParameters?.({
        start_time: sw ? sw.value : 0,
        frame_load_cap: rate && dur > 0 ? Math.round(dur * rate) : 0,
    });
    node.setDirtyCanvas(true, false);
}

function addTimeline(node) {
    if (getW(node, "trim_timeline")) return;

    const w = {
        name: "trim_timeline",
        type: "VHS.TRIMTIMELINE",
        value: null,
        // transient drag state
        _drag: null,
        _hover: null,

        computeSize() { return [0, H]; },

        // no serialisation: the real state lives in start_time / duration
        serialize: false,

        draw(ctx, n, width, y) {
            const total = sourceDuration(n);
            const x0 = PAD;
            const x1 = width - PAD;
            const tw = Math.max(1, x1 - x0);
            const ty = y + 20;

            ctx.save();
            // track
            ctx.fillStyle = C.track;
            ctx.strokeStyle = C.trackBord;
            ctx.beginPath();
            ctx.roundRect(x0, ty, tw, TRACK_H, 3);
            ctx.fill();
            ctx.stroke();

            if (!total) {
                ctx.fillStyle = C.textDim;
                ctx.font = "11px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("pick a video to enable the timeline", x0 + tw / 2, ty + 12);
                ctx.restore();
                return;
            }

            const start = getW(n, "start_time")?.value || 0;
            let dur = getW(n, "duration")?.value || 0;
            const shownDur = dur > 0 ? dur : total - start;   // 0 == run to the end

            const sx = x0 + (start / total) * tw;
            const ex = x0 + Math.min(1, (start + shownDur) / total) * tw;

            // selected region
            ctx.fillStyle = this._hover === "body" ? C.regionHov : C.region;
            ctx.beginPath();
            ctx.roundRect(sx, ty, Math.max(2, ex - sx), TRACK_H, 3);
            ctx.fill();

            // handles
            ctx.fillStyle = C.handle;
            for (const [hx, id] of [[sx, "start"], [ex, "end"]]) {
                ctx.globalAlpha = this._hover === id || this._drag === id ? 1 : 0.85;
                ctx.beginPath();
                ctx.roundRect(hx - HANDLE_W / 2, ty - 3, HANDLE_W, TRACK_H + 6, 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // labels
            ctx.font = "11px sans-serif";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = C.text;
            ctx.textAlign = "left";
            ctx.fillText(fmtTime(start), x0, y + 13);
            ctx.textAlign = "center";
            const rate = effRate(n);
            const frames = rate ? Math.round(shownDur * rate) : 0;
            const mid = dur > 0
                ? `${fmtTime(shownDur)}  (${frames} f @ ${rate || "?"}fps)`
                : `to end  (${fmtTime(shownDur)}, ${frames} f)`;
            ctx.fillStyle = dur > 0 ? C.text : C.textDim;
            ctx.fillText(mid, x0 + tw / 2, y + 13);
            ctx.textAlign = "right";
            ctx.fillStyle = C.text;
            ctx.fillText(fmtTime(total), x1, y + 13);
            ctx.restore();
        },

        mouse(event, pos, n) {
            const total = sourceDuration(n);
            if (!total) return false;
            const width = n.size[0];
            const x0 = PAD;
            const x1 = width - PAD;
            const tw = Math.max(1, x1 - x0);
            const toT = (px) => Math.max(0, Math.min(total, ((px - x0) / tw) * total));

            const start = getW(n, "start_time")?.value || 0;
            let dur = getW(n, "duration")?.value || 0;
            const shownDur = dur > 0 ? dur : total - start;
            const sx = x0 + (start / total) * tw;
            const ex = x0 + Math.min(1, (start + shownDur) / total) * tw;

            if (event.type === "pointerdown") {
                if (Math.abs(pos[0] - sx) <= HIT) this._drag = "start";
                else if (Math.abs(pos[0] - ex) <= HIT) this._drag = "end";
                else if (pos[0] > sx && pos[0] < ex) {
                    this._drag = "body";
                    this._grab = toT(pos[0]) - start;
                } else {
                    // click on empty track: move the window there, keep its length
                    this._drag = "body";
                    this._grab = shownDur / 2;
                    commit(n, toT(pos[0]) - this._grab, dur);
                }
                return true;
            }
            if (event.type === "pointermove") {
                if (!this._drag) {
                    this._hover = Math.abs(pos[0] - sx) <= HIT ? "start"
                        : Math.abs(pos[0] - ex) <= HIT ? "end"
                            : (pos[0] > sx && pos[0] < ex) ? "body" : null;
                    return false;
                }
                const t = toT(pos[0]);
                if (this._drag === "start") {
                    const end = start + shownDur;
                    const ns = Math.min(t, end - 0.02);
                    commit(n, ns, dur > 0 ? end - ns : 0);
                } else if (this._drag === "end") {
                    commit(n, start, Math.max(0.02, t - start));
                } else {
                    commit(n, t - this._grab, dur);
                }
                return true;
            }
            if (event.type === "pointerup") {
                this._drag = null;
                return true;
            }
            return false;
        },
    };

    node.widgets.push(w);
    // keep the timeline live as soon as VHS finishes probing the file
    const pv = getW(node, "videopreview");
    if (pv) {
        const orig = pv.callback;
        pv.callback = function (...a) {
            const r = orig?.apply(this, a);
            setTimeout(() => node.setDirtyCanvas(true, false), 250);
            return r;
        };
    }
}

app.registerExtension({
    name: "VideoHelperSuite.TrimTimeline",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "VHS_LoadVideoTrim") return;
        const orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = orig?.apply(this, arguments);
            addTimeline(this);
            this.setSize(this.computeSize());
            return r;
        };
    },
});
