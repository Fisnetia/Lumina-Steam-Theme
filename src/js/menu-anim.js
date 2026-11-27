/*
 * Menu animation helpers for what CSS can't do alone:
 * - restart an open animation Chromium sometimes skips on a menu's first open
 * - delay a popup's HideWindow so the close animation can play
 * - number menu items for the cascade
 * - play the close animation for menus drawn inside a window (a copy of the
 *   removed node)
 */
(() => {
    if (window.__lmMenuAnim) return;
    window.__lmMenuAnim = true;

    let timer = 0;

    const POPUP = "{{contextMenu.ContextMenuPopup}}";
    const MENU = "{{contextMenu.contextMenu}}";
    const CONTENTS = "{{contextMenu.contextMenuContents}}";
    const ITEM = "{{contextMenu.contextMenuItem}}";
    const isPopup = () => document.documentElement.matches(POPUP);

    const findMenu = () => isPopup() ? document.querySelector(MENU) : null;

    /* ---- restart a skipped open animation ---- */

    const restartStuck = () => {
        const menu = findMenu();
        if (!menu || !menu.classList.contains("ready")) return;
        const els = [menu, ...menu.querySelectorAll(ITEM)];
        const stuck = els.filter(e =>
            getComputedStyle(e).animationName !== "none" && e.getAnimations().length === 0);
        if (!stuck.length) return;
        window.__lmMenuAnimRestarts = (window.__lmMenuAnimRestarts || 0) + 1;   // for tools/firstopen.py
        stuck.forEach(e => { e.style.animationName = "none"; });
        void menu.offsetWidth;   // apply "none" before restoring
        stuck.forEach(e => { e.style.animationName = ""; });
    };

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") requestAnimationFrame(restartStuck);
    });

    const closeDuration = (el) => {
        const raw = getComputedStyle(el).getPropertyValue("--lm-menu-close").trim();
        const n = parseFloat(raw);
        if (!n || n < 0) return 0;
        return raw.endsWith("ms") ? n : n * 1000;
    };

    /* ---- delay the hide for the close animation (popup windows) ---- */

    /* The hide is skipped only if the menu opens again (.ready added back)
     * while it closes. A menu that still has .ready when the hide starts, as
     * when Steam hides a menu it has just created, is closing, not reopened. */
    let reopened = false;
    const W = window.SteamClient && window.SteamClient.Window;
    if (W && typeof W.HideWindow === "function") {
        const realHide = W.HideWindow;

        W.HideWindow = function (...args) {
            const menu = findMenu();
            const ms = menu && document.visibilityState === "visible" ? closeDuration(menu) : 0;
            clearTimeout(timer);
            timer = 0;
            if (!ms) return realHide.apply(this, args);

            reopened = false;
            menu.classList.add("lm-closing");
            timer = setTimeout(() => {
                timer = 0;
                menu.classList.remove("lm-closing");
                if (!reopened) realHide.apply(this, args);
            }, ms);
        };
    }

    // reopened while closing: keep it shown
    new MutationObserver(records => {
        for (const rec of records) {
            const el = rec.target;
            if (!el.matches || !el.matches(MENU) || !el.classList.contains("lm-closing")) continue;
            const was = (rec.oldValue || "").split(/\s+/).includes("ready");
            if (!was && el.classList.contains("ready")) {
                reopened = true;
                clearTimeout(timer);
                timer = 0;
                el.classList.remove("lm-closing");
            }
        }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });

    /* ---- number items for the cascade (--lm-i, --lm-n) ---- */

    /* ---- direction ----
     * Popup menus hang from an anchor point (the pointer, or the tray icon).
     * One whose window ends at the anchor opens upward: its animations run
     * from the bottom (.lm-up). Steam keeps the anchor in the menu's props. */
    const anchorY = (menu) => {
        const el = menu.querySelector(CONTENTS) || menu;
        const key = Object.keys(el).find(k => k.startsWith("__reactFiber"));
        for (let f = key && el[key], i = 0; f && i < 16; f = f.return, i++) {
            const p = f.memoizedProps;
            if (p && typeof p.clientY === "number") return p.clientY;
        }
        return null;
    };

    const setDirection = (menu) => {
        if (!isPopup()) return;
        const y = anchorY(menu);
        if (y === null) return;
        const top = window.screenY, bottom = top + window.innerHeight;
        menu.classList.toggle("lm-up", Math.abs(bottom - y) < Math.abs(top - y));
    };

    // Steam may move the window after .ready, before showing it
    document.addEventListener("visibilitychange", () => {
        const menu = findMenu();
        if (document.visibilityState === "visible" && menu && menu.classList.contains("ready")) setDirection(menu);
    });

    /* runs before paint, so the values are set when the animation starts */
    const numberItems = (menu) => {
        setDirection(menu);
        const items = menu.querySelectorAll(ITEM);
        items.forEach((it, i) => {
            it.style.setProperty("--lm-i", String(i));
            it.style.setProperty("--lm-n", String(items.length));
        });
    };

    new MutationObserver(records => {
        for (const rec of records) {
            const el = rec.target;
            if (!el.matches || !el.matches(MENU) || !el.classList.contains("ready")) continue;
            if (!(rec.oldValue || "").split(/\s+/).includes("ready")) numberItems(el);
        }
    }).observe(document.documentElement, {
        subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"],
    });

    /* ---- Second click closes popup menus triggered from buttons ----
     * Steam opens these menus in a "Menu" popup and closes them when the
     * opener window takes focus back on mousedown; the click that follows
     * would immediately reopen the menu. Drop presses on the trigger while
     * the popup is shown or within REOPEN ms after focus returned from it. */
    const installToggleGuard = (buttonSelector, isMenuShown) => {
        const REOPEN = 400;
        let ours = false, closedAt = 0, dropping = false;

        // focus returns before the press reaches the button
        window.addEventListener("focus", () => {
            if (ours && isMenuShown()) closedAt = performance.now();
            ours = false;
        });

        const onButton = (e) => e.target instanceof Element && e.target.closest(buttonSelector);

        window.addEventListener("pointerdown", (e) => {
            if (!onButton(e) || e.button !== 0) return;
            dropping = (ours && isMenuShown()) || performance.now() - closedAt < REOPEN;
            if (dropping) { ours = false; closedAt = 0; e.stopPropagation(); e.preventDefault(); }
        }, true);
        for (const type of ["mousedown", "mouseup"]) {
            window.addEventListener(type, (e) => {
                if (dropping && onButton(e)) { e.stopPropagation(); e.preventDefault(); }
            }, true);
        }
        window.addEventListener("click", (e) => {
            if (!onButton(e)) return;
            if (dropping) { dropping = false; e.stopPropagation(); e.preventDefault(); return; }
            ours = true;
        }, true);
    };

    const getPopupManager = () => {
        try { return (window.opener && window.opener.g_PopupManager) || window.g_PopupManager || null; }
        catch { return null; }
    };

    if (document.documentElement.classList.contains("MillenniumWindow_MainSteamWindow")) {
        installToggleGuard("{{BottomBarContainer.AddGameButton}}", () => {
            try {
                const pm = getPopupManager();
                return !!pm && [...pm.GetPopups()].some(p =>
                    p.m_strTitle === "Menu" && p.window && p.window.document.visibilityState === "visible");
            } catch { return false; }
        });
    }

    if (document.documentElement.classList.contains("friendsui-container")) {
        installToggleGuard(".currentUserContainer .ContextMenuButton", () => {
            if (document.querySelector(".currentUserContextMenu")) return true;
            try {
                const pm = getPopupManager();
                return !!pm && [...pm.GetPopups()].some(p => {
                    const doc = p.window && p.window.document;
                    if (!doc || doc.visibilityState !== "visible") return false;
                    return !!doc.querySelector(".currentUserContextMenu") || p.m_strTitle === "Menu";
                });
            } catch { return false; }
        });
    }

    /* ---- close animation for in-window menus ---- */

    /* Steam removes these menus from the DOM. A copy without .ready is put back
       in place to play .lm-closing, then removed. */
    if (!isPopup()) {
        const ghost = (menu, parent, next) => {
            if (!parent.isConnected || menu.dataset.lmGhost) return;
            const ms = closeDuration(parent);
            if (!ms) return;
            const copy = menu.cloneNode(true);
            copy.dataset.lmGhost = "1";
            copy.classList.remove("ready");
            copy.classList.add("lm-closing");
            copy.setAttribute("aria-hidden", "true");
            parent.insertBefore(copy, next && next.parentNode === parent ? next : null);
            const done = () => copy.remove();
            copy.addEventListener("animationend", (e) => { if (e.target === copy) done(); });
            setTimeout(done, ms + 100);   // in case the animation never runs
        };

        new MutationObserver(records => {
            for (const rec of records) {
                for (const n of rec.removedNodes) {
                    if (n.nodeType === 1 && n.matches(MENU) && n.classList.contains("ready")) {
                        ghost(n, rec.target, rec.nextSibling);
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
})();
