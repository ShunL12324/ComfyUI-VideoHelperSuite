import { app } from "../../../scripts/app.js";

/*
 * Video-editor style trim bar, mounted directly onto the video preview of
 * VHS_LoadVideoTrim.
 *
 * This is a DOM overlay injected into the preview widget's own container rather
 * than a LiteGraph canvas widget, for two reasons:
 *   1. it is what a trim bar should feel like -- it sits under the video with two
 *      draggable end handles, like any editor;
 *   2. VHS's onNodeCreated rebuilds node.widgets and drops every widget with no
 *      matching INPUT_TYPES entry, so a pure-UI LiteGraph widget gets silently
 *      filtered straight back out.
 *
 * Everything else is reused rather than reimplemented: /vhs/queryvideo already
 * reports the source duration/fps as node.video_query, and /vhs/viewvideo already
 * re-encodes the preview honouring start_time + frame_load_cap. Dragging writes
 * the node's own start_time / duration widgets and fires their callbacks, which
 * is exactly what typing into them does.
 *
 * The widgets are deliberately left as widgets and not converted to inputs: VHS
 * binds preview refresh by iterating node.widgets, so a widget turned into a
 * linked input drops out of that loop and the preview goes stale.
 */

const CSS = `
.vhs-trim { padding: 4px 2px 2px; user-select: none; font: 11px sans-serif; }
.vhs-trim-track {
  position: relative; height: 26px; border-radius: 4px; cursor: pointer;
  background: repeating-linear-gradient(90deg,#242424 0 1px,#1b1b1b 1px 14px);
  border: 1px solid #0e0e0e; box-shadow: inset 0 1px 3px rgba(0,0,0,.6);
}
.vhs-trim-dim { position: absolute; top: 0; bottom: 0; background: rgba(0,0,0,.55); pointer-events: none; }
.vhs-trim-sel {
  position: absolute; top: 0; bottom: 0; background: rgba(63,120,158,.34);
  border-top: 2px solid #4d90bd; border-bottom: 2px solid #4d90bd; cursor: grab;
}
.vhs-trim-sel:active { cursor: grabbing; }
.vhs-trim-h {
  position: absolute; top: -2px; bottom: -2px; width: 11px; border-radius: 3px;
  background: linear-gradient(#f0ae3d,#d2891f); border: 1px solid #8a5a12;
  cursor: ew-resize; box-shadow: 0 1px 3px rgba(0,0,0,.5);
}
.vhs-trim-h::after {
  content: ""; position: absolute; left: 4px; right: 4px; top: 7px; bottom: 7px;
  border-left: 1px solid rgba(0,0,0,.45); border-right: 1px solid rgba(0,0,0,.45);
}
/* straddle the boundary rather than sitting outside it: with left:0% / left:100%
   an un-straddled handle lands completely off the end of the track and cannot be
   grabbed, which is exactly the state a fresh full-range selection starts in. */
.vhs-trim-h-l, .vhs-trim-h-r { transform: translateX(-50%); }
.vhs-trim-lab { display: flex; justify-content: space-between; color: #b9b9b9; padding: 3px 1px 0; }
.vhs-trim-lab b { color: #e8e8e8; font-weight: 600; }
.vhs-trim-hint { color: #777; }
`;

function injectCSS() {
    if (document.getElementById("vhs-trim-css")) return;
    const el = document.createElement("style");
    el.id = "vhs-trim-css";
    el.textContent = CSS;
    document.head.appendChild(el);
}

function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : `${s.toFixed(2)}s`;
}

const getW = (node, name) => node.widgets?.find((w) => w.name === name);

function srcInfo(node) {
    const s = node.video_query?.source;
    if (!s?.duration) return null;
    const forced = getW(node, "force_rate")?.value;
    return { total: s.duration, fps: (forced && forced > 0) ? forced : (s.fps || 0) };
}

function mount(node) {
    const pv = getW(node, "videopreview");
    const host = pv?.parentEl;
    if (!host || host.querySelector(".vhs-trim")) return false;
    injectCSS();

    const wrap = document.createElement("div");
    wrap.className = "vhs-trim";
    wrap.innerHTML =
        '<div class="vhs-trim-track">' +
        '<div class="vhs-trim-dim vhs-trim-dim-l"></div>' +
        '<div class="vhs-trim-dim vhs-trim-dim-r"></div>' +
        '<div class="vhs-trim-sel"></div>' +
        '<div class="vhs-trim-h vhs-trim-h-l"></div>' +
        '<div class="vhs-trim-h vhs-trim-h-r"></div>' +
        "</div>" +
        '<div class="vhs-trim-lab"><span class="a"></span><span class="b"></span><span class="c"></span></div>';
    host.appendChild(wrap);

    const track = wrap.querySelector(".vhs-trim-track");
    const sel = wrap.querySelector(".vhs-trim-sel");
    const hL = wrap.querySelector(".vhs-trim-h-l");
    const hR = wrap.querySelector(".vhs-trim-h-r");
    const dimL = wrap.querySelector(".vhs-trim-dim-l");
    const dimR = wrap.querySelector(".vhs-trim-dim-r");
    const labA = wrap.querySelector(".a");
    const labB = wrap.querySelector(".b");
    const labC = wrap.querySelector(".c");

    // live drag values; committed to the widgets on release
    let st = 0, du = 0;

    function read() {
        st = getW(node, "start_time")?.value || 0;
        du = getW(node, "duration")?.value || 0;
    }

    function render() {
        const info = srcInfo(node);
        if (!info) {
            labA.textContent = "";
            labB.innerHTML = '<span class="vhs-trim-hint">choose a video to enable trimming</span>';
            labC.textContent = "";
            sel.style.left = "0%"; sel.style.width = "100%";
            hL.style.left = "0%"; hR.style.left = "100%";
            dimL.style.width = "0"; dimR.style.left = "100%"; dimR.style.width = "0";
            return;
        }
        const total = info.total;
        const fps = info.fps;
        const shown = du > 0 ? du : total - st;
        const p0 = Math.max(0, Math.min(1, st / total));
        const p1 = Math.max(p0, Math.min(1, (st + shown) / total));
        sel.style.left = p0 * 100 + "%";
        sel.style.width = (p1 - p0) * 100 + "%";
        hL.style.left = p0 * 100 + "%";
        hR.style.left = p1 * 100 + "%";
        dimL.style.left = "0"; dimL.style.width = p0 * 100 + "%";
        dimR.style.left = p1 * 100 + "%"; dimR.style.width = (1 - p1) * 100 + "%";
        const frames = fps ? Math.round(shown * fps) : 0;
        labA.innerHTML = "in <b>" + fmt(st) + "</b>";
        labB.innerHTML = du > 0
            ? "<b>" + fmt(shown) + "</b> &nbsp;" + frames + " f"
            : '<span class="vhs-trim-hint">to end &nbsp;' + fmt(shown) + " &nbsp;" + frames + " f</span>";
        labC.innerHTML = "out <b>" + fmt(st + shown) + "</b>";
    }

    /** push st/du into the node's widgets. fire=true also refreshes the preview. */
    function commit(fire) {
        const info = srcInfo(node);
        if (!info) return;
        const sw = getW(node, "start_time");
        const dw = getW(node, "duration");
        const sv = Math.round(st * 1000) / 1000;
        const dv = Math.round(du * 1000) / 1000;
        if (sw) sw.value = sv;
        if (dw) dw.value = dv;
        if (fire) {
            sw?.callback?.(sv);
            dw?.callback?.(dv);
            node.updateParameters?.({
                start_time: sv,
                frame_load_cap: info.fps && dv > 0 ? Math.round(dv * info.fps) : 0,
            });
        }
        node.setDirtyCanvas(true, false);
    }

    function tAt(clientX) {
        const info = srcInfo(node);
        const r = track.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
        return p * info.total;
    }

    function beginDrag(mode, ev) {
        const info = srcInfo(node);
        if (!info) return;
        ev.preventDefault();
        ev.stopPropagation();
        read();
        const shown0 = du > 0 ? du : info.total - st;
        const grab = tAt(ev.clientX) - st;
        const MIN = Math.max(0.02, info.fps ? 1 / info.fps : 0.02);

        const move = (e) => {
            const t = tAt(e.clientX);
            if (mode === "l") {
                const out = st + (du > 0 ? du : info.total - st);
                const ns = Math.max(0, Math.min(t, out - MIN));
                du = out - ns;          // dragging the in-point pins the out-point
                st = ns;
            } else if (mode === "r") {
                du = Math.max(MIN, Math.min(t, info.total) - st);
            } else {
                st = Math.max(0, Math.min(t - grab, info.total - shown0));
                du = shown0;
            }
            commit(false);
            render();
        };
        const up = () => {
            // the capture flag MUST match addEventListener's or the listener is never
            // removed: every drag would then leave a live handler behind and the stale
            // one keeps rewriting the values on the next drag.
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            commit(true);               // one preview refresh, on release
            render();
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
    }

    // ComfyUI's canvas layer calls stopPropagation on pointerdown during the CAPTURE
    // phase, before the event can reach a DOM widget's children -- verified by probing:
    // window-capture and document-capture both see it with the handle as target, and
    // nothing below document ever fires. (VHS's own <video controls> is unaffected only
    // because native media controls are handled by the browser, not by JS listeners.)
    // So bind once on document in the capture phase and route by target instead.
    const onDown = (e) => {
        if (!wrap.isConnected) {
            document.removeEventListener("pointerdown", onDown, true);
            return;
        }
        const t = e.target;
        if (!wrap.contains(t)) return;
        let mode = null;
        if (t === hL) mode = "l";
        else if (t === hR) mode = "r";
        else if (t === sel) mode = "m";
        else if (t === track) mode = "seek";
        else return;
        e.preventDefault();
        e.stopPropagation();          // keep the canvas from dragging the node too
        if (mode !== "seek") { beginDrag(mode, e); return; }
        const info = srcInfo(node);
        if (!info) return;
        read();
        const shown = du > 0 ? du : info.total - st;
        st = Math.max(0, Math.min(tAt(e.clientX) - shown / 2, info.total - shown));
        du = shown;
        commit(true);
        render();
    };
    document.addEventListener("pointerdown", onDown, true);

    // keep in sync when the values are typed in instead of dragged
    for (const nm of ["start_time", "duration", "force_rate"]) {
        const w = getW(node, nm);
        if (!w) continue;
        const orig = w.callback;
        w.callback = function (...a) {
            const r = orig ? orig.apply(this, a) : undefined;
            read();
            render();
            return r;
        };
    }

    node.__vhsTrimRender = () => { read(); render(); };
    read();
    render();
    return true;
}

/** The preview widget and video_query only exist after VHS has probed the file. */
function attach(node) {
    let tries = 0;
    const tick = () => {
        if (mount(node)) {
            let n2 = 0;
            const poll = setInterval(() => {
                node.__vhsTrimRender && node.__vhsTrimRender();
                if (node.video_query?.source?.duration || ++n2 > 80) clearInterval(poll);
            }, 250);
            return;
        }
        if (++tries < 80) setTimeout(tick, 250);
    };
    tick();
}

app.registerExtension({
    name: "VideoHelperSuite.TrimTimeline",
    async nodeCreated(node) {
        if (node && node.comfyClass === "VHS_LoadVideoTrim") attach(node);
    },
});
