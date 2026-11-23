/*
 * Liquid glass (Game list: Liquid glass, css/conditions/list-liquid.css).
 *
 * Panel edges refract the backdrop: an SVG feDisplacementMap, used as
 * backdrop-filter: url(#id), reads a map drawn for the panel's size and corner
 * radius. Within a bevel along the edge, pixels sample the backdrop from
 * further inside, strongest at the rim, so it bends like a thick pane. The
 * offset stays under half the bevel, so sampling never folds back on itself
 * (a fold shows as a seam inside the bevel).
 *
 * Two panes: the game list (map redrawn after the column is resized) and the
 * in-page menu panel of js/morph-nav.js (redrawn every frame while it morphs;
 * it is small). Each sets its ready class on <html> once its filter exists.
 */
(() => {
    if (window.__lmLiquid) return;
    window.__lmLiquid = true;

    const html = document.documentElement;
    if (!html.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const NS = "http://www.w3.org/2000/svg";
    const RES = 0.5;   // map resolution

    let on = false;
    const enabled = () => {   // empty while stylesheets reload: keep the last value
        const v = getComputedStyle(html).getPropertyValue("--lm-liquid").trim();
        if (v) on = v === "1";
        return on;
    };

    // RG = displacement (128 is none), pointing inward near the rounded edge
    const drawMap = (W, H, R, bevelPx) => {
        const w = Math.max(1, Math.round(W * RES)), h = Math.max(1, Math.round(H * RES));
        const r = Math.min(R * RES, w / 2, h / 2), bevel = bevelPx * RES;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
                const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
                const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy);
                const inside = r - (out + Math.min(Math.max(qx, qy), 0));   // distance to the edge
                let nx = 0, ny = 0;
                if (out > 0) { nx = ox / out; ny = oy / out; } else if (qx > qy) nx = 1; else ny = 1;
                nx *= Math.sign(px); ny *= Math.sign(py);
                const t = inside < bevel ? 1 - Math.max(inside, 0) / bevel : 0;
                const s = t * t * 127;
                const i = (y * w + x) * 4;
                d[i] = 128 - nx * s; d[i + 1] = 128 - ny * s; d[i + 2] = 128; d[i + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
        return c.toDataURL();
    };

    let svg = null;
    const filterHost = () => {
        if (!svg) {
            svg = document.createElementNS(NS, "svg");
            svg.setAttribute("aria-hidden", "true");
            svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
            document.body.appendChild(svg);
        }
        return svg;
    };

    // Refraction slider, 0-100 (50 by default); empty while stylesheets reload
    let strength = 50;
    const refraction = () => {
        const v = parseFloat(getComputedStyle(html).getPropertyValue("--lm-refraction"));
        if (!Number.isNaN(v)) strength = Math.min(Math.max(v, 0), 100);
        return strength;
    };

    // One refracting pane, its bevel width = Refraction x reach.
    // live: redraw on every size change (once per frame) instead of after
    // resizing settles.
    // scale: displacement at the rim is about scale / 2; with the t² profile,
    // up to 0.9 x bevel keeps the mapping monotonic.
    const pane = ({ selector, id, ready, reach, live }) => {
        let el = null, size = "", observer = null, pending = 0;

        const build = () => {
            pending = 0;
            if (!el || !el.isConnected) return;
            const W = Math.round(el.offsetWidth), H = Math.round(el.offsetHeight);
            const R = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
            const bevel = Math.max(1, Math.round(refraction() * reach));
            const scale = refraction() ? Math.round(bevel * 0.9) : 0;
            const key = `${W}x${H}r${R}b${bevel}s${scale}`;
            if (!W || !H || key === size) return;
            size = key;
            let f = filterHost().querySelector("#" + id);
            if (!f) { f = document.createElementNS(NS, "filter"); f.id = id; filterHost().appendChild(f); }
            for (const [k, v] of Object.entries({ x: 0, y: 0, width: W, height: H, filterUnits: "userSpaceOnUse",
                primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) f.setAttribute(k, v);
            f.innerHTML =
                `<feImage href="${drawMap(W, H, R, bevel)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="map"/>` +
                `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
            html.classList.add(ready);
        };

        const schedule = () => {
            if (live) { if (!pending) pending = requestAnimationFrame(build); }
            else { clearTimeout(pending); pending = setTimeout(build, 80); }
        };

        const detach = () => {
            if (observer) observer.disconnect();
            observer = null; el = null; size = "";
            html.classList.remove(ready);
        };

        // also a fallback for size changes the observer missed (e.g. while hidden)
        const sync = () => {
            if (!enabled()) { if (el || html.classList.contains(ready)) detach(); return; }
            const found = document.querySelector(selector);
            if (found && found === el) { build(); return; }
            if (!found) return;
            detach();
            el = found;
            observer = new ResizeObserver(schedule);
            observer.observe(el);
            build();
        };

        return { sync };
    };

    const panes = [
        pane({ selector: "{{GameListHomeAndSearch.Container}}", id: "lm-liquid", ready: "lm-liquid-ready",
               reach: 0.92, live: false }),   // 46px at 50%
        pane({ selector: ".lm-morph.lm-morph-inpage", id: "lm-liquid-menu", ready: "lm-liquid-menu-ready",
               reach: 0.56, live: true }),    // 28px at 50%
    ];

    // the library mounts and unmounts the list; the menu panel appears on first use;
    // the settings can change any time
    const syncAll = () => panes.forEach(p => p.sync());
    syncAll();
    setInterval(syncAll, 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncAll(); });
})();
