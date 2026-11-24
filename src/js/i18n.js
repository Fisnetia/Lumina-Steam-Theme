/*
 * Chinese labels for the theme's settings.
 *
 * Condition names and values in skin.json double as config keys, so they stay
 * English. When Steam runs in Chinese, their visible text is rewritten in the
 * Millennium settings page and in dropdown menus opened from it. Only text
 * node values change, so React keeps its nodes. A translated dropdown keeps
 * its value's key in data-lm-value (read by js/wallpaper.js).
 */
(() => {
    if (window.__lmI18n) return;
    window.__lmI18n = true;

    const lang = document.documentElement.lang || navigator.language || "";
    if (!/^zh/i.test(lang)) return;

    const LABELS = {
        "Backdrop": "背景", "Interface": "界面", "Motion": "动效",
        "Blur": "模糊", "Opacity": "不透明度", "Corner radius": "圆角",
        "Menu animation": "菜单动画", "Smooth scrolling": "平滑滚动", "Nav menu": "导航菜单",
        "Wallpaper mouse": "壁纸鼠标响应", "Desktop blur": "桌面模糊", "Game list": "玻璃材质",
        "Liquid opacity": "液态玻璃不透明度", "Refraction": "折射强度",
        "Nav position": "导航位置", "URL bar": "URL 栏",
    };
    // color pickers (root-colors.css)
    const COLORS = {
        "Accent": "强调色",
        "Selection, progress bars and the aurora.": "选中项、进度条与极光背景的颜色",
        "Glass tint": "玻璃着色",
        "Base color of the panels; their opacity is a separate slider.": "面板底色，深浅由不透明度控制",
    };
    const DESCRIPTIONS = {
        "Backdrop": "玻璃面板后方的背景。桌面亚克力需启用配套插件 Lumina Extended 以透出系统桌面",
        "Blur": "背景模糊程度",
        "Wallpaper mouse": "Scene 壁纸在主窗口里跟随鼠标（视差、光标特效）",
        "Desktop blur": "桌面透出时的系统模糊强度：轻模糊保留更多桌面轮廓，强模糊为重磨砂亚克力",
        "Game list": "液态玻璃在边缘折射背景；亚克力为重模糊磨砂，带细微噪点（无需插件）",
        "Liquid opacity": "悬浮液态玻璃面板、菜单和胶囊的着色深浅",
        "Refraction": "背景从边缘向内弯折的范围",
        "Opacity": "面板着色深浅，越低越通透",
        "Corner radius": "面板、按钮和菜单的圆角大小",
        "Nav position": "商店、库、社区胶囊的位置。居中：在标题栏里，放不下时换到第二行；靠左、靠右：在第二行，网页上与 URL 栏同一行",
        "URL bar": "常驻：库等 Steam 页面也保留 URL 栏，显示页面路径，切换页面时布局不跳动；仅网页：只在商店、社区等网页上显示",
        "Menu animation": "菜单、库分类展开收起与切换游戏时的动画",
        "Nav menu": "商店、库、社区等菜单共用一个面板，切换时平滑变形",
        "Smooth scrolling": "游戏列表的鼠标滚轮平滑滚动",
    };
    // A dropdown menu is translated only when its items match one of these sets.
    const BACKDROP_OPTIONS = { "Wallpaper": "壁纸", "Aurora": "极光", "Acrylic": "桌面亚克力" };
    const ACRYLIC_BLUR_OPTIONS = { "Soft": "轻模糊", "Strong": "强模糊" };
    const GLASS_OPTIONS = { "Liquid glass": "液态玻璃", "Acrylic": "亚克力" };
    const TAB_OPTIONS = { "Backdrop": "背景", "Interface": "界面", "Motion": "动效" };
    const TAB_EXTRAS = ["Colors", "颜色"];
    const OPTION_SETS = [
        BACKDROP_OPTIONS,
        ACRYLIC_BLUR_OPTIONS,
        GLASS_OPTIONS,
        { "Cascade": "级联", "Fade": "淡入", "Off": "关闭" },
        { "Soft": "柔和", "Standard": "标准", "Off": "关闭" },
        { "Morph": "变形", "Native": "原生" },
        { "On": "开启", "Off": "关闭" },
        { "Center": "居中", "Left": "第二行靠左", "Right": "第二行靠右" },
        { "Always": "常驻", "Web pages": "仅网页" },
    ];
    const ROW_VALUES = { "Backdrop": BACKDROP_OPTIONS, "Desktop blur": ACRYLIC_BLUR_OPTIONS, "Game list": GLASS_OPTIONS };
    const VALUES = Object.assign({}, ...OPTION_SETS);
    // Only the current tab's rows are rendered; any tab's pair or our color
    // picker description identifies our settings page.
    const SIGNATURES = [["Backdrop", "Blur"], ["Opacity", "Corner radius"], ["Menu animation", "Smooth scrolling"]];
    const COLOR_SIGS = ["Selection, progress bars and the aurora.", "选中项、进度条与极光背景的颜色"];
    const FIELD_SEL = "{{GamepadDialogContent.Field}}";
    const MENU_SEL = "{{contextMenu.contextMenu}}, {{DialogDropDownMenu_Item.DialogDropDownMenu}}";
    const ITEM_SEL = "{{contextMenu.contextMenuItem}}, {{DialogDropDownMenu_Item.DialogDropDownMenu_Item}}";
    const onColorsTab = () => document.querySelector(".DialogDropDown_CurrentDisplay") &&
        [...document.querySelectorAll(`${FIELD_SEL}:not([data-condition])`)]
            .some(el => COLOR_SIGS.some(s => el.textContent.includes(s)));
    const onOurPage = () =>
        (document.querySelector("[data-condition]") &&
            SIGNATURES.some(pair => pair.every(k => document.querySelector(`[data-condition="${k}"]`)))) ||
        onColorsTab();

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
            swap(row.querySelector("{{GamepadDialogContent.FieldLabel}}"), LABELS);
            const desc = row.querySelector("{{GamepadDialogContent.FieldDescription}}");
            const node = desc && [...desc.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
            if (node && DESCRIPTIONS[key] && node.nodeValue !== DESCRIPTIONS[key]) node.nodeValue = DESCRIPTIONS[key];
            const shown = row.querySelector(".DialogDropDown_CurrentDisplay");
            const values = ROW_VALUES[key] || VALUES;
            if (shown && values[shown.textContent.trim()]) shown.dataset.lmValue = shown.textContent.trim();
            swap(shown, values);
        }
        // the tab picker above the rows
        document.querySelectorAll(".DialogDropDown_CurrentDisplay").forEach(el => swap(el, LABELS));
        // color pickers are Field rows without data-condition
        document.querySelectorAll(`${FIELD_SEL}:not([data-condition])`).forEach(el => swap(el, COLORS));
    };

    const matchSet = (texts, set) => {
        const keys = Object.keys(set), zh = Object.values(set);
        return texts.length === keys.length && texts.every(t => keys.includes(t) || zh.includes(t));
    };

    const translateMenus = () => {
        for (const menu of document.querySelectorAll(MENU_SEL)) {
            const texts = [...menu.querySelectorAll(ITEM_SEL)].map(i => i.textContent.trim());
            if (!texts.length) continue;
            const set = OPTION_SETS.find(s => matchSet(texts, s))
                || (matchSet(texts.filter(t => !TAB_EXTRAS.includes(t)), TAB_OPTIONS) ? TAB_OPTIONS : null);
            if (set) swap(menu, set);
        }
    };

    // Translate synchronously in the MutationObserver microtask (before paint)
    // so settings rows and dropdowns never flash English or jump after render.
    const mo = new MutationObserver((records) => {
        if (records.some(r => r.addedNodes.length)) translateMenus();
        translatePage();
        mo.takeRecords();   // drop mutations from our own text swaps
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    translatePage();
    translateMenus();
    mo.takeRecords();
})();
