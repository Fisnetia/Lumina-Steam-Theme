/*
 * Liquid glass (Game list: Liquid glass, css/conditions/list-liquid.css).
 *
 * Panel edges refract the backdrop: an SVG feDisplacementMap, used as
 * backdrop-filter: url(#id), reads a map drawn for the panel's size and corner
 * radius. Within a bevel along the edge, pixels sample the backdrop from
 * further inside, strongest at the rim, so it bends like a thick pane. The
 * offset stays under half the bevel, so sampling never folds back on itself
 * (a fold shows as a seam inside the bevel). Red, green and blue are offset
 * by slightly different amounts, and a thin band at the rim is brightened,
 * which gives the edge a faint fringe coloured by the backdrop.
 *
 * Panes: the game list, the in-page menu panel of js/morph-nav.js, the
 * bottom bar capsules and the title bar capsules. Each sets its ready class
 * on <html> once its filter exists.
 */
(() => {
    if (window.__lmLiquid) return;
    window.__lmLiquid = true;

    const html = document.documentElement;
    if (!html.classList.contains("MillenniumWindow_MainSteamWindow")) return;

    const NS = "http://www.w3.org/2000/svg";
    const RES = 0.5;   // map resolution

    // Settings, read once per check from the stylesheets; empty while they
    // reload, so the last values are kept
    let on = false, strength = 50, settings = "";
    const readSettings = () => {
        const cs = getComputedStyle(html);
        const v = cs.getPropertyValue("--lm-liquid").trim();
        if (v) on = v === "1";
        const r = parseFloat(cs.getPropertyValue("--lm-refraction"));   // 0-100, 50 by default
        if (!Number.isNaN(r)) strength = Math.min(Math.max(r, 0), 100);
        const key = `${on}|${strength}|${cs.getPropertyValue("--lm-radius").trim()}`;
        const changed = key !== settings;
        settings = key;
        return changed;
    };

    const RIM = 4;     // width of the coloured rim, px

    // RG = displacement (128 is none), pointing inward near the rounded edge;
    // B = the rim band, strongest at the edge
    const drawMap = (W, H, R, bevelPx) => {
        const w = Math.max(1, Math.round(W * RES)), h = Math.max(1, Math.round(H * RES));
        const r = Math.min(R * RES, w / 2, h / 2), bevel = bevelPx * RES, rim = RIM * RES;
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
                const k = inside < rim ? 1 - Math.max(inside, 0) / rim : 0;
                const i = (y * w + x) * 4;
                d[i] = 128 - nx * s; d[i + 1] = 128 - ny * s; d[i + 2] = Math.round(k * k * 255); d[i + 3] = 255;
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

    // Dispersion: red, green and blue are displaced by decreasing amounts and
    // added back together, which leaves a thin colour fringe at the rim. Red
    // takes the full scale, so no channel passes the monotonic limit. The
    // channels are added with alpha 1, then the sum takes the red pass's alpha.
    const SPREAD = 0.14;
    const displace = (scale, result) =>
        `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
    const channel = (src, row, result) => {
        const rows = ["0 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0"];
        rows[row] = ["1 0 0 0 0", "0 1 0 0 0", "0 0 1 0 0"][row];
        return `<feColorMatrix in="${src}" type="matrix" values="${rows.join(" ")} 0 0 0 0 1" result="${result}"/>`;
    };
    const add = (a, b, result) =>
        `<feComposite in="${a}" in2="${b}" operator="arithmetic" k2="1" k3="1" result="${result}"/>`;
    const dispersion = (scale) => {
        if (!scale) return displace(0, "body");
        const s = [scale, scale * (1 - SPREAD), scale * (1 - 2 * SPREAD)].map(v => v.toFixed(1));
        return displace(s[0], "dr") + displace(s[1], "dg") + displace(s[2], "db") +
            channel("dr", 0, "r") + channel("dg", 1, "g") + channel("db", 2, "b") +
            add("r", "g", "rg") + add("rg", "b", "rgb") +
            `<feComposite in="rgb" in2="dr" operator="in" result="body"/>`;
    };

    // Coloured rim: within the band in the map's B channel, the refracted
    // backdrop is saturated (2.2x), brightened (1.25x) and tinted slightly
    // blue in one combined color matrix.
    const rimLight =
        `<feColorMatrix in="map" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="band"/>` +
        `<feColorMatrix in="body" type="matrix" values="2.4305 -1.0725 -0.108 0 0.02  -0.3195 1.6775 -0.108 0 0.03  -0.3195 -1.0725 2.642 0 0.07  0 0 0 1 0" result="lit"/>` +
        `<feComposite in="lit" in2="band" operator="in" result="edge"/>` +
        `<feComposite in="edge" in2="body" operator="over"/>`;

    // One refracting pane, its bevel width = Refraction x reach.
    // scale: displacement at the rim is about scale / 2; with the t² profile,
    // up to 0.9 x bevel keeps the mapping monotonic.
    // While the pane resizes, the last map is stretched to the new size, which
    // only changes a few attributes; drawing and decoding a map every frame
    // drops frames. The map is redrawn once the size settles.
    const SETTLE = 120;
    const pane = ({ selector, id, ready, reach, skip, disperse = true }) => {
        let el = null, size = "", observer = null, pending = 0;

        const stretch = () => {
            const f = document.getElementById(id), img = f && f.firstElementChild;
            if (!img) return false;
            const W = Math.round(el.offsetWidth), H = Math.round(el.offsetHeight);
            if (!W || !H) return true;
            f.setAttribute("width", W); f.setAttribute("height", H);
            img.setAttribute("width", W); img.setAttribute("height", H);
            return true;
        };

        const build = () => {
            pending = 0;
            if (!el || !el.isConnected) return;
            const W = Math.round(el.offsetWidth), H = Math.round(el.offsetHeight);
            const R = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
            const bevel = Math.max(1, Math.round(strength * reach));
            const scale = strength ? Math.round(bevel * 0.9) : 0;
            const key = `${W}x${H}r${R}b${bevel}s${scale}`;
            if (!W || !H || key === size) return;
            size = key;
            let f = filterHost().querySelector("#" + id);
            if (!f) { f = document.createElementNS(NS, "filter"); f.id = id; filterHost().appendChild(f); }
            for (const [k, v] of Object.entries({ x: 0, y: 0, width: W, height: H, filterUnits: "userSpaceOnUse",
                primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) f.setAttribute(k, v);
            const refr = disperse ? dispersion(scale) : displace(scale ? scale.toFixed(1) : 0, "body");
            f.innerHTML =
                `<feImage href="${drawMap(W, H, R, bevel)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="map"/>` +
                refr + rimLight;
            html.classList.add(ready);
        };

        // runs after layout, before paint, so the stretched map lands in the same frame
        const schedule = () => {
            if (!el || !el.isConnected) return;
            clearTimeout(pending);
            if (stretch()) pending = setTimeout(build, SETTLE);
            else build();
        };

        const detach = () => {
            if (observer) observer.disconnect();
            clearTimeout(pending);
            observer = null; el = null; size = ""; pending = 0;
            html.classList.remove(ready);
        };

        // finds the element; sizes come from the ResizeObserver, so a mounted
        // pane is rebuilt only when asked (settings changed, window shown)
        const sync = (rebuild) => {
            if (!on || (skip && skip())) { if (el || html.classList.contains(ready)) detach(); return; }
            if (!rebuild && el && el.isConnected) return;
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
               reach: 0.92, skip: () => html.classList.contains("lm-gl-panes") }),   // 46px at 50%
        pane({ selector: ".lm-morph.lm-morph-inpage", id: "lm-liquid-menu", ready: "lm-liquid-menu-ready",
               reach: 0.56 }),    // 28px at 50%
        // bottom bar capsules (36px tall, 6 primitives over scrolling content)
        // and title bar capsules (32px, full RGB dispersion)
        ...[["{{BottomBarContainer.AddGameButton}}", "add", false],
            ["{{BottomBarContainer.DownloadStatus}}", "dl", false],
            ["{{BottomBarContainer.FriendsButton}}", "friends", false],
            ["{{ForceOpaqueBackground.TitleBar}} > {{ForceOpaqueBackground.RootMenuBar}}", "menus", true],
            ["{{ForceOpaqueBackground.SuperNavBar}}", "nav", true],
            ["{{ForceOpaqueBackground.TitleBar}} > {{ForceOpaqueBackground.TitleBarControls}}", "controls", true],
            [".title-bar-actions", "window", true],
            ["{{ForceOpaqueBackground.BrowserWrapper}} {{ForceOpaqueBackground.URLBar}}", "url", true]].map(([selector, name, disperse]) =>
            pane({ selector, id: `lm-liquid-${name}`, ready: `lm-liquid-${name}-ready`,
                   reach: 0.24, disperse })),   // 12px at 50%
    ];

    // the library mounts and unmounts the list; the menu panel appears on
    // first use; the sliders change variables without reloading stylesheets
    const syncAll = (force) => {
        const rebuild = readSettings() || force;
        panes.forEach(p => p.sync(rebuild));
    };
    syncAll(true);
    setInterval(() => { if (!document.hidden) syncAll(false); }, 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncAll(true); });
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") syncAll(true); }, true);
})();
