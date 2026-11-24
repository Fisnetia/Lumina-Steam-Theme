/*
 * Bottom bar on web pages (css/library.css).
 *
 * Store and Community are native views the main window can't paint over, so
 * pages can't run behind the capsules there. While one is shown, the three
 * capsules merge into a full-width bottom bar (html.lm-web-bar) and the page
 * ends at its top; back in the library they part again. The bar's own glass
 * is a CSS transition; the capsules move FLIP-style: each one's box is read
 * before and after the class changes, and it slides from the old place to
 * the new one. Only transform is animated, which runs off the main thread:
 * the library renders a lot as it comes back, and a size animation stalled.
 */
(() => {
    if (window.__lmBottomBar) return;
    window.__lmBottomBar = true;

    const html = document.documentElement;
    if (!html.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const CAPSULES = ["{{BottomBarContainer.AddGameButton}}", "{{BottomBarContainer.DownloadStatus}}",
        "{{BottomBarContainer.FriendsButton}}"];
    const FRAME = "{{ForceOpaqueBackground.ContentFrame}}";
    const WEB = `${FRAME} > {{ForceOpaqueBackground.BrowserWrapper}}`;
    const DURATION = 420, EASING = "cubic-bezier(0.25, 0.7, 0.25, 1)";

    // the web view stays mounted, hidden by an inline display: none
    const webShown = () => {
        const w = document.querySelector(WEB);
        return !!w && w.style.display !== "none";
    };

    const set = (on) => {
        if (html.classList.contains("lm-web-bar") === on) return;
        const els = CAPSULES.map(s => document.querySelector(s)).filter(Boolean);
        const before = els.map(e => e.getBoundingClientRect());
        html.classList.toggle("lm-web-bar", on);
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        els.forEach((e, i) => {
            const a = before[i], b = e.getBoundingClientRect();
            if (!a.width || !b.width) return;
            e.getAnimations().forEach(x => x.cancel());
            const dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
            e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
                { duration: DURATION, easing: EASING });
        });
    };

    const sync = () => {
        const want = webShown();
        if (want !== html.classList.contains("lm-web-bar")) set(want);
    };

    // Observe only BrowserWrapper's style and ContentFrame's direct children
    // so unrelated mutations (e.g. game list scrolling) don't run sync.
    let watchedFrame = null, watchedWeb = null;
    const webObserver = new MutationObserver(sync);
    const frameObserver = new MutationObserver(() => { watch(); sync(); });

    const watch = () => {
        const frame = document.querySelector(FRAME);
        if (frame !== watchedFrame) {
            frameObserver.disconnect();
            watchedFrame = frame;
            if (frame) frameObserver.observe(frame, { childList: true });
        }
        const web = document.querySelector(WEB);
        if (web !== watchedWeb) {
            webObserver.disconnect();
            watchedWeb = web;
            if (web) webObserver.observe(web, { attributes: true, attributeFilter: ["style"] });
        }
    };

    const refresh = () => { watch(); sync(); };
    setInterval(refresh, 1000);
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") refresh(); }, true);
    refresh();
})();
