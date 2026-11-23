/*
 * Chinese labels for the theme's settings.
 *
 * Condition names and values in skin.json double as config keys, so they stay
 * English. When Steam runs in Chinese, their visible text is rewritten in the
 * Millennium settings page and in dropdown menus opened from it. Only text
 * node values change, so React keeps its nodes.
 */
(() => {
    if (window.__lmI18n) return;
    window.__lmI18n = true;

    const lang = document.documentElement.lang || navigator.language || "";
    if (!/^zh/i.test(lang)) return;

    const LABELS = {
        "Backdrop": "背景", "Glass": "玻璃", "Motion": "动效",
        "Blur": "模糊", "Opacity": "不透明度", "Corner radius": "圆角",
        "Menu animation": "菜单动画", "Smooth scrolling": "平滑滚动", "Nav menu": "导航菜单",
        "Wallpaper mouse": "壁纸鼠标响应", "Game list": "游戏栏",
        "Liquid opacity": "液态玻璃不透明度", "Refraction": "折射强度",
    };
    // color pickers (root-colors.css)
    const COLORS = {
        "Accent": "强调色",
        "Selection, progress bars and the aurora.": "选中项、进度条与极光背景的颜色",
        "Glass tint": "玻璃着色",
        "Base color of the panels; their opacity is a separate slider.": "面板底色，深浅由不透明度控制",
    };
    const DESCRIPTIONS = {
        "Backdrop": "玻璃面板后方的背景。亚克力需启用 dwmx 插件",
        "Blur": "背景模糊程度",
        "Opacity": "面板着色深浅，越低越通透",
        "Corner radius": "面板、按钮和菜单的圆角大小",
        "Menu animation": "菜单、库分类展开收起与切换游戏时的动画",
        "Smooth scrolling": "游戏列表的鼠标滚轮平滑滚动",
        "Nav menu": "商店、库、社区等菜单共用一个面板，切换时平滑变形",
        "Wallpaper mouse": "Scene 壁纸在主窗口里跟随鼠标（视差、光标特效）",
        "Game list": "经典面板，或四周留边、边缘折射背景的悬浮液态玻璃",
        "Liquid opacity": "仅液态玻璃：游戏栏和菜单的着色深浅",
        "Refraction": "仅液态玻璃：背景从边缘向内弯折的范围",
    };
    // A dropdown menu is translated only when its items are exactly one of these sets.
    const OPTION_SETS = [
        { "Aurora": "极光", "Wallpaper": "壁纸", "Acrylic": "亚克力" },
        { "Cascade": "级联", "Fade": "淡入", "Off": "关闭" },
        { "Standard": "标准", "Soft": "柔和", "Off": "关闭" },
        { "Morph": "变形", "Native": "原生" },
        { "On": "开启", "Off": "关闭" },
        { "Classic": "经典", "Liquid glass": "液态玻璃" },
        { "Backdrop": "背景", "Glass": "玻璃", "Motion": "动效" },
    ];
    const VALUES = Object.assign({}, ...OPTION_SETS);
    // Only the current tab's rows are rendered; any one tab's pair identifies our page.
    const SIGNATURES = [["Backdrop", "Blur"], ["Opacity", "Corner radius"], ["Menu animation", "Smooth scrolling"]];
    const onOurPage = () => SIGNATURES.some(pair => pair.every(k => document.querySelector(`[data-condition="${k}"]`)));

    // Replace every text node under `root` whose trimmed value is a key of `map`.
    const swap = (root, map) => {
        if (!root) return;
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const to = map[n.nodeValue.trim()];
            if (to) n.nodeValue = to;
        }
    };

    const translatePage = () => {
        if (!onOurPage()) return;
        for (const row of document.querySelectorAll("[data-condition]")) {
            const key = row.getAttribute("data-condition");
            if (!LABELS[key]) continue;
            swap(row.querySelector(".FieldLabel"), LABELS);
            const desc = row.querySelector(".FieldDescription");
            const node = desc && [...desc.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
            if (node && DESCRIPTIONS[key] && node.nodeValue !== DESCRIPTIONS[key]) node.nodeValue = DESCRIPTIONS[key];
            swap(row.querySelector(".DialogDropDown_CurrentDisplay"), VALUES);
        }
        // the tab picker above the rows
        document.querySelectorAll(".DialogDropDown_CurrentDisplay").forEach(el => swap(el, LABELS));
        // color pickers are Field rows without data-condition
        document.querySelectorAll(".Field:not([data-condition])").forEach(el => swap(el, COLORS));
    };

    const translateMenus = () => {
        for (const menu of document.querySelectorAll(".contextMenu")) {
            const texts = [...menu.querySelectorAll(".contextMenuItem")].map(i => i.textContent.trim());
            const set = OPTION_SETS.find(s => {
                const keys = Object.keys(s), zh = Object.values(s);
                return texts.length === keys.length && texts.every(t => keys.includes(t) || zh.includes(t));
            });
            if (set) swap(menu, set);
        }
    };

    // Menus are translated as soon as nodes arrive, before they paint; the
    // page itself at most every 100ms.
    let pending = 0;
    new MutationObserver((records) => {
        if (records.some(r => r.addedNodes.length)) translateMenus();
        if (!pending) pending = setTimeout(() => { pending = 0; translatePage(); }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    translatePage();
    translateMenus();
})();
