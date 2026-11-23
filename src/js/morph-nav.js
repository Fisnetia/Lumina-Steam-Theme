/*
 * Morphing nav menu: one glass panel shared by the supernav menus (Store,
 * Library, Community, profile). Moving between them resizes and slides the
 * panel; its pages cross-fade in the direction of travel.
 *
 * Two surfaces, chosen when the panel opens:
 * - in-page: the panel is an element in the main window with a real
 *   backdrop-filter, used over Steam-rendered pages (library, settings).
 * - host: over embedded web views (Store, Community), which cover anything in
 *   the main window, the panel is drawn in Steam's Store supernav popup, moved
 *   below the nav bar. A separate window can't blur, so it gets a frosted fill.
 *
 * Hover on nav items is kept from React (window capture), so Steam's own
 * popups never open. Items are read from the hidden popups on every open and
 * clicks are forwarded to them, so Steam still does the navigation. If a menu
 * can't be read, the native popups are left alone.
 *
 * The same panel also replaces the title bar menus (Steam, View, ...) and the
 * account menu, which open on click instead of hover.
 */
(() => {
    if (window.__lmMorphNav) return;
    window.__lmMorphNav = true;

    const html = document.documentElement;
    if (!html.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const HOST_TITLE = "Store Supernav";
    const CLOSE_DELAY = 160, FADE = 160, SHIFT = 260, GAP = 6, MARGIN = 28;
    // nav-morph.css sets 1, nav-native.css 0; empty while the theme's
    // stylesheets reload, then the last value holds
    let morphOn = false;
    const enabled = () => {
        const v = getComputedStyle(html).getPropertyValue("--lm-morph-nav").trim();
        if (v) morphOn = v === "1";
        return morphOn;
    };

    /* ---- Steam's menus ---- */

    const popups = () => { try { return [...window.opener.g_PopupManager.GetPopups()]; } catch { return []; } };
    const popupWindow = (title) => { const p = popups().find(p => p.m_strTitle === title); return p && p.window; };

    /* Menus taken over, by their popup's title:
     * - nav: "Store Supernav" etc., open on hover
     * - bar: "Steam Root Menu" etc. (title bar), open on click; while one is
     *   open, hovering another switches to it
     * - click: "Account Menu", open on click */
    const WRAPPERS = ".SuperNavMenu, .RootMenuButton, .MenuWrapper";
    const kindOf = (title) => /Supernav$/.test(title) ? "nav" : /Root Menu$/.test(title) ? "bar" : "click";

    // The popup's title from the wrapper's React props; null if not one of ours.
    const popupTitle = (wrapper) => {
        const key = Object.keys(wrapper).find(k => k.startsWith("__reactFiber"));
        for (let f = key && wrapper[key], i = 0; f && i < 6; f = f.return, i++) {
            const p = f.memoizedProps;
            if (!p || typeof p.title !== "string") continue;
            if (/Supernav$/.test(p.title)) return p.menuItems ? p.title : null;   // nav items without a menu
            if (/Root Menu$|^Account Menu$/.test(p.title)) return p.title;
        }
        return null;
    };

    /* Millennium adds its two Steam menu items when the menu renders after its
     * patch is in place. Steam may render the menu before that, and the
     * native menu, which would render it again, never opens here; the items
     * are then added the same way, before Exit. A detached element stands in
     * for each, so a click reaches it like a real item. */
    const opener = () => { try { return window.opener; } catch { return null; } };
    const millenniumItems = () => {
        const o = opener();
        if (!o || !o.Millennium || !o.SteamUIStore || !o.SteamClient) return [];
        const make = (text, run) => {
            const el = document.createElement("div");
            el.textContent = text;
            el.addEventListener("click", run);
            return { item: el };
        };
        return [
            make("Millennium", () => o.SteamUIStore.Navigate("/millennium/settings")),
            make("Millennium Library Manager", () => o.SteamClient.URL.ExecuteSteamURL("steam://millennium/sidebar")),
            { separator: true },
        ];
    };

    /* "View Friends List (N Online)": Steam fills in N when the menu renders,
     * before friends have loaded, and the native menu never renders again
     * here. A stand-in shows the live count; a click goes to the real item. */
    const onlineCount = () => {
        try { return opener().g_FriendsUIApp.m_FriendStore.GetOnlineFriendCount(); } catch { return null; }
    };
    const withOnlineCount = (entry) => {
        const real = entry.item, n = onlineCount();
        if (typeof n !== "number" || !/\d/.test(real.textContent)) return entry;
        const el = document.createElement("div");
        el.textContent = real.textContent.replace(/\d+/, String(n));
        el.addEventListener("click", () => real.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
        return { item: el };
    };

    // [{ item: Element } | { separator: true }] in menu order
    const entries = (title) => {
        const w = popupWindow(title), box = w && w.document.querySelector(".contextMenuContents");
        if (!box) return [];
        const list = [...box.querySelectorAll(".contextMenuItem, [class*='Separator']")]
            .filter(el => el.classList.contains("contextMenuItem") || !el.closest(".contextMenuItem"))
            .map(el => el.classList.contains("contextMenuItem") ? { item: el } : { separator: true });
        const items = list.filter(e => e.item);
        if (title === "Friends Root Menu" && items.length) list[list.indexOf(items[0])] = withOnlineCount(items[0]);
        if (title === "Steam Root Menu" && items.length &&
            !items.some(e => e.item.textContent.includes("Millennium"))) {
            list.splice(list.lastIndexOf(items[items.length - 1]), 0, ...millenniumItems());
        }
        return list;
    };

    // the menus of one kind, which share a panel area
    const menus = (kind) => [...document.querySelectorAll(WRAPPERS)]
        .map(wrapper => ({ wrapper, title: popupTitle(wrapper) }))
        .filter(n => n.title && kindOf(n.title) === kind);

    // nav menus hang centered under their item, the title bar's from its left
    // edge, the account menu (far right) from its right edge
    const panelX = (kind, r, w) => {
        const x = kind === "nav" ? r.left + r.width / 2 - w / 2 : kind === "bar" ? r.left : r.right - w;
        return Math.min(Math.max(8, x), innerWidth - w - 8);
    };

    /* ---- surfaces ---- */

    const makePanel = (doc) => {
        const panel = doc.createElement("div");
        panel.className = "lm-morph";
        panel.setAttribute("role", "menu");
        return panel;
    };

    const inPage = { doc: document, panel: makePanel(document), origin: { left: 0, top: 0 } };
    inPage.panel.classList.add("lm-morph-inpage");

    let host = null;   // { doc, win, panel, origin, rect }

    const getHost = () => {
        const win = popupWindow(HOST_TITLE);
        if (!win || !win.SteamClient || !win.SteamClient.Window) return null;
        if (!host || host.win !== win) {
            const doc = win.document;
            host = { win, doc, panel: makePanel(doc), origin: { left: 0, top: 0 }, rect: null };
            const panel = host.panel;
            doc.addEventListener("mouseover", (e) => {
                if (panel.contains(e.target)) clearTimeout(closeTimer); else if (hovering()) close(false);
            }, true);
            // keep cancelling while over the panel: the main window's events may arrive later
            doc.addEventListener("mousemove", (e) => { if (panel.contains(e.target)) clearTimeout(closeTimer); }, true);
            doc.addEventListener("mouseout", (e) => { if (!e.relatedTarget && hovering()) close(false); }, true);
            doc.addEventListener("mousedown", (e) => { if (!panel.contains(e.target)) close(true); }, true);
            doc.addEventListener("keydown", (e) => { if (e.key === "Escape") close(true); }, true);
            // the open animation may have run while the window was still hidden
            doc.addEventListener("visibilitychange", () => {
                if (doc.visibilityState === "visible" && current && surface === host) replayOpen(panel);
            });
        }
        return host;
    };

    const replayOpen = (panel) => {
        const els = [panel, ...panel.querySelectorAll(".lm-first .lm-morph-item")];
        els.forEach(e => { e.style.animationName = "none"; });
        void panel.offsetWidth;   // apply "none" before restoring
        els.forEach(e => { e.style.animationName = ""; });
    };

    // Embedded web view (Store, Community) under the panel area?
    const overWebView = (rect) => [...document.querySelectorAll(".BrowserWrapper, .Browser")].some(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < rect.top + rect.height && r.bottom > rect.top
            && r.left < rect.left + rect.width && r.right > rect.left;
    });

    // Union of every menu's panel position, in main-window px.
    const panelArea = (sizes) => {
        let left = Infinity, right = -Infinity, bottom = 0, top = Infinity;
        for (const { wrapper, title, w, h } of sizes) {
            const r = wrapper.getBoundingClientRect();
            const x = panelX(kindOf(title), r, w);
            left = Math.min(left, x); right = Math.max(right, x + w);
            top = Math.min(top, r.bottom); bottom = Math.max(bottom, r.bottom + GAP + h);
        }
        return {
            left: Math.max(0, Math.floor(left - MARGIN)), top: Math.floor(top),
            width: Math.ceil(right - left + 2 * MARGIN), height: Math.ceil(bottom - top + MARGIN),
        };
    };

    const showHost = (area) => {
        const W = host.win.SteamClient.Window;
        const same = host.rect && ["left", "top", "width", "height"].every(k => host.rect[k] === area[k]);
        if (!same) {
            W.MoveTo(window.screenX + area.left, window.screenY + area.top, true);
            W.ResizeTo(area.width, area.height, true);
            host.rect = area;
        }
        host.origin = { left: area.left, top: area.top };
        clearTimeout(host.unhost);
        host.doc.documentElement.classList.add("lm-morph-host");
        if (!host.panel.isConnected) host.doc.body.appendChild(host.panel);
        host.shown = true;
        W.ShowWindow();
    };

    // Steam's own menu stays hidden until the window really is (the hide can be delayed).
    const hideHost = () => {
        const h = host;
        const unhost = () => {
            clearTimeout(h.unhost);
            if (current && surface === h) return;
            h.doc.documentElement.classList.remove("lm-morph-host");
            h.panel.replaceChildren();
            h.rect = null;
        };
        h.doc.addEventListener("visibilitychange", function once() {
            if (h.doc.visibilityState === "hidden") { h.doc.removeEventListener("visibilitychange", once); unhost(); }
        });
        h.unhost = setTimeout(unhost, 600);
        h.shown = false;
        h.win.SteamClient.Window.HideWindow();
    };

    /* ---- geometry (one clock for position and size) ---- */

    // CSS cubic-bezier(0.3, 0.7, 0.2, 1) as a function of time 0..1
    const ease = (() => {
        const bez = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
        return (x) => {
            let lo = 0, hi = 1, t = x;
            for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (bez(t, 0.3, 0.2) < x) lo = t; else hi = t; }
            return bez(t, 0.7, 1);
        };
    })();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");

    let surface = null;   // inPage or host while open
    let geom = null, tween = 0;

    const applyGeom = (g) => {
        const p = surface.panel.style, o = surface.origin;
        p.setProperty("--lm-mx", g.x - o.left + "px");
        p.setProperty("--lm-my", g.y - o.top + "px");
        p.setProperty("--lm-mw", g.w + "px");
        p.setProperty("--lm-mh", g.h + "px");
    };

    // Retargets from wherever the panel is now.
    const moveTo = (to, instant) => {
        cancelAnimationFrame(tween);
        if (instant || !geom || reduced.matches) { geom = to; applyGeom(to); return; }
        const from = { ...geom }, t0 = performance.now();
        const step = (now) => {
            const k = ease(Math.min(1, (now - t0) / SHIFT));
            geom = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k,
                     w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k };
            applyGeom(geom);
            if (k < 1) tween = requestAnimationFrame(step);
        };
        tween = requestAnimationFrame(step);
    };

    const placePanel = (wrapper, title, w, h, instant) => {
        const r = wrapper.getBoundingClientRect();
        moveTo({ x: Math.round(panelX(kindOf(title), r, w)), y: Math.round(r.bottom + GAP), w, h }, instant);
    };

    /* ---- panel ---- */

    let current = null;   // { wrapper, title, kind, page }

    const setCurrent = (next) => {
        if (current && current.wrapper !== (next && next.wrapper)) current.wrapper.classList.remove("lm-menu-active");
        current = next;
        if (current && current.kind !== "nav") current.wrapper.classList.add("lm-menu-active");
        // A press on a window drag area never reaches the page, so drag areas
        // are lifted while a click menu is open (css/base.css).
        html.classList.toggle("lm-click-menu", !!current && current.kind !== "nav");
    };
    let closeTimer = 0, hideTimer = 0;

    // Items are numbered for the open cascade (--lm-i, --lm-n), as in js/menu-anim.js.
    const buildPage = (doc, title, list) => {
        const page = doc.createElement("div");
        page.className = "lm-morph-page";
        const count = list.filter(e => e.item).length;
        let k = 0;
        list.forEach((e, i) => {
            if (e.separator) {
                page.appendChild(doc.createElement("div")).className = "lm-morph-sep";
                return;
            }
            const b = doc.createElement("button");
            b.type = "button";
            b.className = "lm-morph-item";
            b.setAttribute("role", "menuitem");
            b.style.setProperty("--lm-i", String(k++));
            b.style.setProperty("--lm-n", String(count));
            b.textContent = e.item.textContent.trim();
            if (e.item.querySelector("svg")) b.classList.add("lm-checked");   // e.g. the current friends status
            b.addEventListener("click", () => {
                const n = list.slice(0, i).filter(x => x.item).length;
                const target = entries(title).filter(x => x.item)[n];   // fresh lookup
                close(true);
                if (target) target.item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            });
            page.appendChild(b);
        });
        return page;
    };

    // Sizes of every menu's page, measured on a surface.
    const measure = (s, navs) => navs.map(n => {
        const list = entries(n.title);
        const page = buildPage(s.doc, n.title, list);
        page.style.visibility = "hidden";
        if (!s.panel.isConnected) s.doc.body.appendChild(s.panel);
        s.panel.appendChild(page);
        const size = { ...n, list, w: page.offsetWidth, h: page.offsetHeight };
        page.remove();
        return size;
    }).filter(s => s.list.some(e => e.item));

    const open = (wrapper, title) => {
        clearTimeout(closeTimer);
        if (current && current.wrapper === wrapper) return true;
        const kind = kindOf(title);
        if (current && current.kind !== kind) close(true);   // morph only within one group

        if (!current) {
            clearTimeout(hideTimer);   // the last close's fade-out, if still pending
            const group = menus(kind);
            let next = inPage;
            let sizes = measure(inPage, group);
            if (overWebView(panelArea(sizes))) {
                if (!getHost()) return false;
                sizes = measure(host, group);
                next = host;
            }
            const mine = sizes.find(s => s.wrapper === wrapper);
            // The host is a real window: left shown, it takes the mouse even
            // when empty, so hide it unless this open reuses it.
            if (host && host.shown && (!mine || next !== host)) hideHost();
            if (!mine) return false;
            if (next === host) showHost(panelArea(sizes));
            surface = next;
            const page = buildPage(surface.doc, title, mine.list);
            page.classList.add("lm-first");   // only the first page cascades in
            surface.panel.replaceChildren(page);
            placePanel(wrapper, title, mine.w, mine.h, true);
            surface.panel.classList.add("open");
            setCurrent({ wrapper, title, kind, page });
            return true;
        }

        const items = entries(title);
        if (!items.some(e => e.item)) return false;
        const page = buildPage(surface.doc, title, items);
        surface.panel.appendChild(page);
        const w = page.offsetWidth, h = page.offsetHeight;
        const dir = wrapper.getBoundingClientRect().left > current.wrapper.getBoundingClientRect().left ? 1 : -1;
        surface.panel.querySelectorAll(".lm-morph-page.leave").forEach(p => p.remove());   // one leaving at most
        const old = current.page;
        old.style.setProperty("--lm-dir", dir);
        old.classList.add("leave");
        setTimeout(() => old.remove(), SHIFT);
        page.style.setProperty("--lm-dir", dir);
        page.classList.add("enter");
        void page.offsetWidth;
        page.classList.remove("enter");
        placePanel(wrapper, title, w, h);
        setCurrent({ wrapper, title, kind, page });
        return true;
    };

    function close(now) {
        clearTimeout(closeTimer);
        const done = () => {
            if (!current) return;
            const s = surface;
            s.panel.classList.remove("open");
            cancelAnimationFrame(tween);
            geom = null;
            setCurrent(null);
            hideTimer = setTimeout(() => {
                if (current && surface === s) return;
                if (s === host) hideHost(); else s.panel.replaceChildren();
            }, FADE);
        };
        if (now) done(); else closeTimer = setTimeout(done, CLOSE_DELAY);
    }

    /* ---- main window events ---- */

    const managed = (el) => {
        const wrapper = el && el.closest && el.closest(WRAPPERS);
        if (!wrapper) return null;
        const title = popupTitle(wrapper);
        return title ? { wrapper, title, kind: kindOf(title) } : null;
    };
    const readable = (m) => m && entries(m.title).some(x => x.item);

    // A native nav popup that opened anyway (a hover that reached React) never
    // gets its leave, since the handlers below hold back mouseout; send one.
    let synthetic = false;
    const closeNative = (except) => {
        document.querySelectorAll(".SuperNavMenu.MenuOpen").forEach(w => {
            if (w === except) return;   // still hovered: a deliberate fallback
            synthetic = true;
            try { w.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, relatedTarget: null })); }
            finally { synthetic = false; }
        });
    };

    // window capture runs before React's own document listeners
    const hovering = () => current && current.kind === "nav";

    window.addEventListener("mouseover", (e) => {
        if (!enabled()) return;
        closeNative(e.target.closest && e.target.closest(".SuperNavMenu"));
        const m = managed(e.target);
        if (m && m.kind === "nav") {
            if (open(m.wrapper, m.title)) e.stopImmediatePropagation();
        } else if (m && m.kind === "bar" && current && current.kind === "bar") {
            if (open(m.wrapper, m.title)) e.stopImmediatePropagation();   // switch along the title bar
        } else if (inPage.panel.contains(e.target)) {
            clearTimeout(closeTimer);
        } else if (hovering()) {
            close(false);   // click menus stay open until a click elsewhere
        }
    }, true);
    // React also derives "enter" from the mouseout of the element being left.
    // Leaving the window schedules a close; the host cancels it over its panel.
    window.addEventListener("mouseout", (e) => {
        if (synthetic) return;
        if (!e.relatedTarget && hovering()) close(false);
        const m = enabled() && (managed(e.target) || managed(e.relatedTarget));
        if (m && m.kind === "nav" && readable(m)) e.stopImmediatePropagation();
    }, true);

    // Click menus: open, or close if already open, before React sees the click.
    window.addEventListener("click", (e) => {
        const m = managed(e.target);
        if (m && m.kind === "nav") { if (current) close(true); return; }   // Steam navigates
        if (!m || !enabled() || !readable(m)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (current && current.wrapper === m.wrapper) close(true); else open(m.wrapper, m.title);
    }, true);
    // a press anywhere else closes a click menu (the host window has its own handler)
    window.addEventListener("mousedown", (e) => {
        if (!current || hovering()) return;
        if (surface === inPage && inPage.panel.contains(e.target)) return;
        const m = managed(e.target);
        if (m && m.kind === current.kind) return;   // the click handler toggles or switches
        close(true);
    }, true);
    window.addEventListener("blur", () => { if (current && !hovering() && surface === inPage) close(true); });
    document.addEventListener("keydown", (e) => { if (current && e.key === "Escape") close(true); }, true);

})();
