/*
 * Nav capsule placement (css/library.css), by the Nav position setting
 * (--lm-nav-pos).
 *
 * Center: in the title bar (--lm-nav-x). When the middle doesn't fit between
 * the menus and the buttons (GAP apart), it slides along the free space; if
 * the space is too short it tightens its items (html.lm-nav-compact); only
 * then does it go on a second row on the left (html.lm-nav-wrap). Its width
 * depends on the language and the account name, so a fixed breakpoint isn't
 * enough.
 *
 * Left / Right: on the second row at that end (html.lm-nav-row); on web pages
 * the URL bar shares the row from the other end (--lm-nav-w keeps them apart).
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
    const POSITIONS = ["center", "left", "right"];

    let pos = "center";
    const position = () => {   // empty while stylesheets reload: keep the last value
        const v = getComputedStyle(html).getPropertyValue("--lm-nav-pos").trim();
        if (POSITIONS.includes(v)) pos = v;
        return pos;
    };

    // the capsule's width with or without tightened items; the same in either row
    const widthOf = (nav, compact) => {
        html.classList.toggle("lm-nav-compact", compact);
        return nav.offsetWidth;
    };

    let lastLayout = "";
    const fit = () => {
        const top = document.querySelector(TOP), nav = document.querySelector(NAV);
        if (!top || !nav || !nav.offsetWidth) return;
        const t = top.getBoundingClientRect();
        const menus = document.querySelector(MENUS), controls = document.querySelector(CONTROLS);
        const minX = menus && menus.offsetWidth ? menus.getBoundingClientRect().right + GAP : t.left;
        const maxX = controls && controls.offsetWidth ? controls.getBoundingClientRect().left - GAP : t.right;
        const p = position();
        const key = `${Math.round(t.left)}|${Math.round(t.width)}|${Math.round(minX)}|${Math.round(maxX)}|${p}|${nav.textContent.length}`;
        if (key === lastLayout) return;
        lastLayout = key;
        html.classList.add("lm-nav-placed");
        if (p !== "center") {   // anchored to that end by the stylesheets
            html.style.setProperty("--lm-nav-w", widthOf(nav, false) + "px");
            html.classList.remove("lm-nav-wrap");
            html.classList.add("lm-nav-row");
            return;
        }
        html.classList.remove("lm-nav-row");
        let w = widthOf(nav, false);
        if (w > maxX - minX) w = widthOf(nav, true);
        const fits = w <= maxX - minX;
        if (!fits) w = widthOf(nav, false);
        const x = Math.min(Math.max(t.left + (t.width - w) / 2, minX), maxX - w);
        html.style.setProperty("--lm-nav-x", Math.round(x - t.left) + "px");
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
    setInterval(() => { if (!document.hidden) watch(); }, 1000);
    // the setting changes by stylesheet; links change in head
    const refit = () => { lastLayout = ""; fit(); };
    new MutationObserver(() => requestAnimationFrame(refit)).observe(document.head, { childList: true, subtree: true });
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") refit(); }, true);
})();
