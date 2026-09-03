import { app } from "../../../scripts/app.js";

/*
 * Video-editor style controls mounted directly onto the video preview of
 * VHS_LoadVideoTrim:
 *   - a hover-only playback overlay on the video itself (play/pause, +-5s),
 *     iOS-style: invisible until the pointer is over the video, then fades in;
 *   - a full-width scrub bar + time label below the video (always visible);
 *   - a trim bar below that: draggable in/out handles selecting
 *     start_time/duration (seconds).
 *
 * These are DOM overlays injected into the preview widget's own container
 * rather than LiteGraph canvas widgets, for two reasons:
 *   1. it's what these controls should feel like -- overlaying/sitting under
 *      the video, like any editor or native player;
 *   2. VHS's onNodeCreated rebuilds node.widgets and drops every widget with
 *      no matching INPUT_TYPES entry, so a pure-UI LiteGraph widget gets
 *      silently filtered straight back out.
 *
 * Everything reused rather than reimplemented: /vhs/queryvideo already
 * reports the source duration/fps as node.video_query, /vhs/viewvideo
 * already re-encodes the preview honouring start_time + frame_load_cap, and
 * the preview's own <video> element (previewWidget.videoEl) is what the
 * playback bar drives directly -- native controls are off (VHS sets
 * `videoEl.controls = false`), so there is otherwise no way to play/seek it.
 *
 * The start_time/duration widgets are deliberately left as widgets and not
 * converted to inputs: VHS binds preview refresh by iterating node.widgets,
 * so a widget turned into a linked input drops out of that loop and the
 * preview goes stale.
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

.vhs-scrubwrap { padding: 4px 2px 0; user-select: none; font: 11px sans-serif; }
.vhs-scrubwrap .vhs-ctl-time {
  display: block; margin-bottom: 3px; color: #b9b9b9; font-variant-numeric: tabular-nums;
}
.vhs-ctl-scrub {
  position: relative; width: 100%; height: 10px; border-radius: 5px; cursor: pointer;
  background: #1c1c1c; border: 1px solid #0e0e0e; box-shadow: inset 0 1px 2px rgba(0,0,0,.6);
  box-sizing: border-box;
}
.vhs-ctl-fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0%; border-radius: 5px; background: rgba(77,144,189,.55); pointer-events: none; }
.vhs-ctl-head {
  position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%;
  background: linear-gradient(#f0ae3d,#d2891f); border: 1px solid #8a5a12;
  transform: translate(-50%,-50%); box-shadow: 0 1px 2px rgba(0,0,0,.5);
}

/* Hover-only playback overlay on the video itself (iOS-style). Always present in
   the hit-test tree (pointer-events stays auto) so :hover has a stable target and
   doesn't flicker; only opacity toggles. A real mouse always hovers before it can
   click, so there is no "invisible button catches an accidental click" case in
   practice for this desktop/canvas app. */
.vhs-play-overlay {
  position: absolute; left: 0; right: 0; top: 0;
  display: flex; align-items: center; justify-content: center; gap: 18px;
  background: radial-gradient(ellipse at center, rgba(0,0,0,.30) 0%, rgba(0,0,0,.06) 55%, rgba(0,0,0,0) 72%);
  opacity: 0; transition: opacity .15s ease; user-select: none;
}
.vhs-play-overlay:hover { opacity: 1; }
.vhs-ov-btn {
  display: flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 50%;
  background: rgba(20,20,20,.6); border: 1px solid rgba(255,255,255,.25);
  color: #fff; font-size: 12px; cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,.45);
}
.vhs-ov-btn:hover { background: rgba(45,45,45,.8); }
.vhs-ov-btn.play { width: 50px; height: 50px; font-size: 17px; }
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

function fmtClock(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t - m * 60);
    return m + ":" + String(s).padStart(2, "0");
}

const getW = (node, name) => node.widgets?.find((w) => w.name === name);

/**
 * VHS's "Advanced Previews" transcode endpoint (/vhs/viewvideo, the DEFAULT for an
 * input node like this one) pipes a live ffmpeg re-encode over the response with no
 * `Accept-Ranges`/`Content-Range` support. Confirmed empirically: the browser reports
 * readyState=4 and a full buffered range (it happily downloads the whole chunked
 * stream sequentially), but writing videoEl.currentTime silently snaps back to ~0
 * instead of landing anywhere near the requested time -- the resource is not actually
 * seekable, regardless of what buffered/readyState claim.
 * VHS's OTHER path (/view, used when Advanced Previews = 'Never') serves the raw
 * uploaded file through ComfyUI's normal static-file endpoint: confirmed 206 Partial
 * Content + Accept-Ranges: bytes, and seeking lands exactly on the requested time.
 * A scrub bar is the whole point of this node, so it always wants the raw/seekable
 * source regardless of the user's global Advanced Previews setting -- the trim bar
 * communicates the selected range independently of whatever is actually playing, so
 * nothing is lost by not showing the rate-adjusted transcode here.
 * Implemented as a property override on videoEl.src (rather than trying to intercept
 * VHS's own decision logic in updateSource(), which re-reads the global setting
 * internally) so every future preview refresh is covered, not just the current one.
 */
function forceRawPreview(videoEl) {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(videoEl, 'src', {
        configurable: true,
        get() { return desc.get.call(this); },
        set(v) {
            try {
                const u = new URL(v, location.href);
                if (u.pathname.endsWith('/vhs/viewvideo')) {
                    u.pathname = u.pathname.replace('/vhs/viewvideo', '/view');
                    for (const k of ['start_time', 'skip_first_frames', 'frame_load_cap',
                                     'force_size', 'deadline', 'select_every_nth']) {
                        u.searchParams.delete(k);
                    }
                    v = u.toString();
                }
            } catch (e) { /* not a parseable URL (e.g. ""); leave it alone */ }
            desc.set.call(this, v);
        },
    });
}

/** VHS's own fitHeight() (web/js/VHS.core.js) is private/unexported; same logic. */
function fitNodeHeight(node) {
    if (!node.graph) return;
    const sz = node.computeSize([node.size[0], node.size[1]]);
    node.setSize([node.size[0], sz[1]]);
    node.graph.setDirtyCanvas(true);
}

function srcInfo(node) {
    const s = node.video_query?.source;
    if (!s?.duration) return null;
    const forced = getW(node, "force_rate")?.value;
    return { total: s.duration, fps: (forced && forced > 0) ? forced : (s.fps || 0) };
}

/**
 * Playback controls: a hover-only overlay on the video (play/pause, +-5s) plus an
 * always-visible full-width scrub row below it. Both drive the preview's own <video>
 * directly.
 */
function mountPlayback(node, host, scrubRow, videoEl) {
    const overlay = document.createElement("div");
    overlay.className = "vhs-play-overlay";
    overlay.innerHTML =
        '<div class="vhs-ov-btn back5" title="-5s">-5</div>' +
        '<div class="vhs-ov-btn play" title="play/pause">&#9654;</div>' +
        '<div class="vhs-ov-btn fwd5" title="+5s">+5</div>';
    host.appendChild(overlay);

    scrubRow.innerHTML =
        '<span class="vhs-ctl-time">0:00 / 0:00</span>' +
        '<div class="vhs-ctl-scrub"><div class="vhs-ctl-fill"></div><div class="vhs-ctl-head"></div></div>';

    const btnBack = overlay.querySelector(".back5");
    const btnPlay = overlay.querySelector(".play");
    const btnFwd = overlay.querySelector(".fwd5");
    const scrub = scrubRow.querySelector(".vhs-ctl-scrub");
    const fill = scrubRow.querySelector(".vhs-ctl-fill");
    const head = scrubRow.querySelector(".vhs-ctl-head");
    const time = scrubRow.querySelector(".vhs-ctl-time");

    // keep the overlay's hit-test area matched to the video's own rendered size
    // (clientHeight, not getBoundingClientRect -- both this and videoEl live under
    // the same canvas-zoom transform, if any, so their LOCAL CSS sizes already agree
    // without needing a scale conversion, unlike a cross-space comparison).
    const ro = new ResizeObserver(() => {
        if (!overlay.isConnected) { ro.disconnect(); return; }
        overlay.style.height = videoEl.clientHeight + "px";
    });
    ro.observe(videoEl);
    overlay.style.height = videoEl.clientHeight + "px";

    let rafId = null;
    let dragging = false;
    let wasPlayingBeforeDrag = false;

    function updateUI() {
        const d = videoEl.duration;
        const cur = videoEl.currentTime || 0;
        const pct = isFinite(d) && d > 0 ? Math.max(0, Math.min(1, cur / d)) : 0;
        fill.style.width = pct * 100 + "%";
        head.style.left = pct * 100 + "%";
        time.textContent = fmtClock(cur) + " / " + fmtClock(isFinite(d) ? d : 0);
        btnPlay.innerHTML = videoEl.paused ? "&#9654;" : "&#10074;&#10074;";
    }

    function loop() {
        updateUI();
        if (!videoEl.paused && !videoEl.ended && !dragging) {
            rafId = requestAnimationFrame(loop);
        } else {
            rafId = null;
        }
    }
    function kickLoop() {
        if (rafId == null && !dragging) rafId = requestAnimationFrame(loop);
    }

    videoEl.addEventListener("play", kickLoop);
    videoEl.addEventListener("pause", updateUI);
    videoEl.addEventListener("seeked", updateUI);
    videoEl.addEventListener("loadedmetadata", updateUI);
    videoEl.addEventListener("emptied", updateUI);
    if (!videoEl.paused) kickLoop();
    updateUI();

    // videoEl has loop=true (set by VHS's addVideoPreview). Confirmed empirically:
    // seeking to EXACTLY `duration` on a looping video makes the browser treat it as
    // "reached the end" and immediately wrap back to ~0 -- so every clamp against the
    // end must stay a hair short of it, or "+5s"/dragging to the far right silently
    // lands back at the start instead of near the end.
    const SEEK_EPS = 0.05;
    function clampSeek(t, d) {
        if (!isFinite(d) || d <= 0) return Math.max(0, t);
        return Math.max(0, Math.min(t, d - SEEK_EPS));
    }

    function timeAt(clientX) {
        const d = videoEl.duration;
        if (!isFinite(d) || d <= 0) return 0;
        const r = scrub.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
        return clampSeek(p * d, d);
    }

    return {
        onDown(e, target) {
            if (target === btnPlay) {
                e.preventDefault(); e.stopPropagation();
                if (videoEl.paused) videoEl.play().catch(() => {}); else videoEl.pause();
                updateUI();
                return true;
            }
            if (target === btnBack || target === btnFwd) {
                e.preventDefault(); e.stopPropagation();
                const delta = target === btnBack ? -5 : 5;
                videoEl.currentTime = clampSeek((videoEl.currentTime || 0) + delta, videoEl.duration);
                updateUI();
                return true;
            }
            if (target === scrub || target === fill || target === head) {
                e.preventDefault(); e.stopPropagation();
                // don't fight the seek with active playback -- follow the pointer
                // while dragging, then resume only if it was actually playing.
                dragging = true;
                wasPlayingBeforeDrag = !videoEl.paused;
                if (wasPlayingBeforeDrag) videoEl.pause();
                videoEl.currentTime = timeAt(e.clientX);
                updateUI();
                const move = (ev) => {
                    videoEl.currentTime = timeAt(ev.clientX);
                    updateUI();
                };
                const up = () => {
                    dragging = false;
                    window.removeEventListener("pointermove", move, true);
                    window.removeEventListener("pointerup", up, true);
                    if (wasPlayingBeforeDrag) videoEl.play().catch(() => {});
                    updateUI();
                };
                window.addEventListener("pointermove", move, true);
                window.addEventListener("pointerup", up, true);
                return true;
            }
            return false;
        },
    };
}

/** Trim bar: draggable in/out handles selecting start_time/duration (seconds). */
function mountTrim(node, panel) {
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
    panel.appendChild(wrap);

    const track = wrap.querySelector(".vhs-trim-track");
    const sel = wrap.querySelector(".vhs-trim-sel");
    const hL = wrap.querySelector(".vhs-trim-h-l");
    const hR = wrap.querySelector(".vhs-trim-h-r");
    const dimL = wrap.querySelector(".vhs-trim-dim-l");
    const dimR = wrap.querySelector(".vhs-trim-dim-r");
    const labA = wrap.querySelector(".a");
    const labB = wrap.querySelector(".b");
    const labC = wrap.querySelector(".c");

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
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            commit(true);
            render();
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
    }

    // reset when a DIFFERENT video is selected/uploaded -- see guardVideoChanges()
    // below for why this hook waits before treating a change as "real".
    function resetForNewVideo() {
        st = 0; du = 0;
        const sw = getW(node, "start_time");
        const dw = getW(node, "duration");
        if (sw) sw.value = 0;
        if (dw) dw.value = 0;
        node.updateParameters?.({ start_time: 0, frame_load_cap: 0 });
        render();
        // video_query for the new file lands asynchronously (a queryvideo
        // fetch); keep the displayed total in sync once it arrives.
        let tries = 0;
        const poll = setInterval(() => {
            render();
            if (node.video_query?.source?.duration || ++tries > 80) clearInterval(poll);
        }, 250);
    }

    node.__vhsTrimRender = () => { read(); render(); };
    node.__vhsTrimResetForNewVideo = resetForNewVideo;
    read();
    render();

    return {
        onDown(e, target) {
            let mode = null;
            if (target === hL) mode = "l";
            else if (target === hR) mode = "r";
            else if (target === sel) mode = "m";
            else if (target === track) mode = "seek";
            else return false;
            e.preventDefault();
            e.stopPropagation();
            if (mode !== "seek") { beginDrag(mode, e); return true; }
            const info = srcInfo(node);
            if (!info) return true;
            read();
            const shown = du > 0 ? du : info.total - st;
            st = Math.max(0, Math.min(tAt(e.clientX) - shown / 2, info.total - shown));
            du = shown;
            commit(true);
            render();
            return true;
        },
        syncWidgets() {
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
        },
    };
}

/**
 * Hooks the "video" widget so a genuinely new file selection/upload resets
 * the trim window instead of leaving stale in/out points that may no longer
 * fit the new file's duration.
 *
 * Multiple things can invoke widget.callback(widget.value) during a node's
 * construction/configure sequence for reasons unrelated to a real video
 * change (VHS re-fires several widgets' callbacks with their CURRENT value
 * as part of its own setup). Rather than assume the exact ordering of those
 * internal calls relative to a saved workflow's configure() step -- getting
 * that wrong in either direction either misses real changes or wipes a just
 * -loaded workflow's saved trim points -- this waits a short settle window
 * after mount before treating any callback firing as a genuine change. That
 * window comfortably covers construction-time callback storms (which
 * complete synchronously/near-synchronously) while being far shorter than
 * any realistic gap before a real user re-upload.
 */
function guardVideoChanges(node, onChanged) {
    const videoW = getW(node, "video");
    if (!videoW) return;
    let ready = false;
    let last = videoW.value;
    setTimeout(() => { ready = true; }, 600);
    const orig = videoW.callback;
    videoW.callback = function (...a) {
        const r = orig ? orig.apply(this, a) : undefined;
        const v = videoW.value;
        if (ready && v !== last) onChanged();
        last = v;
        return r;
    };
}

function mount(node) {
    const pv = getW(node, "videopreview");
    const host = pv?.parentEl;
    if (!host || host.querySelector(".vhs-ctl-panel")) return false;
    injectCSS();

    // the hover overlay is position:absolute against this container; VHS never sets
    // an explicit position on it, so this is safe to establish as the positioning
    // context without disturbing anything else already in normal flow here.
    host.style.position = host.style.position || "relative";

    const panel = document.createElement("div");
    panel.className = "vhs-ctl-panel";
    host.appendChild(panel);
    const scrubRow = document.createElement("div");
    scrubRow.className = "vhs-scrubwrap";
    panel.appendChild(scrubRow);

    forceRawPreview(pv.videoEl);
    // videoEl.src may already be set (e.g. reopening a saved workflow with a video
    // already selected) -- re-trigger once so the existing src gets redirected too.
    if (pv.videoEl.src) pv.updateSource?.();

    const playback = mountPlayback(node, host, scrubRow, pv.videoEl);
    const trim = mountTrim(node, panel);
    trim.syncWidgets();
    guardVideoChanges(node, () => node.__vhsTrimResetForNewVideo());

    // previewWidget.computeSize only ever accounted for the video's own aspect-ratio
    // height (`(nodeWidth-20)/aspectRatio + 10`). It has no idea this panel exists, so
    // without patching it the node's own allotted box never grows to contain the panel
    // -- it overflows past the node's drawn boundary instead of the node resizing, and
    // pointer hit-testing in that overflowed strip is unreliable since the canvas
    // doesn't believe the node extends there. (The hover overlay does NOT need to be
    // added here: it's absolutely positioned on top of the video's own already
    // -accounted-for area, not extra normal-flow height like the panel below it.)
    const origComputeSize = pv.computeSize.bind(pv);
    pv.computeSize = function (width) {
        const [w, h] = origComputeSize(width);
        // h<=0 is VHS's own "nothing loaded yet, don't display" sentinel (see
        // addVideoPreview) -- leave it alone so the whole preview area (video +
        // panel) stays collapsed until a video is actually chosen, exactly like
        // it did before this panel existed.
        if (h <= 0) return [w, h];
        // getBoundingClientRect() returns real SCREEN pixels (already reflecting the
        // canvas's current zoom), but computeSize must return LOGICAL/canvas-space
        // units like `h` -- confirmed empirically: at ds.scale=0.55 the panel
        // overflowed by ~9.4 screen px, and at 0.5 by ~5.5, i.e. scaling with zoom,
        // not a fixed offset. VHS's own formula for `h` never has this problem since
        // it's pure arithmetic on node.size (already logical), not a DOM measurement.
        const scale = app.canvas?.ds?.scale || 1;
        const panelLogicalH = (panel.getBoundingClientRect().height || 0) / scale;
        return [w, h + panelLogicalH + 4];
    };
    fitNodeHeight(node);
    // VHS calls its own (private, unexported) fitHeight() on the video's
    // 'loadedmetadata' event once the aspect ratio becomes known for the first
    // time; that recomputes via node.computeSize(), which now includes our
    // panel height too since it goes through the wrapped computeSize above.
    // We only need one more explicit call for whenever OUR panel's own height
    // changes after the fact (e.g. the trim label growing to a second line).
    const ro = new ResizeObserver(() => {
        if (!panel.isConnected) { ro.disconnect(); return; }
        fitNodeHeight(node);
    });
    ro.observe(panel);

    // ComfyUI's canvas layer calls stopPropagation on pointerdown during the CAPTURE
    // phase, before the event can reach a DOM widget's children -- verified by probing:
    // window-capture and document-capture both see it with the handle as target, and
    // nothing below document ever fires. (VHS's own <video controls> is unaffected only
    // because native media controls are handled by the browser, not by JS listeners.)
    // So bind once on document in the capture phase and route by target instead.
    const overlay = host.querySelector(".vhs-play-overlay");
    const onDown = (e) => {
        if (!panel.isConnected) {
            document.removeEventListener("pointerdown", onDown, true);
            return;
        }
        // playback owns targets in BOTH containers (overlay buttons AND the scrub
        // bar, which lives in panel's scrubRow) -- always try it first regardless
        // of which container the target is in, then fall back to the trim bar.
        if (!(overlay && overlay.contains(e.target)) && !panel.contains(e.target)) return;
        playback.onDown(e, e.target) || trim.onDown(e, e.target);
    };
    document.addEventListener("pointerdown", onDown, true);

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
