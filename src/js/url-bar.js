/*
 * URL bar capsule: animates its width when the address changes.
 *
 * The capsule is width: fit-content (css/library.css), which CSS cannot
 * transition. On a text change the new natural width is measured and a Web
 * Animation runs from the previous width to it; when it ends the bar is back
 * to fit-content. A change mid-animation starts from the current width.
 */
(() => {
    if (window.__lmUrlBar) return;
    window.__lmUrlBar = true;

    const DURATION = 280;
    const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

    const hook = (bar) => {
        bar.dataset.lmUrl = "";
        let last = bar.getBoundingClientRect().width;   // settled width; 0 while hidden
        let anim = null;

        new ResizeObserver(() => {
            if (!anim) last = bar.getBoundingClientRect().width;
        }).observe(bar);

        // runs before the next frame is painted
        new MutationObserver(() => {
            const from = anim ? bar.getBoundingClientRect().width : last;
            if (anim) anim.cancel();
            const to = bar.getBoundingClientRect().width;
            last = to;
            if (!from || !to || Math.abs(to - from) < 1) return;
            const a = bar.animate([{ width: from + "px" }, { width: to + "px" }], { duration: DURATION, easing: EASING });
            anim = a;
            a.onfinish = a.oncancel = () => { if (anim === a) anim = null; };
        }).observe(bar, { subtree: true, childList: true, characterData: true });
    };

    // web views mount their URL bar lazily
    const scan = () => document.querySelectorAll(".URLBar:not([data-lm-url])").forEach(hook);
    scan();
    setInterval(scan, 1000);
})();
