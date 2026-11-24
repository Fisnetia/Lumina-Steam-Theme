/*
 * Smooth mouse-wheel scrolling for the library game list.
 *
 * Each notch moves a target; scrollTop eases toward it every frame
 * (1 - e^(-dt/tau), at least MIN_SPEED). Touchpads (wheelDelta not a multiple
 * of 120), Ctrl/Shift+wheel, horizontal wheels and scrolling past the ends are
 * left native. Any other scroll stops the glide. scrollTop is written in whole
 * pixels since each change re-renders the virtualized list.
 *
 * The blocking wheel listener sits on the list itself, so wheels elsewhere in
 * the window scroll without waiting for the main thread. Lists are found by
 * passive listeners as the pointer reaches them.
 */
(() => {
    if (window.__lmSmoothScroll) return;
    window.__lmSmoothScroll = true;

    const LIST = ".ReactVirtualized__Grid.ReactVirtualized__List";
    const LINE = 40;          // px per line, for deltaMode 1
    const MIN_SPEED = 0.15;   // px per ms: the glide's slowest pace near the end

    const tauOf = () => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--lm-smooth-scroll").trim();
        const n = parseFloat(raw);
        if (!n || n < 0) return 0;
        return raw.endsWith("ms") ? n : n * 1000;
    };

    // { el, pos, target, set (last written scrollTop), last, tau, raf }
    let glide = null;

    const stop = () => {
        if (glide) cancelAnimationFrame(glide.raf);
        glide = null;
    };

    const step = (now) => {
        const g = glide;
        if (!g) return;
        // scrolled by something else
        if (Math.abs(g.el.scrollTop - g.set) > 2) { stop(); return; }
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

    // the list is re-created as the library re-renders
    const bound = new WeakSet();
    const bind = (e) => {
        const el = e.target.closest && e.target.closest(LIST);
        if (!el || bound.has(el)) return;
        bound.add(el);
        el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    };
    document.addEventListener("mouseover", bind, { passive: true });
    document.addEventListener("wheel", bind, { passive: true });
})();
