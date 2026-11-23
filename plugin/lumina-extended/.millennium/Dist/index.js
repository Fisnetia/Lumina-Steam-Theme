// lumina-extended frontend: only reports itself loaded. The theme calls the backend directly.
const MILLENNIUM_IS_CLIENT_MODULE = true, pluginName = "lumina-extended";
(window.PLUGIN_LIST ||= {})[pluginName] ||= {};
window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||= {};
let PluginEntryPointMain = function () { return { default: async function () {} }; };
(async () => {
    const plugin = PluginEntryPointMain();
    Object.assign(window.PLUGIN_LIST[pluginName], {
        ...plugin, __millennium_internal_plugin_name_do_not_use_or_change__: pluginName,
    });
    await plugin.default();
    MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName });
})();
