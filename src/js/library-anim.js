/*
 * Library collection expand/collapse animations.
 *
 * The game list is virtualized: rows are reused, not added, so changes are
 * detected from the header's SingleLine class (present while collapsed).
 * Expand: rows below the header get .lm-row-in with --lm-i / --lm-n.
 * Collapse: the toggle is held while games fade (.lm-row-out), then replayed;
 * rows below then slide up from --lm-shift (.lm-row-up).
 * Durations come from the menu-* condition CSS; "Off" passes clicks through.
 * Also replays the game page's enter animation when switching games, and
 * brings in a collection, the collections overview and the library home row
 * by row.
 */
(() => {
    if (window.__lmLibAnim) return;
    window.__lmLibAnim = true;

    const COLLAPSE = "{{CollapseIconParent}}";
    const COLLAPSED = "{{SectionHeaderContent.SingleLine}}".slice(1);
    let replaying = false;
    let pending = null;   // the collapse currently held back (see the click handler)

    const px = (v) => parseFloat(v);
    const ms = (raw) => {
        raw = (raw || "").trim();
        const n = parseFloat(raw);
        if (!n || n < 0) return 0;
        return raw.endsWith("ms") ? n : n * 1000;
    };

    // Rendered rows below a header's row, top to bottom.
    const allBelow = (header) => {
        const panel = header.closest(".Panel");
        const list = panel && panel.parentElement;
        if (!list) return [];
        const top0 = px(panel.style.top);
        if (Number.isNaN(top0)) return [];
        return [...list.children]
            .filter(r => px(r.style.top) > top0)
            .sort((a, b) => px(a.style.top) - px(b.style.top));
    };

    // Rendered game rows of this collection: below it, up to the next header.
    const gameRows = (header) => {
        const rows = [];
        for (const r of allBelow(header)) {
            if (r.querySelector(COLLAPSE)) break;
            rows.push(r);
        }
        return rows;
    };

    const ROW_CLASSES = ["lm-row-in", "lm-row-out", "lm-row-up"];

    // restart `cls`, dropping the other row classes first
    const restart = (rows, cls) => {
        rows.forEach(r => r.classList.remove(...ROW_CLASSES));
        if (rows.length) void rows[0].offsetWidth;   // let the removal apply first
        rows.forEach(r => r.classList.add(cls));
    };

    const clearAll = (list) => {
        if (list) [...list.children].forEach(r => r.classList.remove(...ROW_CLASSES));
    };

    /* ---- expand: games drop in ---- */

    const playExpand = (header) => {
        const rows = gameRows(header);
        rows.forEach((r, i) => {
            r.style.setProperty("--lm-i", String(i));
            r.style.setProperty("--lm-n", String(rows.length));
        });
        restart(rows, "lm-row-in");
    };

    /* ---- collapse, part 2: rows below slide up into place ---- */

    const playCollapse = (header) => {
        const panel = header.closest(".Panel");
        clearAll(panel && panel.parentElement);   // rows now show other content
        if (pending && pending.header === header) { clearTimeout(pending.timer); pending = null; }
        const grid = header.closest(".ReactVirtualized__Grid");
        if (!panel || !grid) return;
        // "(11)", or "(10/11)" (shown / total) while the list is filtered
        const m = header.textContent.match(/\((\d+)(?:\/\d+)?\)\s*$/);
        const count = m ? parseInt(m[1], 10) : 0;
        if (!count) return;
        // rows start from where they were, at most from the list's bottom edge
        const rowH = panel.getBoundingClientRect().height;
        const room = grid.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
        const shift = Math.max(0, Math.min(count * rowH, room));
        if (!shift) return;
        const rows = allBelow(header);
        rows.forEach(r => r.style.setProperty("--lm-shift", shift + "px"));
        restart(rows, "lm-row-up");
    };

    new MutationObserver(records => {
        for (const rec of records) {
            const el = rec.target;
            if (!el.matches || !el.matches(COLLAPSE)) continue;
            const was = (rec.oldValue || "").split(/\s+/).includes(COLLAPSED);
            const now = el.classList.contains(COLLAPSED);
            if (was && !now) playExpand(el);
            else if (!was && now) playCollapse(el);
        }
    }).observe(document.documentElement, {
        subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"],
    });

    /* ---- collapse: hold the toggle, fade, replay ---- */

    /* Toggles: a click on the icon, or a double click on the header. Every icon
     * click counts; the icon's dblclick is swallowed (natively it would add a
     * third toggle). One collapse is held at a time: toggling it again cancels
     * it, toggling another header completes it first. Clicks are replayed on
     * the header's current icon, since Steam swaps the icon element. */

    const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };

    const isIcon = (el, header) => {
        const svg = el.closest && el.closest("svg");
        return !!svg && header.querySelector("svg") === svg;
    };

    const replay = (p) => {
        let target = null;
        if (p.header.isConnected) {
            target = p.type === "click" ? p.header.querySelector("svg")
                : (p.target.isConnected ? p.target : p.header);
        }
        if (!target) { p.rows.forEach(r => r.classList.remove("lm-row-out")); return; }
        replaying = true;
        try { target.dispatchEvent(new MouseEvent(p.type, p.init)); }
        finally { replaying = false; }
        // safety net if Steam doesn't collapse
        setTimeout(() => {
            if (!p.header.classList.contains(COLLAPSED)) {
                p.rows.forEach(r => r.classList.remove("lm-row-out"));
            }
        }, 400);
    };

    const flush = () => {
        if (!pending) return;
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        replay(p);
    };

    const onToggle = (e, header) => {
        if (pending && pending.header === header) {
            swallow(e);   // toggled again while fading: cancel
            clearTimeout(pending.timer);
            const rows = pending.rows.filter(r => r.isConnected);
            pending = null;
            rows.forEach(r => r.style.setProperty("--lm-i", "0"));
            restart(rows, "lm-row-in");
            return;
        }
        if (pending) { flush(); return; }   // this event goes to Steam as is

        if (header.classList.contains(COLLAPSED)) return;   // expanding: Steam handles it
        const dur = ms(getComputedStyle(header).getPropertyValue("--lm-row-out-dur"));
        const rows = gameRows(header);
        if (!dur || !rows.length) return;

        swallow(e);
        restart(rows, "lm-row-out");
        const p = {
            header, rows, type: e.type, target: e.target,
            init: { bubbles: true, cancelable: true, view: window, button: 0, detail: e.detail,
                    clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY },
        };
        p.timer = setTimeout(() => { if (pending === p) { pending = null; replay(p); } }, dur);
        pending = p;
    };

    document.addEventListener("click", (e) => {
        if (replaying) return;
        const header = e.target.closest && e.target.closest(COLLAPSE);
        if (!header || !isIcon(e.target, header)) return;   // only the icon toggles on click
        onToggle(e, header);   // every click, whatever its click count (e.detail)
    }, true);

    document.addEventListener("dblclick", (e) => {
        if (replaying) return;
        const header = e.target.closest && e.target.closest(COLLAPSE);
        if (!header) return;
        if (isIcon(e.target, header)) { swallow(e); return; }   // its clicks already toggled
        onToggle(e, header);
    }, true);

    /* ---- game page: replay its enter animation on every switch ---- */

    /* The page's CSS animations (menu-* conditions) play on mount, but a game
     * that was opened before reuses the same elements. So they are restarted
     * whenever the route's appid changes, once the new game has rendered. */

    // the hero needs no replay: its animation starts with HeaderLoaded, re-added on every switch
    const PAGE_PARTS = [
        "{{LeftListSizableContainer.AppDetailsMain}} > {{AppDetailsOverviewPanel.Container}}",
        "{{SpotlightLeftColumn.Container}} {{SpotlightLeftColumn.ColumnContainer}}",
        "{{PlayBarGameName.InPage}} {{PlayBarGameName.ActionSection}}",
        "{{PlayBarGameName.InPage}} {{PlayBarGameName.StatusAndStats}}",
        "{{PlayBarGameName.InPage}} {{PlayBarGameName.SharedLibrary}}",
        "{{LinksSection.LinksSection}}",
    ].join(",");

    const hasAnim = (el) => getComputedStyle(el).animationName !== "none";

    // restart by name: finished animations aren't listed by getAnimations()
    const replayPage = () => {
        const els = [...document.querySelectorAll(PAGE_PARTS)].filter(hasAnim);
        if (!els.length) return;
        els.forEach(e => { e.style.animationName = "none"; });
        void els[0].offsetWidth;   // apply "none" before restoring
        els.forEach(e => { e.style.animationName = ""; });
    };

    /* Steam renders the new game in long tasks, sometimes a frame or more after
     * the route change, which would eat the start of the animation. The page is
     * hidden (.lm-page-wait, also covers a remounted page) until its content
     * changes and two frames run on time, then played from the start. */
    let waiting = null;
    const MAIN = "{{LeftListSizableContainer.AppDetailsMain}}";

    const playWhenSettled = (main, play) => {
        if (waiting) waiting.stop();
        main.classList.add("lm-page-wait");
        const t0 = performance.now();
        let changed = false, last = t0, calm = 0, raf = 0;
        const mo = new MutationObserver(() => { changed = true; });
        mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
        const stop = () => { mo.disconnect(); cancelAnimationFrame(raf); main.classList.remove("lm-page-wait"); waiting = null; };
        const step = (now) => {
            calm = changed && now - last < 34 ? calm + 1 : 0;
            last = now;
            if (calm >= 2 || now - t0 > 700) { stop(); play(); return; }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        waiting = { stop };
    };

    const onAppChange = () => {
        const main = document.querySelector(MAIN);
        const page = main && main.querySelector(PAGE_PARTS);
        if (!page || !hasAnim(page)) return;
        playWhenSettled(main, replayPage);
    };

    /* ---- collection page: games come in row by row ----
     * The header and sort bar first, then each visible row of the grid, numbered
     * by position (--lm-i, .lm-cap-in from the menu-* conditions). Rows that
     * scroll into view later are not animated. */

    const playCollection = () => {
        const main = document.querySelector(MAIN);
        const grid = main && main.querySelector("{{GridWithControls}} {{CSSGrid}}");
        if (!grid) return;
        const view = main.getBoundingClientRect();
        const controls = grid.closest("{{GridWithControls}}");
        const head = [controls.parentElement.querySelector(":scope > .Header"),
            controls.querySelector(":scope > {{GridWithControls.CollectionOptions}}")].filter(Boolean);
        const cards = [...grid.querySelectorAll("{{FeaturedCapsule.LibraryItemBox}}")].map(b => [b.parentElement, b.getBoundingClientRect()])
            .filter(([, r]) => r.bottom > view.top && r.top < view.bottom);
        const tops = [...new Set(cards.map(([, r]) => Math.round(r.top)))].sort((a, b) => a - b);
        const items = [...head.map((el, i) => [el, i]),
                       ...cards.map(([el, r]) => [el, head.length + tops.indexOf(Math.round(r.top))])];
        items.forEach(([el, i]) => { el.classList.remove("lm-cap-in"); el.style.setProperty("--lm-i", String(i)); });
        void grid.offsetWidth;   // restart cards that are still animating
        items.forEach(([el]) => el.classList.add("lm-cap-in"));
    };

    /* ---- library home: the same, by position ----
     * The block above the shelves (What's New), each shelf's header and each
     * visible row of capsules, numbered from the top. */

    const HOME = "{{LibraryHome.LibraryHome}}";
    const playHome = () => {
        const main = document.querySelector(MAIN);
        const home = main && main.querySelector(HOME);
        if (!home) return;
        const view = main.getBoundingClientRect();
        const shown = (el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0 && r.bottom > view.top && r.top < view.bottom ? r : null;
        };
        const els = [...[...home.parentElement.children].filter(c => c !== home),
                     ...home.querySelectorAll("{{ShowcaseHeader}}"),
                     ...[...home.querySelectorAll("{{FeaturedCapsule.LibraryItemBox}}")].map(b => b.parentElement)];
        const items = els.map(el => [el, shown(el)]).filter(([, r]) => r);
        const tops = [...new Set(items.map(([, r]) => Math.round(r.top)))].sort((a, b) => a - b);
        items.forEach(([el, r]) => { el.classList.remove("lm-cap-in"); el.style.setProperty("--lm-i", String(tops.indexOf(Math.round(r.top)))); });
        void home.offsetWidth;   // restart items that are still animating
        items.forEach(([el]) => el.classList.add("lm-cap-in"));
    };

    // collections overview: its header, then each row of collection tiles
    const playCollections = () => {
        const main = document.querySelector(MAIN);
        const page = main && main.querySelector("{{BigPlus.ScrollContainer}}");
        if (!page) return;
        const view = main.getBoundingClientRect();
        const els = [...page.querySelectorAll("{{BigPlus.Header}}, {{BigPlus.Collection}}")];
        const items = els.map(el => [el, el.getBoundingClientRect()])
            .filter(([, r]) => r.height > 0 && r.bottom > view.top && r.top < view.bottom);
        const tops = [...new Set(items.map(([, r]) => Math.round(r.top)))].sort((a, b) => a - b);
        items.forEach(([el, r]) => { el.classList.remove("lm-cap-in"); el.style.setProperty("--lm-i", String(tops.indexOf(Math.round(r.top)))); });
        void page.offsetWidth;
        items.forEach(([el]) => el.classList.add("lm-cap-in"));
    };

    const onHome = () => {
        const main = document.querySelector(MAIN);
        if (!main || !getComputedStyle(document.documentElement).getPropertyValue("--lm-cap-step").trim()) return;
        playWhenSettled(main, playHome);
    };

    const onCollections = () => {
        const main = document.querySelector(MAIN);
        if (!main || !getComputedStyle(document.documentElement).getPropertyValue("--lm-cap-step").trim()) return;
        playWhenSettled(main, playCollections);
    };

    const onCollection = () => {
        const main = document.querySelector(MAIN);
        // --lm-cap-step comes with the Cascade and Fade conditions; Off has none
        if (!main || !getComputedStyle(document.documentElement).getPropertyValue("--lm-cap-step").trim()) return;
        playWhenSettled(main, playCollection);
    };

    const findHistory = () => {
        const el = document.querySelector("{{SuperNav.SuperNavMenu}}");
        const key = el && Object.keys(el).find(k => k.startsWith("__reactFiber"));
        for (let f = key && el[key], i = 0; f && i < 300; f = f.return, i++) {
            const p = f.memoizedProps;
            if (p && p.history && typeof p.history.listen === "function") return p.history;
        }
        return null;
    };

    const appOf = (path) => { const m = /^\/library\/app\/(\d+)/.exec(path || ""); return m ? m[1] : null; };
    const isCollection = (path) => /^\/library\/collection\//.test(path || "");
    const isHome = (path) => /^\/library\/home\/?$/.test(path || "");
    const isCollections = (path) => /^\/library\/collections\/?$/.test(path || "");

    let tries = 0;
    const hookHistory = () => {
        const h = findHistory();
        if (!h) { if (++tries < 30) setTimeout(hookHistory, 1000); return; }
        let path = h.location.pathname, app = appOf(path);
        h.listen((loc) => {
            const now = (loc && loc.pathname) || h.location.pathname;
            const next = appOf(now);
            if (next && app && next !== app) onAppChange();
            else if (isCollection(now) && now !== path) onCollection();
            else if (isHome(now) && now !== path) onHome();
            else if (isCollections(now) && now !== path) onCollections();
            app = next;
            path = now;
        });
    };
    hookHistory();

    // rows are reused: drop the classes once played
    document.addEventListener("animationend", (e) => {
        const cl = e.target.classList;
        if (!cl) return;
        if (cl.contains("lm-row-in") && e.animationName === "lm-row-in") cl.remove("lm-row-in");
        if (cl.contains("lm-row-up") && e.animationName === "lm-row-up") cl.remove("lm-row-up");
        if (cl.contains("lm-cap-in") && e.animationName === "lm-cap-in") cl.remove("lm-cap-in");
    }, true);
})();
