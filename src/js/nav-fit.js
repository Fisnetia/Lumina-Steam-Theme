/*
 * Nav capsule placement (css/library.css). The Nav position setting
 * (--lm-nav-pos) puts it in the title bar centered, after the menus on the
 * left, or before the buttons on the right (--lm-nav-x). When the preferred
 * spot doesn't fit between the menus and the buttons (GAP apart), it slides
 * along the free space; if the space is too short it tightens its items
 * (html.lm-nav-compact); only then does it go on a second row
 * (html.lm-nav-wrap), on the left, or on the right for Right. Its width depends on the
 * language and the account name, so a fixed breakpoint isn't enough.
 */
(() => {
    if (window.__lmNavFit) return;
    window.__lmNavFit = true;

    const html = document.documentElement;
    if (!html.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const GAP = 8;
    const TOP = "{{ForceOpaqueBackground.TopBar}}";
    const NAV = "{{ForceOpaqueBackground.SuperNavBar}}";
    const MENUS = "{{ForceOpaqueBackground.RootMenuBar}}";
    const CONTROLS = "{{ForceOpaqueBackground.TitleBarControls}}";
    // second-row alignment: a centered capsule on its own row looks adrift, so it goes left
    const ALIGN = { left: "flex-start", center: "flex-start", right: "flex-end" };

    let pos = "center";
    const position = () => {   // empty while stylesheets reload: keep the last value
        const v = getComputedStyle(html).getPropertyValue("--lm-nav-pos").trim();
        if (ALIGN[v]) pos = v;
        return pos;
    };

    // the capsule's width with or without tightened items; the same in either row
    const widthOf = (nav, compact) => {
        html.classList.toggle("lm-nav-compact", compact);
        return nav.offsetWidth;
    };

    const fit = () => {
        const top = document.querySelector(TOP), nav = document.querySelector(NAV);
        if (!top || !nav || !nav.offsetWidth) return;
        const t = top.getBoundingClientRect();
        const menus = document.querySelector(MENUS), controls = document.querySelector(CONTROLS);
        const minX = menus && menus.offsetWidth ? menus.getBoundingClientRect().right + GAP : t.left;
        const maxX = controls && controls.offsetWidth ? controls.getBoundingClientRect().left - GAP : t.right;
        let w = widthOf(nav, false);
        if (w > maxX - minX) w = widthOf(nav, true);
        const fits = w <= maxX - minX;
        if (!fits) w = widthOf(nav, false);
        const p = position();
        const want = p === "left" ? minX : p === "right" ? maxX - w : t.left + (t.width - w) / 2;
        const x = fits ? Math.min(Math.max(want, minX), maxX - w) : want;
        html.style.setProperty("--lm-nav-x", Math.round(x - t.left) + "px");
        html.style.setProperty("--lm-nav-align", ALIGN[p]);
        html.classList.add("lm-nav-placed");
        html.classList.toggle("lm-nav-wrap", !fits);
    };

    // the title bar is re-rendered by React: observe whichever elements are current
    const observer = new ResizeObserver(fit);
    const watched = new WeakSet();
    const watch = () => {
        for (const sel of [TOP, NAV, MENUS, CONTROLS]) {
            const el = document.querySelector(sel);
            if (el && !watched.has(el)) { watched.add(el); observer.observe(el); }
        }
        fit();
    };
    html.classList.add("lm-nav-fit");   // the CSS breakpoint steps aside
    watch();
    setInterval(watch, 1000);
    // the setting changes by stylesheet; links change in head
    new MutationObserver(() => requestAnimationFrame(fit)).observe(document.head, { childList: true, subtree: true });
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") fit(); }, true);
})();
