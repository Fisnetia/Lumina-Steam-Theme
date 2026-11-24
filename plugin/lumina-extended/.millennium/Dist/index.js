// lumina-extended frontend: while Lumina's backdrop is Acrylic, new Steam windows
// are created transparent-capable; after windows open it asks the backend to
// patch them (the backend reads the theme's settings and decides).
const MILLENNIUM_IS_CLIENT_MODULE = true, pluginName = "lumina-extended";
(window.PLUGIN_LIST ||= {})[pluginName] ||= {};
window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||= {};

const TARGET_FLAGS = [4114, 2];
const TRANSPARENT_FLAG = "274";

// whether the backdrop is Acrylic, as the backend last heard; window.open
// needs it synchronously
let acrylicOn = false;
const call = (method, args) => {
    try {
        if (typeof Millennium === "undefined" || typeof Millennium.callServerMethod !== "function") return;
        Promise.resolve(Millennium.callServerMethod(pluginName, method, args)).then((res) => {
            const r = typeof res === "string" ? JSON.parse(res) : res;
            if (r && typeof r.enabled === "boolean") acrylicOn = r.enabled;
        }).catch(() => {});
    } catch {}
};
const patchAcrylic = () => call("PatchAcrylic", { spec: "{}" });
setInterval(() => call("AcrylicState", {}), 2000);

const patchSoon = (delays) => {
    for (const ms of delays) setTimeout(patchAcrylic, ms);
};

// windows opened in a burst share one patch, plus one more once they have settled
let quick = 0, settle = 0;
const patchAfterOpen = () => {
    clearTimeout(quick);
    clearTimeout(settle);
    quick = setTimeout(patchAcrylic, 300);
    settle = setTimeout(patchAcrylic, 1500);
};

if (!window.__lmExtendedOpenHook && typeof window.open === "function") {
    window.__lmExtendedOpenHook = true;
    const origOpen = window.open;
    window.open = function (url, target, features, replace) {
        if (typeof url === "string" && url.includes("createflags=")) {
            try {
                const parsed = new URL(url);
                const flag = parseInt(parsed.searchParams.get("createflags") || "", 10);
                if (acrylicOn && TARGET_FLAGS.includes(flag)) {
                    parsed.searchParams.set("createflags", TRANSPARENT_FLAG);
                    url = parsed.toString();
                }
            } catch {}
        }
        const win = origOpen.call(this, url, target, features, replace);
        patchAfterOpen();
        return win;
    };
}

let PluginEntryPointMain = function () {
    return {
        default: async function () {
            patchAcrylic();
            patchSoon([500, 2000, 5000]);
        },
    };
};

(async () => {
    const plugin = PluginEntryPointMain();
    Object.assign(window.PLUGIN_LIST[pluginName], {
        ...plugin, __millennium_internal_plugin_name_do_not_use_or_change__: pluginName,
    });
    await plugin.default();
    MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName });
})();
