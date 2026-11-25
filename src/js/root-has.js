/*
 * Steam's stylesheet sets its colour scales on :root through rules like
 * :root:has(<root container> > div[data-accent-color="blue"]). The condition
 * depends on the root container's children, so each popup, tooltip or modal
 * added there re-evaluates it and restyles the whole page.
 *
 * Here those selectors lose their :root:has() part (the [data-...] part for
 * the elements themselves stays), and the declarations whose condition holds
 * now go into one :root rule of the same specificity. It is rebuilt when the
 * container's children change their data-* attributes or new stylesheets load.
 * Main window only: the other windows share its renderer, and each rewrite
 * rebuilds the stylesheet's rule set.
 */
(() => {
    if (window.__lmRootHas) return;
    window.__lmRootHas = true;
    if (!document.documentElement.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const PREFIX = ":root:has(";
    const rules = [];   // { test: selector inside :has(), css: declarations }
    const seen = new WeakSet();

    // split a selector list on top-level commas
    const split = (text) => {
        const out = [];
        let depth = 0, start = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "(") depth++;
            else if (c === ")") depth--;
            else if (c === "," && !depth) { out.push(text.slice(start, i).trim()); start = i + 1; }
        }
        out.push(text.slice(start).trim());
        return out;
    };

    const scan = () => {
        let found = false;
        for (const sheet of document.styleSheets) {
            if (seen.has(sheet)) continue;
            let list;
            try { list = sheet.cssRules; } catch { continue; }   // cross-origin
            seen.add(sheet);
            for (const rule of list) {
                const sel = rule.selectorText;
                if (!sel || !sel.startsWith(PREFIX)) continue;
                const parts = split(sel);
                const has = parts.filter(p => p.startsWith(PREFIX) && p.endsWith(")"));
                const rest = parts.filter(p => !has.includes(p));
                if (!has.length || !rest.length) continue;   // keep rules that only exist for :root
                for (const p of has) rules.push({ test: p.slice(PREFIX.length, -1), css: rule.style.cssText });
                rule.selectorText = rest.join(", ");
                found = true;
            }
        }
        return found;
    };

    // :root plus one class, one attribute and one type selector: the
    // specificity of :root:has(.container > div[data-...])
    const style = document.createElement("style");
    style.id = "lm-root-has";
    let last = "";
    const apply = () => {
        let css = "";
        for (const r of rules) {
            try { if (document.querySelector(r.test)) css += r.css; } catch {}
        }
        if (css === last) return;
        last = css;
        style.textContent = css ? `:root:not(.lm-x):not([data-lm-x]):not(lm-x) { ${css} }` : "";
        if (!style.isConnected) document.head.appendChild(style);
    };

    // the root container's children carry the colour attributes
    const attrs = new MutationObserver(apply);
    let watched = null;
    const watch = () => {
        const tests = rules.map(r => r.test.split(">")[0].trim()).filter(Boolean);
        const container = tests.length ? document.querySelector(tests[0]) : null;
        if (!container || container === watched) return;
        watched = container;
        attrs.disconnect();
        attrs.observe(container, { childList: true, subtree: false });
        for (const child of container.children) {
            attrs.observe(child, { attributes: true, attributeFilter: ["data-accent-color", "data-dull-color", "data-body-text-color"] });
        }
    };

    const refresh = () => {
        scan();
        if (!rules.length) return;
        watch();
        apply();
    };
    refresh();
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") refresh(); }, true);
    setInterval(() => { if (!document.hidden) refresh(); }, 2000);   // the container is re-created when the UI re-mounts
})();
