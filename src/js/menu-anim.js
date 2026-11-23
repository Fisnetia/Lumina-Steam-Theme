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

    const findMenu = () =>
        document.documentElement.classList.contains("ContextMenuPopup")
            ? document.querySelector(".contextMenu")
            : null;

    /* ---- restart a skipped open animation ---- */

    const restartStuck = () => {
        const menu = findMenu();
        if (!menu || !menu.classList.contains("ready")) return;
        const els = [menu, ...menu.querySelectorAll(".contextMenuItem")];
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

    const W = window.SteamClient && window.SteamClient.Window;
    if (W && typeof W.HideWindow === "function") {
        const realHide = W.HideWindow;

        W.HideWindow = function (...args) {
            const menu = findMenu();
            const ms = menu && document.visibilityState === "visible" ? closeDuration(menu) : 0;
            if (!ms) return realHide.apply(this, args);

            clearTimeout(timer);
            menu.classList.add("lm-closing");
            timer = setTimeout(() => {
                timer = 0;
                if (menu.classList.contains("ready")) {
                    menu.classList.remove("lm-closing");   // re-opened meanwhile
                    return;
                }
                realHide.apply(this, args);
            }, ms);
        };
    }

    // reopened: drop the closing state
    new MutationObserver(() => {
        const menu = findMenu();
        if (menu && menu.classList.contains("ready") && menu.classList.contains("lm-closing")) {
            clearTimeout(timer);
            timer = 0;
            menu.classList.remove("lm-closing");
        }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] });

    /* ---- number items for the cascade (--lm-i, --lm-n) ---- */

    /* runs before paint, so the values are set when the animation starts */
    const numberItems = (menu) => {
        const items = menu.querySelectorAll(".contextMenuItem");
        items.forEach((it, i) => {
            it.style.setProperty("--lm-i", String(i));
            it.style.setProperty("--lm-n", String(items.length));
        });
    };

    new MutationObserver(records => {
        for (const rec of records) {
            const el = rec.target;
            if (!el.classList || !el.classList.contains("contextMenu") || !el.classList.contains("ready")) continue;
            if (!(rec.oldValue || "").split(/\s+/).includes("ready")) numberItems(el);
        }
    }).observe(document.documentElement, {
        subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"],
    });

    /* ---- close animation for in-window menus ---- */

    /* Steam removes these menus from the DOM. A copy without .ready is put back
       in place to play .lm-closing, then removed. */
    if (!document.documentElement.classList.contains("ContextMenuPopup")) {
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
                    if (n.nodeType === 1 && n.classList.contains("contextMenu") && n.classList.contains("ready")) {
                        ghost(n, rec.target, rec.nextSibling);
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
})();
