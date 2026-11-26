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
        "Liquid opacity": "液态玻璃不透明度", "Refraction": "折射强度", "Liquid blur": "模糊", "Acrylic blur": "模糊",
        "Nav position": "导航位置", "Play bar": "开始栏位置", "URL bar": "URL 栏",
    };
    // color pickers (root-colors.css)
    const COLORS = {
        "Accent": "强调色",
        "Selection, progress bars and the aurora.": "选中项、进度条与极光背景的颜色",
        "Glass tint": "玻璃着色",
        "Base color of the panels; their opacity is a separate slider.": "面板底色，深浅由不透明度控制",
    };
    const DESCRIPTIONS = {
        "Backdrop": "玻璃后面的背景。桌面亚克力需启用 Lumina Extended 插件",
        "Blur": "背景的模糊程度",
        "Wallpaper mouse": "Scene 壁纸跟随鼠标",
        "Desktop blur": "透出桌面时的模糊强度",
        "Game list": "液态玻璃：边缘折射；亚克力：磨砂模糊",
        "Liquid opacity": "液态玻璃的着色深浅",
        "Refraction": "边缘折射的范围",
        "Liquid blur": "液态玻璃的磨砂模糊程度",
        "Acrylic blur": "亚克力的模糊程度",
        "Opacity": "面板着色深浅，越低越通透",
        "Corner radius": "面板、按钮和菜单的圆角",
        "Nav position": "商店、库、社区胶囊的位置；靠左、靠右时在第二行",
        "Play bar": "游戏详情页开始按钮与统计信息栏的对齐方式",
        "URL bar": "常驻：库等页面也显示 URL 栏和页面路径",
        "Menu animation": "菜单、分类展开收起和切换游戏的动画",
        "Nav menu": "变形：导航菜单共用一个面板，切换时变形",
        "Smooth scrolling": "游戏列表和库页面的滚轮平滑滚动",
    };
    // A dropdown menu is translated only when its items match one of these sets.
    const BACKDROP_OPTIONS = { "Wallpaper": "壁纸", "Aurora": "极光", "Acrylic": "桌面亚克力" };
    const ACRYLIC_BLUR_OPTIONS = { "Soft": "轻模糊", "Strong": "强模糊" };
    const GLASS_OPTIONS = { "Liquid glass": "液态玻璃", "Acrylic": "亚克力" };
    const NAVPOS_OPTIONS = { "Center": "居中", "Left": "第二行靠左", "Right": "第二行靠右" };
    const PLAYBAR_OPTIONS = { "Center": "居中", "Left": "居左", "Right": "居右" };
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
        NAVPOS_OPTIONS,
        PLAYBAR_OPTIONS,
        { "Always": "常驻", "Web pages": "仅网页" },
    ];
    const ROW_VALUES = {
        "Backdrop": BACKDROP_OPTIONS,
        "Desktop blur": ACRYLIC_BLUR_OPTIONS,
        "Game list": GLASS_OPTIONS,
        "Nav position": NAVPOS_OPTIONS,
        "Play bar": PLAYBAR_OPTIONS,
    };
    const VALUES = Object.assign({}, ...OPTION_SETS);
    let activeCondition = null;
    const trackCondition = (e) => {
        const row = e.target && e.target.closest && e.target.closest("[data-condition]");
        if (row) activeCondition = row.getAttribute("data-condition");
    };
    document.addEventListener("pointerdown", trackCondition, true);
    document.addEventListener("focusin", trackCondition, true);
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
        const preferred = activeCondition && ROW_VALUES[activeCondition];
        for (const menu of document.querySelectorAll(MENU_SEL)) {
            const texts = [...menu.querySelectorAll(ITEM_SEL)].map(i => i.textContent.trim());
            if (!texts.length) continue;
            const set = (preferred && matchSet(texts, preferred) ? preferred : null)
                || OPTION_SETS.find(s => matchSet(texts, s))
                || (matchSet(texts.filter(t => !TAB_EXTRAS.includes(t)), TAB_OPTIONS) ? TAB_OPTIONS : null);
            if (set) swap(menu, set);
        }
    };

    // Translate synchronously in the MutationObserver microtask (before paint)
    // so settings rows and dropdowns never flash English or jump after render.
    const isGalleryTarget = (t) => {
        const el = t && (t.nodeType === 1 ? t : t.parentElement);
        return !!(el && el.closest(".lm-gallery"));
    };
    const mo = new MutationObserver((records) => {
        if (records.every(r => isGalleryTarget(r.target))) return;
        if (records.some(r => r.addedNodes.length)) translateMenus();
        translatePage();
        mo.takeRecords();   // drop mutations from our own text swaps
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    translatePage();
    translateMenus();
    mo.takeRecords();
})();
