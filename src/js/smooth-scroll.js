/*
 * Smooth mouse-wheel scrolling for the library game list and right library pane.
 *
 * Each notch moves a target; scrollTop eases toward it every frame
 * (1 - e^(-dt/tau), at least MIN_SPEED). Touchpads (wheelDelta not a multiple
 * of 120), Ctrl/Shift+wheel, horizontal wheels and scrolling past the ends are
 * left native. Any other scroll stops the glide. scrollTop is written in whole
 * pixels since each change re-renders virtualized lists cleanly.
 *
 * The blocking wheel listener sits on each scroll container, so wheels
 * elsewhere in the window scroll without waiting for the main thread.
 * Containers are found by passive listeners as the pointer reaches them.
 */
(() => {
    if (window.__lmSmoothScroll) return;
    window.__lmSmoothScroll = true;

    const LIST = ".ReactVirtualized__Grid.ReactVirtualized__List";
    const RIGHT_PANE = "{{LeftListSizableContainer.AppDetailsTransitionGroup}}";
    const RIGHT_SCROLLER = [
        "{{AppDetailsOverviewPanel.ScrollContainer}}",
        "{{LibraryHome.InnerContainer}}",
        "{{ContainerScroll.OuterContainer}}",
        "{{BigPlus.ScrollContainer}}",
        "{{OverlayPinned.DesktopPanel}}",
        "{{DownloadsPage.ItemLists}}",
    ].join(",");
    const LINE = 40;          // px per line, for deltaMode 1
    const MIN_SPEED = 0.15;   // px per ms: the glide's slowest pace near the end

    // the Smooth scrolling setting, kept current outside the wheel handler
    let tau = 0, tauRaw = "";
    const readTau = () => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--lm-smooth-scroll").trim();
        if (!raw && tauRaw) return;   // stylesheets reloading: keep the last value
        tauRaw = raw;
        const n = parseFloat(raw);
        tau = !n || n < 0 ? 0 : raw.endsWith("ms") ? n : n * 1000;
    };
    const tauOf = () => tau;
    readTau();
    setInterval(() => { if (!document.hidden) readTau(); }, 1000);
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") readTau(); }, true);

    // { el, pos, target, set (last written scrollTop), last, tau, raf }
    let glide = null;

    const stop = () => {
        if (glide) cancelAnimationFrame(glide.raf);
        glide = null;
    };

    const step = (now) => {
        const g = glide;
        if (!g) return;
        // scrolled by something else or element detached
        if (!g.el.isConnected || Math.abs(g.el.scrollTop - g.set) > 2) { stop(); return; }
        // rAF time can precede the wheel event; never let dt go negative
        const dt = g.last === null ? 1000 / 60 : Math.max(0, Math.min(now - g.last, 50));
        g.last = now;
        const rem = g.target - g.pos;
        let move = rem * (1 - Math.exp(-dt / g.tau));
        const floor = MIN_SPEED * dt;
        if (Math.abs(move) < floor) move = Math.sign(rem) * Math.min(Math.abs(rem), floor);
        g.pos += move;
        if (Math.abs(g.target - g.pos) < 0.5) g.pos = g.target;
        const px = Math.round(g.pos);
        if (px !== g.set) { g.el.scrollTop = px; g.set = px; }
        if (g.pos === g.target) { glide = null; return; }
        g.raf = requestAnimationFrame(step);
    };

    const isOverflowY = (el) => {
        const oy = getComputedStyle(el).overflowY;
        return oy === "auto" || oy === "scroll" || oy === "overlay";
    };

    // Let nested scrollable regions inside a right-pane view scroll natively
    // until they hit their edge.
    const hasInnerScroller = (target, stopAt, dy) => {
        for (let n = target; n && n !== stopAt && n.nodeType === 1; n = n.parentElement) {
            const max = n.scrollHeight - n.clientHeight;
            if (max <= 1) continue;
            if (!isOverflowY(n)) continue;
            if (dy > 0 ? n.scrollTop < max - 1 : n.scrollTop > 1) return true;
        }
        return false;
    };

    const onWheel = (e) => {
        if (e.ctrlKey || e.shiftKey || e.defaultPrevented) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return;
        if (e.wheelDeltaY === undefined || e.wheelDeltaY % 120 !== 0) return;   // touchpad etc.
        const el = e.currentTarget;
        const tau = glide && glide.el === el ? glide.tau : tauOf();
        if (!tau) return;

        const px = e.deltaMode === 1 ? e.deltaY * LINE
            : e.deltaMode === 2 ? e.deltaY * el.clientHeight
            : e.deltaY;
        if (!el.matches(LIST) && hasInnerScroller(e.target, el, px)) return;

        const max = el.scrollHeight - el.clientHeight;
        const base = glide && glide.el === el ? glide.target : el.scrollTop;
        const target = Math.max(0, Math.min(max, base + px));

        // at the edge: let the wheel through
        if (target === base && (glide === null || glide.el !== el)) return;
        e.preventDefault();
        if (target === base) return;

        if (!glide || glide.el !== el) {
            stop();
            glide = { el, pos: el.scrollTop, target, set: el.scrollTop, last: null, tau, raf: 0 };
            glide.raf = requestAnimationFrame(step);
        } else {
            glide.target = target;
        }
    };

    // Containers are re-created as the library re-renders.
    const bound = new WeakSet();
    const attach = (el, capture) => {
        if (!el || bound.has(el)) return;
        bound.add(el);
        el.addEventListener("wheel", onWheel, { capture, passive: false });
    };

    const findFallbackScroller = (target) => {
        const pane = target.closest && target.closest(RIGHT_PANE);
        if (!pane) return null;
        for (let n = target; n && n !== pane && n.nodeType === 1; n = n.parentElement) {
            if (n.scrollHeight > n.clientHeight + 1 && isOverflowY(n)) return n;
        }
        return null;
    };

    const bind = (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        const list = target.closest(LIST);
        if (list) { attach(list, true); return; }
        const scroller = target.closest(RIGHT_SCROLLER);
        if (scroller) { attach(scroller, false); return; }
        if (e.type === "wheel") {
            const fb = findFallbackScroller(target);
            if (fb) attach(fb, false);
        }
    };
    document.addEventListener("mouseover", bind, { passive: true });
    document.addEventListener("wheel", bind, { passive: true });
})();
