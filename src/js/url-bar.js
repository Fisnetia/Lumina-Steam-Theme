/*
 * URL bar capsule: animates its width when the address changes; with the
 * Always URL bar setting it stays over library pages too (below).
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

    // Over library and other Steam pages the hidden web view shows a
    // tracking page, data:text/html,...<!--tracking:<id>:/library/home-->;
    // with the Always URL bar setting its bar is shown there
    // (css/conditions/url-always.css). Its address is rewritten to
    // steam://library/home before paint, ahead of the width animation, and a
    // click (Steam copies the real address and shows "Copied!") leaves the
    // Steam path on the clipboard instead.
    const TRACKING = /^data:text\/html.*?tracking:[^:]*:(\/.*?)-->/;
    // the route, for the blank page shown before the first tracked one
    const route = () => {
        try { return (window.opener || window).SteamUIStore.WindowStore.MainWindowInstance.m_history.location.pathname; }
        catch { return ""; }
    };
    const steamPath = (text) => {
        if (!text.startsWith("data:text/html")) return null;
        let decoded = text;
        try { decoded = decodeURIComponent(text); } catch {}
        const m = TRACKING.exec(decoded);
        const path = m ? m[1] : route();
        return "steam:/" + (path || "/");
    };
    // Dismiss any open Steam tooltip on URL-bar status/reload icons before
    // CSS hides or disables pointer events on them (hiding skips mouseleave).
    const dismissTooltips = (bar) => {
        for (const el of bar.querySelectorAll("{{ForceOpaqueBackground.StatusIcon}}")) {
            el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
            el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
        }
    };
    const rewrite = (bar) => {
        const url = bar.querySelector("{{ForceOpaqueBackground.URL}}");
        if (!url) return;
        const path = steamPath(url.textContent);
        if (path) {
            const entered = !bar.dataset.lmSteamPath;
            for (const node of url.childNodes) if (node.nodeType === 3) node.nodeValue = "";
            if (url.firstChild && url.firstChild.nodeType === 3) url.firstChild.nodeValue = path;
            else url.prepend(path);
            bar.dataset.lmSteamPath = path;
            if (entered) dismissTooltips(bar);
        } else if (!url.textContent.startsWith("steam://")) {
            delete bar.dataset.lmSteamPath;
        }
    };
    const watchAddress = (bar) => {
        // created before the width animation's observer, so it runs first
        new MutationObserver(() => rewrite(bar)).observe(bar, { subtree: true, childList: true, characterData: true });
        rewrite(bar);
        bar.addEventListener("click", (e) => {
            const path = bar.dataset.lmSteamPath;
            if (path && e.target.closest("{{ForceOpaqueBackground.URLBarText}}")) {
                setTimeout(() => navigator.clipboard.writeText(path).catch(() => {}), 0);
            }
        });
    };

    // Pencil button: the address becomes an input; Enter goes there, Esc or
    // a click elsewhere cancels. Web addresses open in the main window's web
    // view; steam:// paths of Steam pages navigate there, other steam://
    // links run as Steam URLs.
    const shared = () => window.opener || window;
    const ROUTES = /^\/(library|downloads|console|media|settings|millennium|gameservers)(\/|$)/i;
    const go = (text) => {
        const v = text.trim();
        if (!v) return;
        const w = shared();
        try {
            const steam = /^steam:\/\/(.*)$/i.exec(v);
            if (steam) {
                const path = "/" + steam[1];
                if (ROUTES.test(path)) w.SteamUIStore.Navigate(path);
                else w.SteamClient.URL.ExecuteSteamURL(v);
                return;
            }
            const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
            w.SteamUIStore.WindowStore.MainWindowInstance.m_Navigator.SteamWeb(url);
        } catch {}
    };
    const PENCIL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z"/><path d="M9 4l3 3"/></svg>';
    const addEdit = (bar) => {
        const btn = document.createElement("div");
        btn.className = "lm-url-edit";
        btn.innerHTML = PENCIL;
        bar.append(btn);
        let input = null;
        const close = () => {
            if (!input) return;
            const el = input;
            input = null;
            el.remove();
            bar.classList.remove("lm-url-editing");
        };
        btn.addEventListener("mousedown", (e) => e.preventDefault());   // keeps the input focused
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (input) { close(); return; }
            const url = bar.querySelector("{{ForceOpaqueBackground.URL}}");
            input = document.createElement("input");
            input.className = "lm-url-input";
            input.spellcheck = false;
            input.value = url ? url.textContent : "";
            dismissTooltips(bar);
            bar.classList.add("lm-url-editing");
            btn.before(input);
            input.focus();
            input.select();
            input.addEventListener("keydown", (k) => {
                k.stopPropagation();
                if (k.key === "Enter") { const v = input.value; close(); go(v); }
                else if (k.key === "Escape") close();
            });
            input.addEventListener("blur", close);
        });
    };

    // Workaround for Millennium #1000: patch_css_classes appends the readable key
    // name to the @keyframes export, so Steam's onAnimationEnd check never matches
    // and the "Copied!" toast replays on every route change. Re-dispatch once with
    // the suffixed name if Steam did not clear the toast on its own.
    const CONFIRM = "{{FloatingConfirmation.FloatingConfirmation}}";
    const CONFIRM_ANIM = "{{FloatingConfirmation.FloatingConfirmationAnimation}}".replace(/^\./, "");
    document.addEventListener("animationend", (e) => {
        if (!e.isTrusted || e.animationName !== CONFIRM_ANIM) return;
        const el = e.target;
        if (!el || !el.matches || !el.matches(CONFIRM)) return;
        setTimeout(() => {
            if (!el.isConnected) return;
            el.dispatchEvent(new AnimationEvent("animationend", {
                animationName: CONFIRM_ANIM + " FloatingConfirmationAnimation",
                bubbles: true,
            }));
        }, 0);
    }, true);

    // web views mount their URL bar lazily
    const scan = () => document.querySelectorAll("{{ForceOpaqueBackground.URLBar}}:not([data-lm-url])").forEach((bar) => {
        watchAddress(bar);
        addEdit(bar);
        hook(bar);
    });
    scan();
    setInterval(() => { if (!document.hidden) scan(); }, 1000);
})();
