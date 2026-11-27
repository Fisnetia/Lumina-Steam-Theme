/*
 * WebGL backdrop and library-pane liquid-glass compositor.
 *
 * Aurora mode (css/conditions/backdrop-aurora.css): draws drifting noise bands
 * behind the main window, friends list, dialogs and login window at 0.25x /
 * 30 fps (paused while hidden). Where WebGL is unavailable or its context is
 * lost, the stylesheet's static gradient stays.
 *
 * Main-window liquid glass (html.lm-gl-panes):
 * - Aurora: renders 0.25x aurora into an FBO and composites full-resolution
 *   analytic rounded-rect refraction, 3-channel RGB dispersion and 4 px rim
 *   light behind the left game list and right library pane.
 * - Wallpaper (picture, video, Wallpaper Engine scene; html.lm-gl-wall):
 *   uploads the media to WebGL, applies cover cropping, optional separable
 *   Gaussian blur (--lm-blur-px) and CSS-matched colour grading, and renders
 *   the same full-resolution liquid-glass panes. Web wallpapers, animated GIFs
 *   and Desktop Acrylic fall back to the DOM + SVG pipeline automatically.
 */
(() => {
    if (window.__lmAurora) return;
    window.__lmAurora = true;

    const html = document.documentElement;
    const isMain = html.classList.contains("MillenniumWindow_MainSteamWindow");
    if (html.matches("{{contextMenu.ContextMenuPopup}}")) return;
    const inBody = html.classList.contains("friendsui-container") || html.classList.contains("ModalDialogPopup");
    const FRAME = "{{ForceOpaqueBackground.OuterFrame}}";
    const CONTENT_FRAME = "{{ForceOpaqueBackground.ContentFrame}}";
    const LOCAL_CONTENT = "{{ForceOpaqueBackground.LocalContentContainer}}";
    const WEB_WRAPPER = `${CONTENT_FRAME} > {{ForceOpaqueBackground.BrowserWrapper}}`;
    const LOGIN = "{{LoginStaticBackground}}";
    const LEFT_PANE = "{{GameListHomeAndSearch.Container}}";
    const RIGHT_PANE = "{{LeftListSizableContainer.AppDetailsTransitionGroup}}";
    const INGAME_SEL = "{{TitleBarControls.AccountMenu}}.ingame, {{TitleBarControls.AccountMenu}} .avatarHolder.ingame";
    const shouldPause = () => document.hidden || (isMain && !document.hasFocus() && !!document.querySelector(INGAME_SEL));
    // the login window is told apart by its content, which renders late
    const host = () => isMain ? document.querySelector(FRAME)
        : document.querySelector(LOGIN) || (inBody ? document.body : null);
    const SCALE = 0.25, FPS = 30, REACH = 0.92;

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

    // Separable 13-tap Gaussian blur with optional cover crop, Y flip (keeps
    // UNPACK_FLIP_Y_WEBGL false for Chromium's zero-copy GPU video upload) and
    // CSS-matched wallpaper grading (uGrade: 0 none, 1 video/scene, 2 picture).
    const BLUR_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uCover;
uniform vec2 uDir;
uniform float uSigma;
uniform float uGrade;
uniform float uDim;
uniform float uFlipY;

vec3 sat(vec3 c, float s) {
    float l = dot(c, vec3(0.213, 0.715, 0.072));
    return mix(vec3(l), c, s);
}

vec3 grade(vec3 c) {
    if (uGrade > 1.5) {
        c = mix(c, vec3(0.0235, 0.0314, 0.0549), uDim);
        return clamp(sat(c, 1.15), 0.0, 1.0);
    }
    if (uGrade > 0.5) {
        return clamp(sat(c, 1.15) * (1.0 - uDim), 0.0, 1.0);
    }
    return c;
}

void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float s2 = max(uSigma * uSigma, 0.0001);
    float stepPx = max(1.0, uSigma / 2.5);
    vec3 acc = vec3(0.0);
    float wSum = 0.0;
    for (int i = -6; i <= 6; i++) {
        float x = float(i) * stepPx;
        float w = exp(-0.5 * (x * x) / s2);
        vec2 p = clamp(uv + uDir * x, 0.001, 0.999);
        vec2 suv = p * uCover.xy + uCover.zw;
        if (uFlipY > 0.5) suv.y = 1.0 - suv.y;
        acc += texture2D(uTex, suv).rgb * w;
        wSum += w;
    }
    gl_FragColor = vec4(grade(acc / wSum), 1.0);
}`;

    // Full-resolution composite pass matching the SVG liquid-glass filter:
    // analytic rounded-rect SDF, t^2 inward bevel refraction, 3-channel RGB
    // dispersion (SPREAD = 0.14), 4 px coloured rim and liquid-tone grading.
    const PANE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform sampler2D uPaneTex;
uniform float uHasPaneTex;
uniform vec2 uRes;      // physical canvas size
uniform vec2 uCss;      // CSS px size of canvas
uniform vec4 uCover;    // cover UV scale.xy, offset.zw
uniform float uGrade;   // 0 already graded, 1 video/scene, 2 picture
uniform float uDim;     // wallpaper dim 0..0.95 (--lm-wall-dim)
uniform float uFlipY;   // 1 for uploaded DOM media, 0 for FBOs
uniform vec4 uRect0;    // left, top, width, height in CSS px
uniform vec4 uMeta0;    // radius, bevel, scale, opacity
uniform vec4 uRect1;
uniform vec4 uMeta1;

vec3 sat(vec3 c, float s) {
    float l = dot(c, vec3(0.213, 0.715, 0.072));
    return mix(vec3(l), c, s);
}

vec3 grade(vec3 c) {
    if (uGrade > 1.5) {
        c = mix(c, vec3(0.0235, 0.0314, 0.0549), uDim);
        return clamp(sat(c, 1.15), 0.0, 1.0);
    }
    if (uGrade > 0.5) {
        return clamp(sat(c, 1.15) * (1.0 - uDim), 0.0, 1.0);
    }
    return c;
}

vec3 sampleRaw(vec2 uv) {
    vec2 suv = clamp(uv, 0.001, 0.999) * uCover.xy + uCover.zw;
    if (uFlipY > 0.5) suv.y = 1.0 - suv.y;
    return texture2D(uTex, suv).rgb;
}

vec3 applyPane(vec3 base, vec2 pos, vec2 uv, vec4 rect, vec4 meta) {
    if (rect.z <= 1.0 || rect.w <= 1.0 || meta.w <= 0.001) return base;
    vec2 halfSize = rect.zw * 0.5;
    vec2 p = pos - (rect.xy + halfSize);
    float r = min(meta.x, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - (halfSize - r);
    vec2 o = max(q, 0.0);
    float outLen = length(o);
    float inside = r - (outLen + min(max(q.x, q.y), 0.0));
    float mask = smoothstep(-0.5, 0.5, inside) * meta.w;
    if (mask <= 0.0) return base;

    vec2 n = outLen > 0.0 ? (o / outLen) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    n *= vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);

    float bevel = max(meta.y, 1.0);
    float t = inside < bevel ? 1.0 - clamp(inside, 0.0, bevel) / bevel : 0.0;
    float disp = 0.5 * meta.z * t * t;

    vec3 body;
    if (disp > 0.001) {
        // uv.y grows upward while pos.y grows downward; invert n.x and keep n.y to sample inward
        vec2 dirUv = vec2(-n.x, n.y) / uCss;
        if (uHasPaneTex > 0.5) {
            float rCh = texture2D(uPaneTex, clamp(uv + dirUv * disp, 0.001, 0.999)).r;
            float gCh = texture2D(uPaneTex, clamp(uv + dirUv * (disp * 0.86), 0.001, 0.999)).g;
            float bCh = texture2D(uPaneTex, clamp(uv + dirUv * (disp * 0.72), 0.001, 0.999)).b;
            body = vec3(rCh, gCh, bCh);
        } else {
            float rCh = sampleRaw(uv + dirUv * disp).r;
            float gCh = sampleRaw(uv + dirUv * (disp * 0.86)).g;
            float bCh = sampleRaw(uv + dirUv * (disp * 0.72)).b;
            body = grade(vec3(rCh, gCh, bCh));
        }
    } else {
        body = uHasPaneTex > 0.5 ? texture2D(uPaneTex, clamp(uv, 0.001, 0.999)).rgb : base;
    }

    // 4 px coloured rim band
    float k = inside < 4.0 ? 1.0 - clamp(inside, 0.0, 4.0) / 4.0 : 0.0;
    float rimA = k * k;
    if (rimA > 0.0) {
        vec3 s = clamp(sat(body, 2.2), 0.0, 1.0);
        vec3 lit = clamp(s * 1.25 + vec3(0.02, 0.03, 0.07), 0.0, 1.0);
        body = mix(body, lit, rimA);
    }

    // matches --lm-liquid-tone: saturate(1.35) brightness(1.04)
    body = clamp(sat(body, 1.35) * 1.04, 0.0, 1.0);
    return mix(base, body, mask);
}

void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 pos = vec2(uv.x * uCss.x, (1.0 - uv.y) * uCss.y);
    vec3 col = grade(sampleRaw(uv));
    col = applyPane(col, pos, uv, uRect0, uMeta0);
    col = applyPane(col, pos, uv, uRect1, uMeta1);
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

    let canvas = null, gl = null, prog = null, paneProg = null, blurProg = null, vbo = null;
    let wallTex = null, hasAuroraFrame = false;
    const fboA = { fbo: null, tex: null, w: 0, h: 0, ok: false };
    const fboB = { fbo: null, tex: null, w: 0, h: 0, ok: false };
    const fboC = { fbo: null, tex: null, w: 0, h: 0, ok: false };
    let raf = 0, compRaf = 0, last = 0, colors = [0.49, 0.77, 1];
    let mode = "", liquid = false, strength = 50, blurPx = 0, wallDim = 0.18, liquidBlur = 0, radiusStr = "";
    let failed = false, lostCount = 0, retryTimer = 0;
    const uni = {}, pUni = {}, bUni = {};

    // Active wallpaper media state (main window only)
    let boundSrc = null, wallVideo = null, wallSceneEl = null, wallImg = null;
    let rvfcId = 0, lastVideoFrame = -1, wallActive = false, wallUploaded = false, wallBlurred = false, lastBlurKey = "";
    let wallMediaW = 0, wallMediaH = 0, wallTexW = 0, wallTexH = 0, wallGrade = 1.0;

    const wallSource = () => {
        if (!isMain || mode !== "wallpaper" || !liquid) return null;
        const s = window.__lmWallSource;
        return s && (s.kind === "picture" || s.kind === "video" || s.kind === "scene") ? s : null;
    };
    const isWallGlMode = () => !!wallSource();

    const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
        return s;
    };
    const link = (vsSrc, fsSrc) => {
        const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
        return p;
    };

    const makeTex = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    };

    const ensureFbo = (slot, w, h) => {
        if (!gl) return false;
        if (!slot.fbo) {
            slot.fbo = gl.createFramebuffer();
            slot.tex = makeTex();
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, slot.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, slot.tex, 0);
            slot.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            slot.w = w; slot.h = h;
            return slot.ok;
        }
        if (slot.w !== w || slot.h !== h) {
            slot.w = w; slot.h = h;
            gl.bindTexture(gl.TEXTURE_2D, slot.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        return slot.ok;
    };

    const resetFboSlot = (slot) => {
        slot.fbo = slot.tex = null;
        slot.w = slot.h = 0;
        slot.ok = false;
    };

    const build = () => {
        const c = document.createElement("canvas");
        c.className = "lm-aurora-layer";
        gl = c.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
        if (!gl) return false;
        canvas = c;
        // the windows share one renderer and its WebGL context limit; ignore
        // context-lost events fired by our own unmount() and retry real losses
        c.addEventListener("webglcontextlost", (e) => {
            if (c !== canvas) return;
            e.preventDefault();
            unmount();
            failed = true;
            if (++lostCount <= 5) {
                clearTimeout(retryTimer);
                retryTimer = setTimeout(() => { retryTimer = 0; failed = false; sync(); }, 2000);
            }
        });
        prog = link(VERT, FRAG);
        if (!prog) { canvas = gl = null; return false; }
        vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        for (const n of ["res", "t", "c1", "c2", "c3"]) uni[n] = gl.getUniformLocation(prog, n);
        uni.p = gl.getAttribLocation(prog, "p");

        if (isMain) {
            paneProg = link(VERT, PANE_FRAG);
            if (paneProg) {
                for (const n of ["uTex", "uPaneTex", "uHasPaneTex", "uRes", "uCss", "uCover", "uGrade", "uDim", "uFlipY", "uRect0", "uMeta0", "uRect1", "uMeta1"]) {
                    pUni[n] = gl.getUniformLocation(paneProg, n);
                }
                pUni.p = gl.getAttribLocation(paneProg, "p");
                ensureFbo(fboA, 2, 2);
            }
            blurProg = link(VERT, BLUR_FRAG);
            if (blurProg) {
                for (const n of ["uTex", "uRes", "uCover", "uDir", "uSigma", "uGrade", "uDim", "uFlipY"]) {
                    bUni[n] = gl.getUniformLocation(blurProg, n);
                }
                bUni.p = gl.getAttribLocation(blurProg, "p");
            }
            wallTex = makeTex();
            wallTexW = wallTexH = 0;
        }
        hasAuroraFrame = false;
        wallUploaded = false;
        wallBlurred = false;
        return true;
    };

    const bindQuad = (loc) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    };

    const useAuroraPanes = () => isMain && mode === "aurora" && liquid && !!paneProg && fboA.ok;

    // Cached geometry of canvas, left game list and right library pane.
    // Re-measured only when ResizeObserver, tab switch or settings mark it dirty,
    // so steady video/aurora playback performs zero DOM layout reads per frame.
    const PANE_SEL = [LEFT_PANE, RIGHT_PANE];
    const paneEls = [null, null];
    let paneObs = null, navObs = null, watchedFrame = null, watchedLocal = null, watchedWeb = null;
    let watched = new WeakSet();
    const zeroRect = [0, 0, 0, 0], zeroMeta = [0, 1, 0, 0];
    const UNIT_COVER = [1, 1, 0, 0];
    let panesDirty = true, cachedCw = 0, cachedCh = 0;
    let cachedR0 = zeroRect, cachedM0 = zeroMeta, cachedR1 = zeroRect, cachedM1 = zeroMeta;

    const findPane = (sel) => {
        const all = document.querySelectorAll(sel);
        for (const el of all) {
            if (el.offsetWidth > 1 && el.offsetHeight > 1) return el;
        }
        return all[0] || null;
    };

    const ensurePanes = () => {
        let changed = false;
        for (let i = 0; i < 2; i++) {
            const cur = paneEls[i];
            if (!cur || !cur.isConnected || !(cur.offsetWidth > 1 && cur.offsetHeight > 1)) {
                const el = findPane(PANE_SEL[i]);
                if (el !== cur) { paneEls[i] = el; changed = true; }
                if (el && paneObs && !watched.has(el)) { watched.add(el); paneObs.observe(el); }
            }
        }
        if (changed) panesDirty = true;
    };

    const measurePane = (el, base) => {
        if (!el || !el.isConnected) return [zeroRect, zeroMeta];
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return [zeroRect, zeroMeta];
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden") return [zeroRect, zeroMeta];
        const op = parseFloat(cs.opacity);
        if (!(op > 0.001)) return [zeroRect, zeroMeta];
        const rad = parseFloat(cs.borderTopLeftRadius) || 0;
        const bevel = Math.max(1, Math.round(strength * REACH));
        const scale = strength ? Math.round(bevel * 0.9) : 0;
        return [
            [r.left - base.left, r.top - base.top, r.width, r.height],
            [rad, bevel, scale, Math.min(1, op)],
        ];
    };

    const hasVisiblePane = () =>
        (cachedR0[2] > 1 && cachedR0[3] > 1 && cachedM0[3] > 0.001) ||
        (cachedR1[2] > 1 && cachedR1[3] > 1 && cachedM1[3] > 0.001);

    const refreshLayout = () => {
        if (!canvas) return false;
        if (!panesDirty && cachedCw > 0 && cachedCh > 0 &&
            (!paneEls[0] || paneEls[0].isConnected) &&
            (!paneEls[1] || paneEls[1].isConnected)) {
            return true;
        }
        ensurePanes();
        const base = canvas.getBoundingClientRect();
        cachedCw = Math.round(base.width);
        cachedCh = Math.round(base.height);
        if (!cachedCw || !cachedCh) return false;
        [cachedR0, cachedM0] = measurePane(paneEls[0], base);
        [cachedR1, cachedM1] = measurePane(paneEls[1], base);
        panesDirty = false;
        return true;
    };

    const coverUv = (cw, ch, mw, mh) => {
        if (!cw || !ch || !mw || !mh) return UNIT_COVER;
        const ca = cw / ch, ma = mw / mh;
        if (ma > ca) {
            const sx = ca / ma;
            return [sx, 1, (1 - sx) * 0.5, 0];
        }
        const sy = ma / ca;
        return [1, sy, 0, (1 - sy) * 0.5];
    };

    const renderAurora = (w, h) => {
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        bindQuad(uni.p);
        gl.uniform2f(uni.res, w, h);
        gl.uniform1f(uni.t, (Date.now() % 1e7) / 1000);
        gl.uniform3fv(uni.c1, colors);
        gl.uniform3f(uni.c2, 0.55, 0.38, 1.0);
        gl.uniform3f(uni.c3, 0.10, 0.80, 0.66);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const blurToFbo = (srcTex, cov, flipY, gradeMode, cw, ch, r, outSlot) => {
        if (!blurProg || !srcTex || !(r > 0.01)) return false;
        let scale = 1, passes = 1;
        if (r > 24) { scale = 0.125; passes = 3; }
        else if (r > 10) { scale = 0.25; passes = 2; }
        else if (r > 6) { scale = 0.5; passes = 2; }
        else if (r >= 1.5) { scale = 0.5; passes = 1; }
        const bw = Math.max(2, Math.round(cw * scale));
        const bh = Math.max(2, Math.round(ch * scale));
        if (!ensureFbo(outSlot, bw, bh) || !ensureFbo(fboB, bw, bh)) return false;

        const sigma = (r * scale) / Math.sqrt(passes);

        gl.useProgram(blurProg);
        bindQuad(bUni.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(bUni.uTex, 0);
        gl.uniform2f(bUni.uRes, bw, bh);
        gl.uniform1f(bUni.uSigma, sigma);
        gl.uniform1f(bUni.uDim, wallDim);
        gl.viewport(0, 0, bw, bh);

        for (let i = 0; i < passes; i++) {
            const first = i === 0, lastPass = i === passes - 1;
            // Horizontal pass -> fboB
            gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fbo);
            gl.bindTexture(gl.TEXTURE_2D, first ? srcTex : outSlot.tex);
            gl.uniform4fv(bUni.uCover, first ? cov : UNIT_COVER);
            gl.uniform2f(bUni.uDir, 1 / bw, 0);
            gl.uniform1f(bUni.uGrade, 0);
            gl.uniform1f(bUni.uFlipY, first ? flipY : 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Vertical pass -> outSlot
            gl.bindFramebuffer(gl.FRAMEBUFFER, outSlot.fbo);
            gl.bindTexture(gl.TEXTURE_2D, fboB.tex);
            gl.uniform4fv(bUni.uCover, UNIT_COVER);
            gl.uniform2f(bUni.uDir, 0, 1 / bh);
            gl.uniform1f(bUni.uGrade, lastPass ? gradeMode : 0);
            gl.uniform1f(bUni.uFlipY, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        return true;
    };

    const renderComposite = (tex, cov, gradeMode, flipY, paneTex) => {
        if (!canvas || !gl || !paneProg || !tex) return false;
        if (!refreshLayout()) return false;
        const cw = cachedCw, ch = cachedCh;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, pw, ph);
        gl.useProgram(paneProg);
        bindQuad(pUni.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(pUni.uTex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, paneTex || tex);
        gl.uniform1i(pUni.uPaneTex, 1);
        gl.uniform1f(pUni.uHasPaneTex, paneTex ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(pUni.uRes, pw, ph);
        gl.uniform2f(pUni.uCss, cw, ch);
        gl.uniform4fv(pUni.uCover, cov);
        gl.uniform1f(pUni.uGrade, gradeMode);
        gl.uniform1f(pUni.uDim, wallDim);
        gl.uniform1f(pUni.uFlipY, flipY);
        gl.uniform4fv(pUni.uRect0, cachedR0);
        gl.uniform4fv(pUni.uMeta0, cachedM0);
        gl.uniform4fv(pUni.uRect1, cachedR1);
        gl.uniform4fv(pUni.uMeta1, cachedM1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // Unbind TEXTURE1 so fboC.tex is never bound as an input while rendered to as an FBO
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        lostCount = 0;
        return true;
    };

    const setFlags = (panesOn, wallOn) => {
        if (!isMain) return;
        html.classList.toggle("lm-gl-panes", !!panesOn);
        html.classList.toggle("lm-gl-wall", !!wallOn);
        if (!wallOn) wallActive = false;
    };

    const setWallActive = (on) => {
        if (!isMain) return;
        const next = !!on;
        if (wallActive === next && (!canvas || mode !== "wallpaper" || (canvas.style.visibility === (next ? "" : "hidden")))) return;
        wallActive = next;
        if (canvas && mode === "wallpaper") canvas.style.visibility = next ? "" : "hidden";
        setFlags(next, next);
    };

    const uploadWall = (media, mw, mh) => {
        if (!gl || !wallTex || !media || !(mw > 0) || !(mh > 0)) return false;
        gl.bindTexture(gl.TEXTURE_2D, wallTex);
        try {
            if (wallTexW !== mw || wallTexH !== mh) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
                wallTexW = mw;
                wallTexH = mh;
            } else {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, media);
            }
        } catch {
            wallTexW = wallTexH = 0;
            return false;
        }
        wallMediaW = mw;
        wallMediaH = mh;
        wallUploaded = true;
        wallBlurred = false;
        return true;
    };

    const drawWallComposite = () => {
        if (!canvas || !gl || !wallUploaded || !isWallGlMode()) return false;
        if (!refreshLayout()) return false;
        const cw = cachedCw, ch = cachedCh;
        const cov = coverUv(cw, ch, wallMediaW, wallMediaH);
        const needBgBlur = blurPx > 0.01;
        const needPaneBlur = liquidBlur > 0.01 && hasVisiblePane();
        if (needBgBlur || needPaneBlur) {
            const key = `${cw}x${ch}x${blurPx}x${wallDim}x${needPaneBlur ? liquidBlur : 0}x${wallGrade}`;
            if (!wallBlurred || lastBlurKey !== key) {
                if (needBgBlur && !blurToFbo(wallTex, cov, 1, wallGrade, cw, ch, blurPx, fboA)) {
                    setWallActive(false); return false;
                }
                if (needPaneBlur) {
                    const paneR = needBgBlur ? Math.hypot(blurPx, liquidBlur) : liquidBlur;
                    if (!blurToFbo(wallTex, cov, 1, wallGrade, cw, ch, paneR, fboC)) {
                        setWallActive(false); return false;
                    }
                }
                wallBlurred = true;
                lastBlurKey = key;
            }
        }
        const bgTex = needBgBlur ? fboA.tex : wallTex;
        const bgCov = needBgBlur ? UNIT_COVER : cov;
        const bgGrade = needBgBlur ? 0 : wallGrade;
        const bgFlipY = needBgBlur ? 0 : 1;
        const paneTex = needPaneBlur ? fboC.tex : null;
        if (!renderComposite(bgTex, bgCov, bgGrade, bgFlipY, paneTex)) return false;
        setWallActive(true);
        return true;
    };

    const scheduleComposite = () => {
        panesDirty = true;
        if (compRaf || !canvas || shouldPause()) return;
        const auroraPanes = useAuroraPanes(), wallGl = isWallGlMode();
        if (!auroraPanes && !wallGl) return;
        compRaf = requestAnimationFrame(() => {
            compRaf = 0;
            if (!canvas || shouldPause()) return;
            if (useAuroraPanes()) {
                if (hasAuroraFrame && refreshLayout()) {
                    const aw = Math.max(1, Math.round(cachedCw * SCALE)), ah = Math.max(1, Math.round(cachedCh * SCALE));
                    const paneTex = liquidBlur > 3 && hasVisiblePane() && blurToFbo(fboA.tex, UNIT_COVER, 0, 0, aw, ah, liquidBlur, fboC)
                        ? fboC.tex : null;
                    renderComposite(fboA.tex, UNIT_COVER, 0, 0, paneTex);
                } else drawAurora();
            } else if (isWallGlMode() && wallUploaded) {
                drawWallComposite();
            }
        });
    };

    const watchPanes = () => {
        if (!isMain) return;
        if (!paneObs && typeof ResizeObserver !== "undefined") {
            paneObs = new ResizeObserver(scheduleComposite);
        }
        if (paneObs && canvas && !watched.has(canvas)) {
            watched.add(canvas);
            paneObs.observe(canvas);
        }
        ensurePanes();
        // Direct-child / style observers matching bottom-bar.js so 0-fps static
        // picture mode updates immediately on Store / Library / Downloads switches.
        if (!navObs) navObs = new MutationObserver(() => { ensurePanes(); scheduleComposite(); });
        const frame = document.querySelector(CONTENT_FRAME);
        if (frame !== watchedFrame) {
            watchedFrame = frame;
            if (frame) navObs.observe(frame, { childList: true });
        }
        const local = document.querySelector(LOCAL_CONTENT);
        if (local !== watchedLocal) {
            watchedLocal = local;
            if (local) navObs.observe(local, { childList: true });
        }
        const web = document.querySelector(WEB_WRAPPER);
        if (web !== watchedWeb) {
            watchedWeb = web;
            if (web) navObs.observe(web, { attributes: true, attributeFilter: ["style"] });
        }
    };

    const drawAurora = () => {
        if (!canvas || !gl) return;
        if (useAuroraPanes()) {
            if (!refreshLayout()) return;
            const aw = Math.max(1, Math.round(cachedCw * SCALE)), ah = Math.max(1, Math.round(cachedCh * SCALE));
            if (ensureFbo(fboA, aw, ah)) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fbo);
                renderAurora(aw, ah);
                hasAuroraFrame = true;
                // Aurora is already a low-frequency 1/3-scale gradient; only blur
                // at higher radii and stay at aw x ah instead of full screen res.
                const paneTex = liquidBlur > 3 && hasVisiblePane() && blurToFbo(fboA.tex, UNIT_COVER, 0, 0, aw, ah, liquidBlur, fboC)
                    ? fboC.tex : null;
                renderComposite(fboA.tex, UNIT_COVER, 0, 0, paneTex);
                return;
            }
        }
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!cw || !ch) return;
        const aw = Math.max(1, Math.round(cw * SCALE)), ah = Math.max(1, Math.round(ch * SCALE));
        if (canvas.width !== aw || canvas.height !== ah) { canvas.width = aw; canvas.height = ah; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        renderAurora(aw, ah);
    };

    const drawSceneFrame = () => {
        const sc = wallSceneEl && wallSceneEl.isConnected && wallSceneEl.querySelector("canvas");
        if (!sc || !sc.width || !sc.height) return;
        if (uploadWall(sc, sc.width, sc.height)) drawWallComposite();
        else setWallActive(false);
    };

    const onVideoReady = () => {
        if (!wallVideo || !isWallGlMode() || shouldPause()) return;
        if (wallVideo.readyState >= 2 && wallVideo.videoWidth > 0) {
            if (uploadWall(wallVideo, wallVideo.videoWidth, wallVideo.videoHeight)) drawWallComposite();
            else setWallActive(false);
        }
        scheduleVideoFrame();
    };

    const onVideoFrame = (_now, meta) => {
        rvfcId = 0;
        if (!wallVideo || !isWallGlMode() || shouldPause()) return;
        const frames = meta && typeof meta.presentedFrames === "number" ? meta.presentedFrames : -1;
        if (frames !== -1 && frames === lastVideoFrame) {
            scheduleVideoFrame();
            return;
        }
        if (wallVideo.readyState >= 2 && wallVideo.videoWidth > 0) {
            if (uploadWall(wallVideo, wallVideo.videoWidth, wallVideo.videoHeight)) {
                lastVideoFrame = frames;
                drawWallComposite();
            } else {
                setWallActive(false);
                return;
            }
        }
        scheduleVideoFrame();
    };

    const scheduleVideoFrame = () => {
        if (!wallVideo || shouldPause() || !isWallGlMode()) return;
        if (typeof wallVideo.requestVideoFrameCallback === "function") {
            if (!rvfcId) rvfcId = wallVideo.requestVideoFrameCallback(onVideoFrame);
        } else {
            start();
        }
    };

    const onVideoPlay = () => { scheduleVideoFrame(); };

    const clearWallBinding = () => {
        if (wallVideo) {
            if (rvfcId && typeof wallVideo.cancelVideoFrameCallback === "function") {
                try { wallVideo.cancelVideoFrameCallback(rvfcId); } catch {}
            }
            wallVideo.removeEventListener("loadeddata", onVideoReady);
            wallVideo.removeEventListener("playing", onVideoPlay);
            wallVideo = null;
        }
        rvfcId = 0;
        lastVideoFrame = -1;
        if (wallImg) { wallImg.onload = wallImg.onerror = null; wallImg = null; }
        wallSceneEl = null;
        boundSrc = null;
        wallUploaded = false;
        wallBlurred = false;
        lastBlurKey = "";
        wallMediaW = wallMediaH = 0;
    };

    const bindWallSource = () => {
        const src = wallSource();
        if (src === boundSrc) {
            if (wallVideo) scheduleVideoFrame();
            else if (wallSceneEl) start();
            return;
        }
        clearWallBinding();
        if (!src) { setWallActive(false); return; }
        boundSrc = src;
        setWallActive(false);   // stay hidden until first valid frame renders

        if (src.kind === "picture") {
            wallGrade = 2.0;
            const img = new Image();
            img.crossOrigin = "anonymous";
            wallImg = img;
            img.onload = () => {
                if (wallImg !== img || !gl || !isWallGlMode()) return;
                if (uploadWall(img, img.naturalWidth, img.naturalHeight)) drawWallComposite();
                else setWallActive(false);
            };
            img.onerror = () => { if (wallImg === img) setWallActive(false); };
            img.src = src.url;
        } else if (src.kind === "video") {
            wallGrade = 1.0;
            wallVideo = src.el;
            wallVideo.addEventListener("loadeddata", onVideoReady);
            wallVideo.addEventListener("playing", onVideoPlay);
            onVideoReady();
        } else if (src.kind === "scene") {
            wallGrade = 1.0;
            wallSceneEl = src.el;
            drawSceneFrame();
            start();
        }
    };

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const loop = (now) => {
        raf = 0;
        if (!canvas || shouldPause()) return;
        if (mode === "aurora") {
            if (now - last >= 1000 / FPS - 2) { last = now; drawAurora(); }
            if (!still.matches) raf = requestAnimationFrame(loop);
        } else if (isWallGlMode()) {
            if (wallSceneEl) {
                if (now - last >= 1000 / FPS - 2) { last = now; drawSceneFrame(); }
                raf = requestAnimationFrame(loop);
            } else if (wallVideo && typeof wallVideo.requestVideoFrameCallback !== "function") {
                if (now - last >= 1000 / FPS - 2) {
                    last = now;
                    if (wallVideo.readyState >= 2 && wallVideo.videoWidth > 0 &&
                        uploadWall(wallVideo, wallVideo.videoWidth, wallVideo.videoHeight)) {
                        drawWallComposite();
                    }
                }
                raf = requestAnimationFrame(loop);
            }
        }
    };
    const start = () => { if (canvas && !raf && !shouldPause()) raf = requestAnimationFrame(loop); };

    const mount = () => {
        const parent = host();
        if (!parent || failed) return false;
        if (!canvas && !build()) return false;
        if (canvas.parentElement !== parent) parent.prepend(canvas);
        watchPanes();
        return true;
    };

    const unmount = () => {
        cancelAnimationFrame(raf); raf = 0;
        cancelAnimationFrame(compRaf); compRaf = 0;
        clearWallBinding();
        setFlags(false, false);
        if (paneObs) { paneObs.disconnect(); paneObs = null; }
        if (navObs) { navObs.disconnect(); navObs = null; }
        watchedFrame = watchedLocal = watchedWeb = null;
        watched = new WeakSet();
        paneEls[0] = paneEls[1] = null;
        const oldCanvas = canvas;
        const oldGl = gl;
        canvas = gl = prog = paneProg = blurProg = vbo = wallTex = null;
        if (oldCanvas) {
            oldCanvas.remove();
            const lose = oldGl && !oldGl.isContextLost() && oldGl.getExtension("WEBGL_lose_context");
            if (lose) lose.loseContext();
        }
        wallTexW = wallTexH = 0;
        panesDirty = true;
        cachedCw = cachedCh = 0;
        resetFboSlot(fboA);
        resetFboSlot(fboB);
        resetFboSlot(fboC);
        hasAuroraFrame = false;
    };

    // backdrop mode, liquid toggle and sliders come from the stylesheets; empty while they reload
    let prevMode = "", prevAuroraPanes = false, prevSettings = "";
    const sync = () => {
        const cs = getComputedStyle(html);
        const v = cs.getPropertyValue("--lm-backdrop-mode").trim();
        if (v) mode = v;
        const lq = cs.getPropertyValue("--lm-liquid").trim();
        if (lq) liquid = lq === "1";
        const rf = parseFloat(cs.getPropertyValue("--lm-refraction"));
        if (!Number.isNaN(rf)) strength = Math.min(Math.max(rf, 0), 100);
        const bp = parseFloat(cs.getPropertyValue("--lm-blur-px"));
        if (!Number.isNaN(bp)) blurPx = Math.min(Math.max(bp, 0), 64);
        const wd = parseFloat(cs.getPropertyValue("--lm-wall-dim"));
        if (!Number.isNaN(wd)) wallDim = Math.min(Math.max(wd / 100, 0), 0.95);
        const lb = parseFloat(cs.getPropertyValue("--lm-liquid-blur"));
        if (!Number.isNaN(lb)) liquidBlur = Math.min(Math.max(lb, 0), 24);
        const rs = cs.getPropertyValue("--lm-radius").trim();
        if (rs) radiusStr = rs;

        const settingsKey = `${mode}|${liquid}|${strength}|${blurPx}|${wallDim}|${liquidBlur}|${radiusStr}`;
        const changed = settingsKey !== prevSettings;
        const modeChanged = mode !== prevMode;
        prevSettings = settingsKey;
        prevMode = mode;
        if (changed) panesDirty = true;

        if (mode === "aurora") {
            clearWallBinding();
            colors = parse(cs.getPropertyValue("--lm-accent").trim()) || [0.49, 0.77, 1];
            if (!mount()) return;
            canvas.style.visibility = "";
            const ap = useAuroraPanes();
            setFlags(ap, false);
            if (ap && ((paneEls[0] && cachedR0[2] < 2) || (paneEls[1] && cachedR1[2] < 2))) panesDirty = true;
            start();
            if (modeChanged || ap !== prevAuroraPanes || (ap && (changed || panesDirty))) {
                prevAuroraPanes = ap;
                drawAurora();
            }
            return;
        }

        prevAuroraPanes = false;
        if (isWallGlMode()) {
            if (modeChanged) { cancelAnimationFrame(raf); raf = 0; }
            if (!mount()) return;
            bindWallSource();
            if ((paneEls[0] && cachedR0[2] < 2) || (paneEls[1] && cachedR1[2] < 2)) panesDirty = true;
            if (wallUploaded && (changed || panesDirty)) scheduleComposite();
            return;
        }

        if (canvas) unmount();
        else setFlags(false, false);
    };

    const pauseLoops = () => {
        cancelAnimationFrame(raf); raf = 0;
        cancelAnimationFrame(compRaf); compRaf = 0;
        if (wallVideo && rvfcId && typeof wallVideo.cancelVideoFrameCallback === "function") {
            try { wallVideo.cancelVideoFrameCallback(rvfcId); } catch {}
            rvfcId = 0;
        }
    };

    let wasPaused = false;
    const syncActivity = () => {
        const paused = shouldPause();
        if (paused) {
            wasPaused = true;
            pauseLoops();
            return;
        }
        if (!wasPaused) return;
        wasPaused = false;
        panesDirty = true;
        sync();
        if (mode === "aurora") start();
        else if (isWallGlMode()) {
            if (wallVideo) scheduleVideoFrame();
            else if (wallSceneEl) start();
            if (wallUploaded) scheduleComposite();
        }
    };

    sync();
    setInterval(() => {
        if (document.hidden) return;
        syncActivity();
        if (!shouldPause()) sync();
    }, 1000);   // the host is re-rendered by React
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") sync(); }, true);
    if (isMain) {
        window.addEventListener("lm-wall-change", sync);
        window.addEventListener("resize", scheduleComposite, { passive: true });
        window.addEventListener("blur", syncActivity);
        window.addEventListener("focus", syncActivity);
        if (typeof MutationObserver !== "undefined") {
            const settingsObs = new MutationObserver(sync);
            if (document.head) settingsObs.observe(document.head, { childList: true });
            settingsObs.observe(html, { attributes: true, attributeFilter: ["style"] });
        }
    }
    document.addEventListener("visibilitychange", syncActivity);
    window.addEventListener("pagehide", unmount);
})();
