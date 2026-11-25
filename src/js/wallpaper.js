/*
 * Wallpaper behind the glass, and its settings card.
 *
 * Kinds: picture, video, scene (Wallpaper Engine, rendered by vendor/webwallgl),
 * web (Wallpaper Engine, needs the lumina-extended plugin; else its preview is used).
 *
 * Without the plugin, chosen files are copied into IndexedDB, which all Steam
 * windows share. With it, Wallpaper Engine items stay on disk and are loaded
 * from the plugin's local file server; only the item id is stored.
 *
 * --lm-wallpaper holds the still image (picture, poster, or a frame of a
 * scene). Video and scene layers are placed in the backdrop above it. Scenes
 * and web wallpapers run in the main window only; other windows show the
 * frame. Moving layers pause while their window is hidden.
 */
(() => {
    if (window.__lmWallpaper) return;
    window.__lmWallpaper = true;

    const html = document.documentElement;
    if (html.matches("{{contextMenu.ContextMenuPopup}}")) return;

    const DB = "lumina", STORE = "kv";
    const MAX_SIDE = 2560, QUALITY = 0.88, POSTER_SIDE = 1280;
    const MAX_FILE_MB = 600;
    const SCENE_FPS = 30;
    const FRAME_SIDE = 1280, FRAME_DELAY = 2500;
    const CONDITION = "Backdrop";
    const PLUGIN = "lumina-extended";
    const FRAME = "{{ForceOpaqueBackground.OuterFrame}}";
    const INGAME_SEL = "{{TitleBarControls.AccountMenu}}.ingame, {{TitleBarControls.AccountMenu}} .avatarHolder.ingame";
    const isMain = html.classList.contains("MillenniumWindow_MainSteamWindow");
    const isFriends = html.classList.contains("friendsui-container");
    const shouldPause = () => document.hidden || (isMain && !document.hasFocus() && !!document.querySelector(INGAME_SEL));
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("lumina") : null;

    const themeFile = (document.currentScript && document.currentScript.src) ||
        (document.querySelector("script[src*='lumina']") || {}).src ||
        (document.querySelector("link[href*='lumina']") || {}).href || "";
    const BASE = (themeFile.match(/^(.*\/lumina\/)/) || [])[1] || "";
    const DEFAULT_URL = BASE + "images/wallpaper.jpg";
    const ENGINE_URL = BASE + "vendor/webwallgl/webwallgl.global.min.js";

    /* ---- strings ---- */

    const ZH = /^zh/i.test(html.lang || navigator.language || "");
    const STRINGS = {
        en: {
            label: "Wallpaper",
            desc: "Picture, video, or a Wallpaper Engine scene or video.",
            chooseFile: "Choose file…", engine: "Wallpaper Engine…", engineTip: "Choose from Wallpaper Engine",
            reset: "Reset to default", close: "Close", all: "All",
            libraryTitle: "Wallpaper Engine library", pickOne: "Choose a wallpaper",
            kinds: { scene: "Scene", video: "Video", web: "Web", picture: "Picture", application: "App", "": "Other" },
            default: "Default",
            failed: "Live wallpaper failed to load. Showing preview.",
            pluginOff: "Companion plugin not running. Showing default.",
            noLibrary: "Companion plugin found no Wallpaper Engine library. Choose its folder instead.",
            serverDown: "Companion plugin's file server did not start. Choose a folder instead.",
            tooBig: (mb) => `File exceeds the ${mb} MB limit.`,
            readingVideo: "Reading video…", savingScene: "Saving scene…", savingVideo: "Saving video…",
            noPkg: "Missing scene.pkg.", noVideo: "Video file not found.",
            noPreview: "Missing preview image.",
            webNeedsPlugin: "Web wallpapers require the companion plugin. Using preview.",
            previewOnly: "Only the preview is supported for this type.",
            badFile: "Unsupported file.",
            readingLibrary: "Reading library…", emptyLibrary: "Library is empty.",
            appUnsupported: "Application wallpapers are not supported.",
            readingFolder: "Reading folder…", noItems: "No Wallpaper Engine wallpapers in this folder.",
        },
        zh: {
            label: "壁纸",
            desc: "图片、视频，或 Wallpaper Engine 的 Scene 与视频壁纸",
            chooseFile: "选择文件…", engine: "WE 壁纸库…", engineTip: "从 Wallpaper Engine 选择",
            reset: "恢复默认", close: "关闭", all: "全部",
            libraryTitle: "Wallpaper Engine 壁纸库", pickOne: "选择壁纸",
            kinds: { scene: "Scene", video: "视频", web: "网页", picture: "图片", application: "应用程序", "": "其他" },
            default: "默认",
            failed: "动态壁纸加载失败，已显示预览图",
            pluginOff: "配套插件未运行，已使用默认壁纸",
            noLibrary: "配套插件未找到 Wallpaper Engine 壁纸库，请手动选择文件夹",
            serverDown: "配套插件的文件服务未能启动，请手动选择文件夹",
            tooBig: (mb) => `文件超过 ${mb} MB 上限`,
            readingVideo: "正在读取视频…", savingScene: "正在保存 Scene…", savingVideo: "正在保存视频…",
            noPkg: "缺少 scene.pkg", noVideo: "未找到视频文件",
            noPreview: "缺少预览图",
            webNeedsPlugin: "网页壁纸需安装配套插件，已使用预览图",
            previewOnly: "此类壁纸仅支持预览图",
            badFile: "无法使用此文件",
            readingLibrary: "正在读取壁纸库…", emptyLibrary: "壁纸库为空",
            appUnsupported: "不支持应用程序类壁纸",
            readingFolder: "正在读取文件夹…", noItems: "此文件夹中没有 Wallpaper Engine 壁纸",
        },
    };
    const T = STRINGS[ZH ? "zh" : "en"];
    const kindLabel = (k) => T.kinds[k] ?? k;

    /* ---- storage: meta, wallpaper (Blob), poster (Blob) ---- */

    const openDb = (name) => new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    const open = () => openDb(DB);

    const read = async (...keys) => {
        try {
            const db = await open();
            return await new Promise((resolve, reject) => {
                const t = db.transaction(STORE, "readonly"), s = t.objectStore(STORE);
                const reqs = keys.map(k => s.get(k));
                t.oncomplete = () => { db.close(); resolve(reqs.map(r => r.result || null)); };
                t.onerror = () => { db.close(); reject(t.error); };
            });
        } catch { return keys.map(() => null); }
    };

    // null deletes a key
    const write = async (entries) => {
        const db = await open();
        await new Promise((resolve, reject) => {
            const t = db.transaction(STORE, "readwrite"), s = t.objectStore(STORE);
            for (const [k, v] of Object.entries(entries)) v ? s.put(v, k) : s.delete(k);
            t.oncomplete = () => { db.close(); resolve(); };
            t.onerror = () => { db.close(); reject(t.error); };
        });
    };

    // frame: a still of the live scene, captured later by the main window
    const store = (meta, wallpaper = null, poster = null) => write({ meta, wallpaper, poster, frame: null });

    /* ---- plugin ---- */

    let plugin = null;   // { base } while the plugin's server runs
    let pluginIssue = "";   // why findPlugin failed while the plugin is enabled

    // Millennium's IPC lives in SharedJSContext, which opened this window.
    const callPlugin = async (method, args = {}) => {
        let M = window.Millennium;
        try { M = M || (window.opener && window.opener.Millennium); } catch {}
        if (!M || typeof M.callServerMethod !== "function") throw new Error("no Millennium IPC");
        const out = await M.callServerMethod(PLUGIN, method, args);
        return typeof out === "string" ? JSON.parse(out) : out;
    };

    // Retries while the server is still starting.
    const findPlugin = async () => {
        plugin = null;
        pluginIssue = "";
        for (let i = 0; i < 12; i++) {
            let s;
            try { s = await callPlugin("Status"); } catch { return null; }   // not enabled
            if (s && s.base) return (plugin = s);
            if (!s || !s.starting) {
                pluginIssue = s && /library/i.test(s.error || "") ? T.noLibrary : T.serverDown;
                return null;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        pluginIssue = T.serverDown;
        return null;
    };

    const encodePath = (p) => String(p || "").split(/[\\/]/).map(encodeURIComponent).join("/");
    const itemBase = (id) => plugin ? `${plugin.base}${encodePath(id)}/` : null;

    /* ---- display ---- */

    let urls = [];
    let state = { kind: null, title: "", still: null, error: "" };
    let layer = null;    // <video> or scene container
    let scene = null;    // webwallgl instance
    let engine = null;

    let backdropMode = "";
    const readBackdropMode = () => {   // empty while stylesheets reload: keep the last value
        const v = getComputedStyle(html).getPropertyValue("--lm-backdrop-mode").trim();
        if (v) backdropMode = v;
        return backdropMode;
    };
    const wallpaperMode = () => readBackdropMode() === "wallpaper";
    const host = () => isFriends ? document.body : document.querySelector(FRAME);
    const blurPx = () => parseFloat(getComputedStyle(html).getPropertyValue("--lm-blur-px")) || 0;
    const sceneDpr = () => { const b = blurPx(); return b >= 16 ? 0.5 : b >= 6 ? 0.75 : 1; };

    const loadEngine = () => engine || (engine = new Promise((resolve, reject) => {
        if (window.WebWallGL) return resolve(window.WebWallGL);
        const s = document.createElement("script");
        s.src = ENGINE_URL;
        s.onload = () => window.WebWallGL ? resolve(window.WebWallGL) : reject(new Error("engine missing"));
        s.onerror = () => reject(new Error("engine failed to load"));
        document.head.appendChild(s);
    }));

    const clearLayer = () => {
        if (scene) { try { scene.destroy({ releasePkgCache: true }); } catch {} scene = null; }
        if (layer) { layer.remove(); layer = null; }
    };

    // A video removed from the document is paused, so it is resumed after
    // being moved into a re-rendered frame.
    const placeLayer = () => {
        const where = layer && wallpaperMode() ? host() : null;
        if (layer && where && layer.parentNode !== where) where.prepend(layer);
        if (layer && layer.tagName === "VIDEO" && layer.isConnected && layer.paused &&
            !shouldPause()) layer.play().catch(() => {});
    };

    // Plugin videos come from another origin; CORS keeps them readable for frame capture.
    const showVideo = (src) => {
        layer = document.createElement("video");
        layer.className = "lm-video-layer";
        if (/^https?:/.test(src)) layer.crossOrigin = "anonymous";
        Object.assign(layer, { muted: true, loop: true, autoplay: !shouldPause(), playsInline: true, preload: "auto", src });
        layer.setAttribute("aria-hidden", "true");
        layer.disablePictureInPicture = true;
        placeLayer();
        if (!shouldPause()) layer.play().catch(() => {});
    };

    const showScene = async (makeSource, fps = SCENE_FPS) => {
        layer = document.createElement("div");
        layer.className = "lm-scene-layer";
        layer.setAttribute("aria-hidden", "true");
        placeLayer();
        const el = layer;
        const W = await loadEngine();
        if (layer !== el) return null;
        const inst = await W.mount(el, {
            source: makeSource(W), fit: "cover", fps, renderDpr: sceneDpr(),
            volume: 0, autoplay: !shouldPause(),
        });
        if (layer !== el) { inst.destroy({ releasePkgCache: true }); return null; }
        scene = inst;
        inst.on("error", (err) => fail(err));
        // the window may have been shown while mounting, before scene was set
        if (!shouldPause() && inst.paused) inst.resume();
        return inst;
    };

    /* ---- stills of moving wallpapers ----
     * Scenes run in the main window only; elsewhere, and under the scene layer,
     * the backdrop is a still: a frame of the running scene, or until one is
     * captured the first frame of the preview (often an animated GIF).
     * Wallpaper Engine videos get a frame the same way: their preview is a
     * small thumbnail. */

    const frameKey = (meta) => JSON.stringify([meta.source, meta.kind, meta.id || meta.title || ""]);

    const firstFrame = async (src) => {
        const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
        const bmp = await createImageBitmap(blob);   // a GIF decodes to its first frame
        try { return await toJpeg(bmp, bmp.width, bmp.height, FRAME_SIDE, QUALITY); }
        finally { bmp.close(); }
    };

    // Stores a captured frame and shows it as the still, here and in the other windows.
    const keepFrame = async (blob, key, current) => {
        const [meta] = await read("meta");
        if (!current() || !blob || !meta || frameKey(meta) !== key) return;
        await write({ frame: { key, blob } });
        const u = URL.createObjectURL(blob);
        urls.push(u);
        setStill(u);
        if (channel) channel.postMessage("wallpaper");
    };

    // Once per wallpaper, a few seconds into playback.
    const captureVideoFrame = (video, key) => {
        video.addEventListener("playing", () => setTimeout(async () => {
            if (layer !== video || !video.videoWidth) return;
            try {
                const blob = await toJpeg(video, video.videoWidth, video.videoHeight, FRAME_SIDE, QUALITY);
                await keepFrame(blob, key, () => layer === video);
            } catch (err) { console.warn("[Lumina] video frame:", err); }
        }, FRAME_DELAY), { once: true });
    };

    // Once per wallpaper, after the scene has had time to settle. webwallgl's
    // canvas keeps its drawing buffer, so it can be copied at any time.
    const captureFrame = (inst, key, tries = 3) => setTimeout(async () => {
        const src = scene === inst && layer && layer.querySelector("canvas");
        if (!src || !src.width) return;
        try {
            const c = document.createElement("canvas");
            c.width = FRAME_SIDE;
            c.height = Math.max(1, Math.round(FRAME_SIDE * src.height / src.width));
            const g = c.getContext("2d");
            g.drawImage(src, 0, 0, c.width, c.height);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            let lit = false;
            for (let i = 0; i < px.length && !lit; i += 4 * 997) lit = px[i] + px[i + 1] + px[i + 2] > 0;
            if (!lit) { if (tries > 1) captureFrame(inst, key, tries - 1); return; }   // nothing drawn yet
            const blob = await new Promise(r => c.toBlob(r, "image/jpeg", QUALITY));
            await keepFrame(blob, key, () => scene === inst);
        } catch (err) { console.warn("[Lumina] scene frame:", err); }
    }, FRAME_DELAY);

    let currentStill = DEFAULT_URL;
    const publishWallSource = (src) => {
        if (!isMain) return;
        window.__lmWallSource = src;
        window.dispatchEvent(new Event("lm-wall-change"));
    };

    function fail(err) {
        console.warn("[Lumina] wallpaper failed:", err);
        clearLayer();
        state.error = T.failed;
        publishWallSource({ kind: "picture", url: currentStill });
        refreshCard();
    }

    const syncPlayback = () => {
        const on = !shouldPause();
        if (layer && layer.tagName === "VIDEO") {
            if (on) { if (layer.isConnected && layer.paused) layer.play().catch(() => {}); }
            else if (!layer.paused) layer.pause();
        }
        if (scene) {
            if (on) { if (scene.paused) scene.resume(); }
            else if (!scene.paused) scene.pause();
        }
    };

    document.addEventListener("visibilitychange", syncPlayback);
    if (isMain) {
        window.addEventListener("blur", syncPlayback);
        window.addEventListener("focus", syncPlayback);
        setInterval(() => { if (!document.hidden) syncPlayback(); }, 1000);
    }

    /* ---- mouse ----
     * Steam's UI covers the scene, so its canvas never sees the pointer. Moves
     * in the main window are forwarded to it, once per frame, for parallax and
     * cursor effects; clicks belong to the UI and are not. With the setting off
     * the scene gets one move to its center, as if the mouse were idle. */

    let mouseOn = true, pointer = null, pointerFrame = 0, centered = false;
    const mouseEnabled = () => {   // empty while stylesheets reload: keep the last value
        const v = getComputedStyle(html).getPropertyValue("--lm-wall-mouse").trim();
        if (v) mouseOn = v === "1";
        return mouseOn;
    };

    const forwardPointer = () => {
        pointerFrame = 0;
        const canvas = scene && layer && layer.querySelector("canvas");
        if (!canvas || !pointer) return;
        let { x, y } = pointer;
        if (mouseEnabled()) centered = false;
        else if (centered) return;
        else {
            const r = canvas.getBoundingClientRect();
            x = r.left + r.width / 2; y = r.top + r.height / 2;
            centered = true;
        }
        canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
    };

    if (isMain) {
        window.addEventListener("mousemove", (e) => {
            if (!e.isTrusted || !scene) return;   // skip our own forwarded events
            pointer = { x: e.clientX, y: e.clientY };
            if (!pointerFrame) pointerFrame = requestAnimationFrame(forwardPointer);
        }, { capture: true, passive: true });
    }

    function setStill(url) {
        currentStill = url || DEFAULT_URL;
        if (url) html.style.setProperty("--lm-wallpaper", `url("${url}")`);
        else html.style.removeProperty("--lm-wallpaper");
        shareStill(currentStill);
    }

    /* ---- web pages (Store, Community) ----
     * Other sites, without access to this database: the main window hands the
     * plugin a still of its backdrop, and web pages show it behind their
     * content (css/conditions/backdrop-wallpaper.css). Without the plugin they
     * use the default wallpaper. */

    const isWeb = /(^|\.)(steampowered|steamcommunity)\.com$/.test(location.hostname);
    let shared = null;

    async function shareStill(src) {
        if (!isMain || src === shared) return;
        shared = src;
        if (!plugin) await findPlugin();
        if (!plugin || shared !== src) return;
        try {
            const jpeg = await firstFrame(src);
            const data = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(",")[1]);
                r.onerror = () => reject(r.error);
                r.readAsDataURL(jpeg);
            });
            if (shared === src) await callPlugin("SetStill", { data });
        } catch (err) { console.warn("[Lumina] sharing the backdrop:", err); }
    }

    if (isWeb) {
        html.classList.add("lm-web");
        const refresh = async () => {
            let url = DEFAULT_URL;
            try { const s = await callPlugin("Status"); if (s && s.still) url = s.still; } catch {}
            html.style.setProperty("--lm-web-wallpaper", `url("${url}")`);
        };
        refresh();
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
        setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15000);
    }

    let applying = 0;
    let liveKind = false;   // the current wallpaper has a moving layer in wallpaper mode

    const apply = async () => {
        const run = ++applying;
        liveKind = false;
        const [file, poster, meta0, frame0] = await read("wallpaper", "poster", "meta", "frame");
        const meta = meta0 || (file ? { kind: /^video\//.test(file.type) ? "video" : "picture", source: "local" } : null);
        if (meta && meta.source === "plugin" && !plugin) await findPlugin();
        const base = meta && meta.source === "plugin" ? itemBase(meta.id) : null;

        // Flat backdrop still: scenes and web wallpapers use the captured frame
        // or their preview's first frame, videos the captured frame once there
        // is one; an animated picture keeps moving
        // only in the main window, where it is the wallpaper itself.
        const key = meta && frameKey(meta);
        const frame = frame0 && frame0.key === key ? frame0.blob : null;
        const src = !meta ? null : base ? (meta.preview && base + encodePath(meta.preview))
            : meta.kind === "picture" ? file : poster;
        const gif = typeof src === "string" ? /\.gif$/i.test(src) : !!src && src.type === "image/gif";
        let flat = null;
        if (meta && (meta.kind === "scene" || meta.kind === "web")) {
            flat = frame || (src && await firstFrame(src).catch(() => null));
        } else if (meta && meta.kind === "video" && frame) {
            flat = frame;
        } else if (gif && !(isMain && meta.kind === "picture")) {
            flat = await firstFrame(src).catch(() => null);
        }
        if (run !== applying) return;

        clearLayer();
        const old = urls; urls = [];
        const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
        const live = (start, kind) => start().then(inst => {
            if (!inst) return;
            if (kind === "scene" && layer && layer.querySelector("canvas")) {
                publishWallSource({ kind: "scene", el: layer });
            }
            if (!frame) captureFrame(inst, key);
        }).catch(fail);

        let still = null, error = "";
        if (meta && meta.source === "plugin") {
            if (!base) error = T.pluginOff;
            else still = meta.preview ? base + encodePath(meta.preview) : null;
            state = { kind: meta.kind, title: meta.title || "", still, error };
            setStill(flat ? blobUrl(flat) : still);
            liveKind = !!base && (meta.kind === "video" || ((meta.kind === "scene" || meta.kind === "web") && isMain));
            if (base && wallpaperMode()) {
                if (meta.kind === "video") {
                    showVideo(base + encodePath(meta.file));
                    if (isMain && !frame) captureVideoFrame(layer, key);
                }
                else if ((meta.kind === "scene" || meta.kind === "web") && isMain) {
                    // webwallgl's <60 fps rAF throttle shares one timestamp across all
                    // callbacks, starving web wallpapers with multiple rAF loops
                    live(() => showScene(W => W.httpSource(base), meta.kind === "web" ? 60 : SCENE_FPS), meta.kind);
                }
            }
        } else if (meta) {
            still = meta.kind === "picture" ? (file && blobUrl(file)) : (poster && blobUrl(poster));
            state = { kind: meta.kind, title: meta.title || "", still, error };
            setStill(flat ? blobUrl(flat) : still);
            liveKind = !!file && (meta.kind === "video" || (meta.kind === "scene" && isMain));
            if (file && wallpaperMode()) {
                if (meta.kind === "video") showVideo(blobUrl(file));
                else if (meta.kind === "scene" && isMain) live(() => showScene(W => W.fileSource(file, meta.project)), "scene");
            }
        } else {
            state = { kind: null, title: "", still: null, error: "" };
            setStill(null);
        }
        if (layer && layer.tagName === "VIDEO") {
            publishWallSource({ kind: "video", el: layer });
        } else if (liveKind || (gif && meta && meta.kind === "picture")) {
            publishWallSource({ kind: "none" });
        } else {
            publishWallSource({ kind: "picture", url: currentStill });
        }
        old.forEach(u => URL.revokeObjectURL(u));
        refreshCard();
    };

    const changed = async () => {
        await apply();
        if (channel) channel.postMessage("wallpaper");
    };

    // One-time move from the database used under the old name, Frost Glass.
    const LEGACY_DB = "frost-glass";
    const migrate = async () => {
        if (!isMain || !indexedDB.databases) return false;
        if (!(await indexedDB.databases()).some(d => d.name === LEGACY_DB)) return false;
        const old = await openDb(LEGACY_DB);
        const entries = await new Promise((resolve, reject) => {
            const out = {};
            const t = old.transaction(STORE, "readonly");
            const req = t.objectStore(STORE).openCursor();
            req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } };
            t.oncomplete = () => resolve(out);
            t.onerror = () => reject(t.error);
        });
        old.close();
        const [meta, wallpaper] = await read("meta", "wallpaper");
        if (!meta && !wallpaper && Object.keys(entries).length) await write(entries);
        indexedDB.deleteDatabase(LEGACY_DB);
        return true;
    };

    if (channel) channel.onmessage = (e) => { if (e.data === "wallpaper") apply(); };
    migrate().catch(() => false).then(moved => moved ? changed() : apply());

    // for tools/scenetest.py and tools/plugintest.py
    window.__lmWallpaperState = () => ({
        kind: state.kind, title: state.title, error: state.error, plugin: !!plugin,
        layer: layer ? layer.className : null,
        scene: scene ? { paused: scene.paused, stats: { ...scene.stats }, info: scene.info } : null,
    });

    /* ---- preparing files ---- */

    class UserError extends Error {}

    const toJpeg = (source, w, h, side, quality) => {
        const scale = Math.min(1, side / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
        return new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
    };

    const shrinkPicture = async (file) => {
        const bmp = await createImageBitmap(file);
        try { return await toJpeg(bmp, bmp.width, bmp.height, MAX_SIDE, QUALITY); }
        finally { bmp.close(); }
    };

    // Also checks that the video decodes.
    const posterOf = (file) => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement("video");
        const done = (fn, arg) => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute("src"); fn(arg); };
        const timer = setTimeout(() => done(reject, new Error("timed out")), 20000);
        v.muted = true;
        v.preload = "auto";
        v.onerror = () => done(reject, v.error || new Error("cannot decode"));
        v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 0) / 3); };
        v.onseeked = async () => {
            if (!v.videoWidth) return done(reject, new Error("no video track"));
            done(resolve, await toJpeg(v, v.videoWidth, v.videoHeight, POSTER_SIDE, 0.85));
        };
        v.src = url;
    });

    const tooBig = (file) => file.size > MAX_FILE_MB * 1024 * 1024;

    const useFile = async (file) => {
        if (/^video\//.test(file.type)) {
            if (tooBig(file)) throw new UserError(T.tooBig(MAX_FILE_MB));
            note(T.readingVideo);
            await store({ kind: "video", source: "local", title: file.name }, file, await posterOf(file));
        } else {
            await store({ kind: "picture", source: "local", title: file.name }, await shrinkPicture(file));
        }
    };

    // A picked folder -> Wallpaper Engine items (folders holding a project.json).
    const itemsFromFolder = async (fileList) => {
        const groups = new Map();
        for (const pj of [...fileList].filter(f => /(^|\/)project\.json$/i.test(f.webkitRelativePath))) {
            const dir = pj.webkitRelativePath.slice(0, -"project.json".length);
            groups.set(dir, { dir, pj, files: new Map() });
        }
        for (const f of fileList) {
            const path = f.webkitRelativePath, slash = path.lastIndexOf("/");
            const g = groups.get(path.slice(0, slash + 1));
            if (g) g.files.set(path.slice(slash + 1).toLowerCase(), f);
        }
        const items = [];
        for (const g of groups.values()) {
            try {
                const project = JSON.parse(await g.pj.text());
                const id = g.dir.split("/").filter(Boolean).pop() || "item";
                items.push({ id, project, files: g.files, title: project.title || id,
                    kind: String(project.type || "").toLowerCase() });
            } catch {}
        }
        return items;
    };

    const fileOf = (item, name) => name ? item.files.get(String(name).toLowerCase()) : null;

    const useLocalItem = async (item) => {
        const p = item.project, preview = fileOf(item, p.preview), title = item.title;
        if (item.kind === "scene") {
            const pkg = fileOf(item, "scene.pkg");
            if (!pkg) throw new UserError(T.noPkg);
            if (tooBig(pkg)) throw new UserError(T.tooBig(MAX_FILE_MB));
            note(T.savingScene);
            await store({ kind: "scene", source: "local", title, project: p }, pkg, preview);
        } else if (item.kind === "video") {
            const v = fileOf(item, p.file);
            if (!v) throw new UserError(T.noVideo);
            if (tooBig(v)) throw new UserError(T.tooBig(MAX_FILE_MB));
            note(T.savingVideo);
            await store({ kind: "video", source: "local", title }, v, preview || await posterOf(v));
        } else {
            if (!preview) throw new UserError(T.noPreview);
            await store({ kind: "picture", source: "local", title }, preview);
            note(item.kind === "web" ? T.webNeedsPlugin : T.previewOnly);
        }
    };

    /* ---- gallery ---- */

    // items: [{ title, kind, preview (URL or Blob), pick() }]
    const gallery = (items, heading) => {
        document.querySelector(".lm-gallery")?.remove();
        const root = document.createElement("div");
        root.className = "lm-gallery";
        const blobUrls = new Map();
        const previewUrl = (p) => {
            if (typeof p === "string") return p;
            if (!p) return null;
            if (!blobUrls.has(p)) blobUrls.set(p, URL.createObjectURL(p));
            return blobUrls.get(p);
        };
        const close = () => {
            root.remove();
            blobUrls.forEach(u => URL.revokeObjectURL(u));
            blobUrls.clear();
            document.removeEventListener("keydown", onKey, true);
        };
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
        document.addEventListener("keydown", onKey, true);
        root.addEventListener("click", (e) => { if (e.target === root) close(); });

        const panel = document.createElement("div");
        panel.className = "lm-gallery-panel";
        const head = document.createElement("div");
        head.className = "lm-gallery-head";
        const h = document.createElement("div");
        h.className = "lm-gallery-title";
        h.textContent = heading;
        const filters = document.createElement("div");
        filters.className = "lm-gallery-filters";
        const x = document.createElement("button");
        x.className = "lm-gallery-close";
        x.textContent = "✕";
        x.title = T.close;
        x.onclick = close;
        head.append(h, filters, x);

        const grid = document.createElement("div");
        grid.className = "lm-gallery-grid";
        const render = (kind) => {
            grid.replaceChildren(...items.filter(it => kind === null || it.kind === kind).map(it => {
                const card = document.createElement("button");
                card.className = "lm-gallery-card";
                card.title = it.title;
                const img = document.createElement("img");
                img.loading = "lazy";
                img.decoding = "async";
                const src = previewUrl(it.preview);
                if (src) img.src = src;
                const badge = document.createElement("span");
                badge.className = "lm-gallery-badge";
                badge.textContent = kindLabel(it.kind);
                const name = document.createElement("span");
                name.className = "lm-gallery-name";
                name.textContent = it.title;
                card.append(img, badge, name);
                card.onclick = async () => {
                    close();
                    try { await it.pick(); await changed(); } catch (err) { report(err); }
                };
                return card;
            }));
        };
        const kinds = [...new Set(items.map(i => i.kind))].sort();
        [[null, `${T.all} ${items.length}`], ...kinds.map(k => [k, `${kindLabel(k)} ${items.filter(i => i.kind === k).length}`])]
            .forEach(([k, label], i) => {
                const b = document.createElement("button");
                b.textContent = label;
                b.className = i === 0 ? "active" : "";
                b.onclick = () => { filters.querySelectorAll("button").forEach(x => x.className = ""); b.className = "active"; render(k); };
                filters.appendChild(b);
            });
        render(null);
        panel.append(head, grid);
        root.appendChild(panel);
        document.body.appendChild(root);
    };

    /* ---- actions ---- */

    function report(err) {
        console.warn("[Lumina] wallpaper:", err);
        note(err instanceof UserError ? err.message : T.badFile);
    }

    const pickFile = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/mp4,video/webm";
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try { await useFile(file); await changed(); } catch (err) { report(err); }
        };
        input.click();
    };

    const pickEngine = async () => {
        const p = await findPlugin();
        if (p && p.hasLibrary !== false) {
            note(T.readingLibrary);
            try {
                const got = await callPlugin("List");
                const list = Array.isArray(got) ? got : [];
                note("");
                if (!list.length) throw new UserError(T.emptyLibrary);
                gallery(list.map(it => ({
                    title: it.title, kind: it.type,
                    preview: it.preview ? itemBase(it.id) + encodePath(it.preview) : null,
                    pick: async () => {
                        if (it.type === "application") throw new UserError(T.appUnsupported);
                        const kind = ["scene", "web", "video"].includes(it.type) ? it.type : "picture";
                        await store({ kind, source: "plugin", id: it.id, title: it.title, file: it.file, preview: it.preview });
                    },
                })), T.libraryTitle);
            } catch (err) { report(err); }
            return;
        }
        if (p && p.hasLibrary === false) pluginIssue = T.noLibrary;
        // No plugin or no WE library: pick one item folder, or the whole library folder.
        // If the plugin is enabled but can't serve the library, say why first.
        if (pluginIssue) note(pluginIssue);
        const input = document.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.onchange = async () => {
            if (!input.files || !input.files.length) return;
            note(T.readingFolder);
            try {
                const items = await itemsFromFolder(input.files);
                note("");
                if (!items.length) throw new UserError(T.noItems);
                if (items.length === 1) { await useLocalItem(items[0]); await changed(); return; }
                gallery(items.map(it => ({
                    title: it.title, kind: it.kind, preview: fileOf(it, it.project.preview),
                    pick: () => useLocalItem(it),
                })), T.pickOne);
            } catch (err) { report(err); }
        };
        input.click();
    };

    const reset = async () => { await write({ meta: null, wallpaper: null, poster: null, frame: null }); await changed(); };

    /* ---- settings card ---- */

    let card = null, preview = null, badge = null, title = null, resetBtn = null, noteEl = null;
    let noteText = "";

    function note(text) { noteText = text || ""; refreshCard(); }

    function refreshCard() {
        if (!card || !card.isConnected) return;
        preview.style.backgroundImage = `url("${state.still || DEFAULT_URL}")`;
        badge.textContent = state.kind ? kindLabel(state.kind) : T.default;
        title.textContent = state.title || "";
        resetBtn.disabled = !state.kind;
        resetBtn.style.opacity = state.kind ? "" : "0.45";
        noteEl.textContent = noteText || state.error || "";
        noteEl.style.display = noteEl.textContent ? "" : "none";
    }

    const button = (label, onClick, tip) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "DialogButton _DialogLayout Secondary lm-wp-button";
        b.textContent = label;
        if (tip) b.title = tip;
        b.addEventListener("click", onClick);
        return b;
    };

    // Cloned from a slider row (its control sits below the text), so it
    // matches Steam's Field styling.
    const buildCard = (template) => {
        const r = template.cloneNode(true);
        const label = r.querySelector(".FieldLabel");
        const desc = r.querySelector(".FieldDescription");
        const slot = r.querySelector(".FieldChildrenInner");
        if (!label || !slot) return null;
        r.removeAttribute("data-condition");
        r.setAttribute("data-lm-wallpaper", "");
        label.textContent = T.label;
        if (desc) desc.textContent = T.desc;

        const box = document.createElement("div");
        box.className = "lm-wp-card";
        preview = document.createElement("div");
        preview.className = "lm-wp-preview";
        badge = document.createElement("span");
        badge.className = "lm-wp-badge";
        title = document.createElement("span");
        title.className = "lm-wp-title";
        preview.append(badge, title);
        const row = document.createElement("div");
        row.className = "lm-wp-buttons";
        resetBtn = button("↺", reset, T.reset);
        resetBtn.classList.add("lm-wp-icon");
        row.append(button(T.chooseFile, pickFile), button(T.engine, pickEngine, T.engineTip), resetBtn);
        noteEl = document.createElement("div");
        noteEl.className = "lm-wp-note";
        box.append(preview, row, noteEl);
        slot.replaceChildren(box);
        return r;
    };

    // A dropdown row's value as its config key: English text as shown, or the
    // key js/i18n.js keeps in data-lm-value when it shows a translation
    const rowValue = (row) => {
        const shown = row && row.querySelector(".DialogDropDown_CurrentDisplay");
        if (!shown) return "";
        const text = shown.textContent.trim();
        return /^[ -~]*$/.test(text) ? text : (shown.dataset.lmValue || "");
    };

    const BACKDROPS = { Wallpaper: "wallpaper", Aurora: "aurora", Acrylic: "acrylic" };
    const selectedBackdrop = (anchor) => BACKDROPS[rowValue(anchor)] || readBackdropMode() || "wallpaper";

    const setHidden = (el, hidden) => {
        if (!el) return;
        const val = hidden ? "1" : "0";
        if (el.dataset.lmHidden !== val) el.dataset.lmHidden = val;
    };

    let lastSettingsBlur = "";
    const syncSettings = () => {
        const backdropAnchor = document.querySelector(`[data-condition="${CONDITION}"]`);
        if (backdropAnchor) {
            const mode = selectedBackdrop(backdropAnchor);
            setHidden(document.querySelector('[data-condition="Blur"]'), mode === "acrylic");
            setHidden(document.querySelector('[data-condition="Wallpaper mouse"]'), mode !== "wallpaper");
            const desktopBlurRow = document.querySelector('[data-condition="Desktop blur"]');
            setHidden(desktopBlurRow, mode !== "acrylic");
            if (desktopBlurRow && mode === "acrylic") {
                const target = { Strong: "acrylic", Soft: "blur" }[rowValue(desktopBlurRow)] || "";
                if (target && target !== lastSettingsBlur) {
                    const prev = lastSettingsBlur;
                    lastSettingsBlur = target;
                    if (prev) {
                        callPlugin("PatchAcrylic", { spec: JSON.stringify({ enabled: true, mode: target }) }).catch(() => {});
                    }
                }
            }
            if (card && card.isConnected) {
                setHidden(card, mode !== "wallpaper");
            } else if (!document.querySelector("[data-lm-wallpaper]")) {
                const slider = document.querySelector("[data-condition] .MillenniumThemeSliderValue");
                const c = buildCard((slider && slider.closest("[data-condition]")) || backdropAnchor);
                if (c) {
                    card = c;
                    setHidden(card, mode !== "wallpaper");
                    backdropAnchor.after(card);
                    refreshCard();
                }
            }
        } else {
            lastSettingsBlur = "";
            if (card && card.isConnected) {
                card.remove();
                card = null;
            }
        }

        const glassAnchor = document.querySelector('[data-condition="Game list"]');
        if (glassAnchor) {
            const value = rowValue(glassAnchor);
            const isAcrylic = value === "Acrylic", isLiquid = value === "Liquid glass";
            if (isAcrylic || isLiquid) {
                setHidden(document.querySelector('[data-condition="Liquid opacity"]'), isAcrylic);
                setHidden(document.querySelector('[data-condition="Refraction"]'), isAcrylic);
                setHidden(document.querySelector('[data-condition="Liquid blur"]'), isAcrylic);
                setHidden(document.querySelector('[data-condition="Acrylic blur"]'), isLiquid);
            }
        }
    };

    // Follows the backdrop mode: the moving layer is added on entering
    // wallpaper mode and removed on leaving it, and DWM desktop acrylic is
    // synced through the companion plugin. While stylesheets reload the
    // mode reads empty for a moment, so leaving is confirmed after a delay.
    let leaving = 0;
    let lastAcrylicKey = "";
    const readAcrylicMode = () => {
        const v = getComputedStyle(html).getPropertyValue("--lm-acrylic-mode").trim();
        return v === "acrylic" ? "acrylic" : "blur";
    };
    const syncAcrylic = () => {
        if (!isMain) return;
        const mode = readBackdropMode();
        if (!mode) return;
        const on = mode === "acrylic";
        const blurMode = on ? readAcrylicMode() : "blur";
        const key = on ? blurMode : "off";
        if (key === lastAcrylicKey) return;
        lastAcrylicKey = key;
        callPlugin("PatchAcrylic", { spec: JSON.stringify({ enabled: on, mode: blurMode }) })
            .catch(() => { if (lastAcrylicKey === key) lastAcrylicKey = ""; });
    };
    const syncLayer = () => {
        syncAcrylic();
        syncPlayback();
        if (wallpaperMode()) {
            clearTimeout(leaving); leaving = 0;
            if (!layer && liveKind && !state.error) { liveKind = false; apply(); }
            else placeLayer();
        } else if (layer && !leaving) {
            leaving = setTimeout(() => {
                leaving = 0;
                if (!wallpaperMode()) { clearLayer(); publishWallSource({ kind: "none" }); }
            }, 1000);
        }
    };

    // The settings page and the backdrop frame are re-rendered by React;
    // stylesheet links change in head. Coalesce settings scans to one per
    // frame so heavy DOM commits (e.g. switching games) don't re-scan per batch.
    let pending = 0, settingsRaf = 0;
    const scheduleLayer = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = 0; syncSettings(); syncLayer(); }, 250);
    };
    const scheduleSettings = () => {
        if (settingsRaf) return;
        settingsRaf = requestAnimationFrame(() => {
            settingsRaf = 0;
            syncSettings();
            mo.takeRecords();   // drop our own card / attribute mutations
        });
    };
    const mo = new MutationObserver(() => {
        scheduleSettings();
        scheduleLayer();
    });
    mo.observe(html, { childList: true, subtree: true, characterData: true });
    document.addEventListener("load", (e) => { if (e.target.tagName === "LINK") scheduleLayer(); }, true);
    syncSettings();
    syncAcrylic();
})();
