/*
 * Aurora backdrop (css/conditions/backdrop-aurora.css): a WebGL shader behind
 * the main window, the friends list, dialog windows (Settings included) and
 * the login window, drawn at a quarter of the window's resolution and scaled
 * up, at most 30 frames a second, paused while the window is hidden. Bands of
 * light drift on value noise; the first takes the accent colour. The clock is
 * shared, so all windows show the same moment. Where WebGL is unavailable or
 * its context is lost, the stylesheet's static gradient stays.
 */
(() => {
    if (window.__lmAurora) return;
    window.__lmAurora = true;

    const html = document.documentElement;
    const isMain = html.classList.contains("MillenniumWindow_MainSteamWindow");
    if (html.matches("{{contextMenu.ContextMenuPopup}}")) return;
    const inBody = html.classList.contains("friendsui-container") || html.classList.contains("ModalDialogPopup");
    const FRAME = "{{ForceOpaqueBackground.OuterFrame}}";
    const LOGIN = "{{LoginStaticBackground}}";
    // the login window is told apart by its content, which renders late
    const host = () => isMain ? document.querySelector(FRAME)
        : document.querySelector(LOGIN) || (inBody ? document.body : null);
    const SCALE = 0.25, FPS = 30;

    const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
    const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 res;
uniform float t;
uniform vec3 c1, c2, c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}

// One curtain: a bright lower edge, vertical rays rising from it and fading,
// brightness varying along it; its colour turns toward c2 higher up.
vec3 band(vec2 uv, float aspect, float seed, float height, float tilt, vec3 color) {
    float x = uv.x * aspect;
    float sway = fbm(vec2(x * 0.55 + seed, t * 0.08 + seed * 4.0));
    float y0 = height + tilt * (uv.x - 0.5) + (sway - 0.5) * 0.42
             + 0.05 * sin(x * 1.3 + t * 0.35 + seed);
    float d = uv.y - y0;
    float folds = smoothstep(0.22, 0.70, fbm(vec2(x * 2.2 - t * 0.12, seed)));
    float rays = 0.35 + 0.65 * smoothstep(0.3, 0.8, fbm(vec2(x * 11.0 + t * 0.18 + seed * 9.0, seed * 2.0)));
    float below = exp(-max(-d, 0.0) * 35.0);
    float above = exp(-max(d, 0.0) * 2.0);
    float curtain = below * above * rays * folds;
    float rim = exp(-d * d * 220.0) * folds;
    float haze = exp(-d * d * 6.0) * (0.4 + 0.6 * folds);
    vec3 tint = mix(color, c2, smoothstep(0.0, 0.35, d));
    return tint * (curtain + rim * 0.6 + haze * 0.14);
}

void main() {
    vec2 uv = gl_FragCoord.xy / res;
    float aspect = res.x / res.y;
    vec3 col = mix(vec3(0.022, 0.028, 0.060), vec3(0.045, 0.056, 0.120), uv.y);
    col += band(uv, aspect, 0.0, 0.50, 0.18, c1) * 0.62;
    col += band(uv, aspect, 5.1, 0.70, -0.22, c3) * 0.34;
    col += band(uv, aspect, 9.7, 0.30, 0.12, c1) * 0.3;
    col += band(uv, aspect, 13.3, 0.84, 0.06, c2) * 0.26;
    // a little grain so the gradients don't band
    col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
}`;

    // the accent colour (#rgb, #rrggbb or rgb()) as rgb 0-1
    const parse = (v) => {
        let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
        if (m) {
            const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
            return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
        }
        m = v.match(/[\d.]+/g);
        return m && m.length >= 3 ? m.slice(0, 3).map(x => Math.min(1, +x / 255)) : null;
    };
    const accent = () => parse(getComputedStyle(html).getPropertyValue("--lm-accent").trim()) || [0.49, 0.77, 1];

    let canvas = null, gl = null, prog = null, raf = 0, last = 0, colors = null;
    const uni = {};

    const build = () => {
        canvas = document.createElement("canvas");
        canvas.className = "lm-aurora-layer";
        gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
        if (!gl) { canvas = null; return false; }
        // the windows share one renderer and its WebGL context limit
        canvas.addEventListener("webglcontextlost", () => { failed = true; unmount(); });
        const shader = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        };
        prog = gl.createProgram();
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas = gl = prog = null; return false; }
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ["res", "t", "c1", "c2", "c3"]) uni[n] = gl.getUniformLocation(prog, n);
        return true;
    };

    let failed = false;
    const draw = () => {
        const w = Math.max(1, Math.round(canvas.clientWidth * SCALE)), h = Math.max(1, Math.round(canvas.clientHeight * SCALE));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
        gl.uniform2f(uni.res, w, h);
        gl.uniform1f(uni.t, (Date.now() % 1e7) / 1000);
        gl.uniform3fv(uni.c1, colors);
        gl.uniform3f(uni.c2, 0.55, 0.38, 1.0);
        gl.uniform3f(uni.c3, 0.10, 0.80, 0.66);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const loop = (now) => {
        raf = 0;
        if (!canvas || document.hidden) return;
        if (now - last >= 1000 / FPS - 2) { last = now; draw(); }
        if (!still.matches) raf = requestAnimationFrame(loop);
    };
    const start = () => { if (canvas && !raf && !document.hidden) raf = requestAnimationFrame(loop); };

    const mount = () => {
        const parent = host();
        if (!parent || failed) return;
        if (!canvas && !build()) return;
        if (canvas.parentElement !== parent) parent.prepend(canvas);
        start();
    };
    const unmount = () => {
        cancelAnimationFrame(raf); raf = 0;
        if (canvas) { canvas.remove(); const lose = gl && !gl.isContextLost() && gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
        canvas = gl = prog = null;
    };

    // backdrop mode and accent come from the stylesheets; empty while they reload
    let mode = "";
    const sync = () => {
        const v = getComputedStyle(html).getPropertyValue("--lm-backdrop-mode").trim();
        if (v) mode = v;
        if (mode !== "aurora") { if (canvas) unmount(); return; }
        colors = accent();
        mount();
    };
    sync();
    setInterval(sync, 1000);   // the host is re-rendered by React
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") sync(); }, true);
    document.addEventListener("visibilitychange", start);
})();
