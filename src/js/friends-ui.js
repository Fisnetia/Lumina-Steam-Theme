/* Lumina: lightweight quick-filter bar and Ctrl+F shortcut for the Steam Friends List. */
(function () {
    "use strict";

    if (window.__lmFriendsUi) return;
    window.__lmFriendsUi = true;

    const root = document.documentElement;
    if (!root.classList.contains("friendsui-container")) return;

    const isZh = /^zh/i.test(root.lang || navigator.language || "");
    const COPY = isZh
        ? {
              search: "搜索好友…",
              all: "全部",
              ingame: "游戏中",
              online: "在线",
              offline: "离线",
              emptyIngame: "暂无好友在游戏中",
              emptyOnline: "暂无在线好友",
              emptyOffline: "暂无离线好友",
          }
        : {
              search: "Search friends...",
              all: "All",
              ingame: "In-Game",
              online: "Online",
              offline: "Offline",
              emptyIngame: "No friends in-game",
              emptyOnline: "No friends online",
              emptyOffline: "No offline friends",
          };

    const TABS = [
        { id: "all", label: COPY.all },
        { id: "ingame", label: COPY.ingame },
        { id: "online", label: COPY.online },
        { id: "offline", label: COPY.offline },
    ];

    let activeFilter = "all";
    let barEl = null;
    let indicatorEl = null;
    const tabButtons = new Map();
    const countEls = new Map();
    let observedList = null;
    let listObserver = null;
    let structureObserver = null;
    let resizeObserver = null;
    let syncTimer = 0;
    const autoExpanded = new Set();

    function parseGroupCount(group) {
        if (!group) return 0;
        const badge = group.querySelector(":scope > .groupName .groupCount, :scope > .groupHeaderContainer .groupCount");
        if (badge) {
            const match = (badge.textContent || "").match(/\d+/);
            if (match) return parseInt(match[0], 10);
        }
        return group.querySelectorAll(".friend").length;
    }

    function getMatchingGroups(friendlist, filter) {
        if (filter === "ingame") {
            return Array.from(friendlist.querySelectorAll(".friendGroup.gameGroup"));
        }
        if (filter === "online") {
            return Array.from(friendlist.querySelectorAll(".friendGroup.onlineFriends"));
        }
        if (filter === "offline") {
            return Array.from(friendlist.querySelectorAll(".friendGroup.offlineFriends"));
        }
        return [];
    }

    function clickGroupToggle(group) {
        const header = group && group.querySelector(":scope > .groupName, :scope > .groupHeaderContainer > .groupName");
        if (header) header.click();
    }

    function isGroupCollapsed(group) {
        const header = group && group.querySelector(":scope > .groupName, :scope > .groupHeaderContainer > .groupName");
        return !!(header && header.classList.contains("Collapsed"));
    }

    function updateIndicator(instant) {
        if (!barEl || barEl.hidden || !indicatorEl) return;
        const btn = tabButtons.get(activeFilter);
        if (!btn) return;
        const left = btn.offsetLeft;
        const width = btn.offsetWidth;
        if (width <= 0) return;
        if (instant) {
            indicatorEl.style.transition = "none";
        }
        indicatorEl.style.width = `${width}px`;
        indicatorEl.style.transform = `translate3d(${left}px, 0, 0)`;
        indicatorEl.dataset.tone = activeFilter;
        if (instant) {
            indicatorEl.getBoundingClientRect();
            indicatorEl.style.transition = "";
        }
    }

    function updateEmptyState(friendlist) {
        const listBox = friendlist.querySelector(".friendlistListContainer");
        if (!listBox) return;
        const searching = friendlist.dataset.lmSearching === "1";
        if (activeFilter === "all" || searching) {
            delete friendlist.dataset.lmEmpty;
            listBox.removeAttribute("data-lm-empty-text");
            return;
        }
        const groups = getMatchingGroups(friendlist, activeFilter);
        const total = groups.reduce((acc, g) => acc + parseGroupCount(g), 0);
        if (groups.length === 0 || total === 0) {
            friendlist.dataset.lmEmpty = "1";
            const msg =
                activeFilter === "ingame"
                    ? COPY.emptyIngame
                    : activeFilter === "online"
                      ? COPY.emptyOnline
                      : COPY.emptyOffline;
            listBox.setAttribute("data-lm-empty-text", msg);
        } else {
            delete friendlist.dataset.lmEmpty;
            listBox.removeAttribute("data-lm-empty-text");
        }
    }

    function syncCountsAndSearch(friendlist) {
        const searchBtn = friendlist.querySelector(".searchIconButton");
        if (searchBtn && searchBtn.getAttribute("data-lm-placeholder") !== COPY.search) {
            searchBtn.setAttribute("data-lm-placeholder", COPY.search);
        }

        const searchInput = friendlist.querySelector("#friendSearchInputID, .friendSearchInput");
        const hasQuery = !!(searchInput && searchInput.value.trim().length > 0);
        if (hasQuery) {
            friendlist.dataset.lmSearching = "1";
        } else {
            delete friendlist.dataset.lmSearching;
        }

        const ingameGroups = friendlist.querySelectorAll(".friendGroup.gameGroup");
        let ingameCount = 0;
        ingameGroups.forEach((g) => {
            ingameCount += parseGroupCount(g);
        });
        const onlineCount = parseGroupCount(friendlist.querySelector(".friendGroup.onlineFriends"));
        const offlineCount = parseGroupCount(friendlist.querySelector(".friendGroup.offlineFriends"));

        /* Expose bare numeric count via data attribute so CSS renders clean badges without parentheses */
        friendlist.querySelectorAll(".friendGroup .groupCount").forEach((badge) => {
            const match = (badge.textContent || "").match(/\d+/);
            if (match && badge.getAttribute("data-lm-n") !== match[0]) {
                badge.setAttribute("data-lm-n", match[0]);
            }
        });

        const map = { ingame: ingameCount, online: onlineCount, offline: offlineCount };
        for (const key of Object.keys(map)) {
            const el = countEls.get(key);
            if (!el) continue;
            const val = String(map[key]);
            if (el.textContent !== val) el.textContent = val;
            el.parentElement.classList.toggle("lm-zero", map[key] === 0);
        }

        updateEmptyState(friendlist);
    }

    function applyFilter(friendlist, nextFilter) {
        if (!friendlist) return;
        const changed = activeFilter !== nextFilter;
        activeFilter = nextFilter;
        friendlist.dataset.lmFilter = activeFilter;

        tabButtons.forEach((btn, id) => {
            btn.classList.toggle("lm-active", id === activeFilter);
            btn.setAttribute("aria-pressed", id === activeFilter ? "true" : "false");
        });
        updateIndicator(false);

        if (activeFilter === "all") {
            autoExpanded.forEach((group) => {
                if (group.isConnected && !isGroupCollapsed(group)) {
                    clickGroupToggle(group);
                }
            });
            autoExpanded.clear();
        } else {
            const targets = getMatchingGroups(friendlist, activeFilter);
            for (const g of targets) {
                if (isGroupCollapsed(g)) {
                    autoExpanded.add(g);
                    clickGroupToggle(g);
                }
            }
        }

        updateEmptyState(friendlist);

        if (changed) {
            const scroller = friendlist.querySelector(".friendlistListContainer");
            if (scroller) scroller.scrollTop = 0;
        }
    }

    function buildFilterBar(friendlist) {
        const bar = document.createElement("div");
        bar.className = "lm-fl-filters no-drag";
        bar.setAttribute("role", "tablist");

        const track = document.createElement("div");
        track.className = "lm-fl-track";

        indicatorEl = document.createElement("div");
        indicatorEl.className = "lm-fl-indicator";
        indicatorEl.dataset.tone = activeFilter;
        track.appendChild(indicatorEl);

        tabButtons.clear();
        countEls.clear();

        for (const tab of TABS) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "lm-fl-tab";
            btn.dataset.filter = tab.id;
            btn.setAttribute("role", "tab");
            btn.setAttribute("aria-pressed", tab.id === activeFilter ? "true" : "false");
            if (tab.id === activeFilter) btn.classList.add("lm-active");

            const label = document.createElement("span");
            label.className = "lm-fl-label";
            label.textContent = tab.label;
            btn.appendChild(label);

            if (tab.id !== "all") {
                const count = document.createElement("span");
                count.className = `lm-fl-count lm-count-${tab.id}`;
                count.textContent = "0";
                btn.appendChild(count);
                countEls.set(tab.id, count);
            }

            btn.addEventListener("click", () => {
                const target = tab.id !== "all" && activeFilter === tab.id ? "all" : tab.id;
                applyFilter(friendlist, target);
            });
            tabButtons.set(tab.id, btn);
            track.appendChild(btn);
        }

        bar.appendChild(track);
        return bar;
    }

    function scheduleSync(friendlist, delay) {
        if (syncTimer) return;
        syncTimer = setTimeout(() => {
            syncTimer = 0;
            if (!friendlist.isConnected) return;
            reconcileOnlineState(friendlist);
        }, delay || 140);
    }

    /* Keep filter bar hidden while signed out/offline and restore exact placement after sign-in */
    function reconcileOnlineState(friendlist) {
        const header = friendlist.querySelector(".friendListHeaderContainer");
        const searchWrap = header && header.querySelector(".socialTabSearchContainer");
        const listBox = friendlist.querySelector(".friendlistListContainer");
        const isOnline = !!(header && searchWrap && listBox);

        if (!isOnline) {
            if (barEl) barEl.hidden = true;
            if (activeFilter !== "all") {
                activeFilter = "all";
                tabButtons.forEach((btn, id) => {
                    btn.classList.toggle("lm-active", id === "all");
                    btn.setAttribute("aria-pressed", id === "all" ? "true" : "false");
                });
            }
            delete friendlist.dataset.lmFilter;
            delete friendlist.dataset.lmEmpty;
            delete friendlist.dataset.lmSearching;
            autoExpanded.clear();
            if (listObserver) {
                listObserver.disconnect();
                observedList = null;
            }
            return;
        }

        if (!barEl || !barEl.isConnected) {
            header.querySelectorAll(".lm-fl-filters").forEach((el) => el.remove());
            barEl = buildFilterBar(friendlist);
            searchWrap.insertAdjacentElement("afterend", barEl);
            if (resizeObserver) resizeObserver.disconnect();
            resizeObserver = new ResizeObserver(() => updateIndicator(true));
            resizeObserver.observe(barEl);
        } else if (searchWrap.nextElementSibling !== barEl) {
            searchWrap.insertAdjacentElement("afterend", barEl);
        }

        const wasHidden = barEl.hidden;
        barEl.hidden = false;
        friendlist.dataset.lmFilter = activeFilter;

        if (observedList !== listBox) {
            if (listObserver) listObserver.disconnect();
            observedList = listBox;
            listObserver = new MutationObserver(() => scheduleSync(friendlist, 180));
            listObserver.observe(listBox, { childList: true, subtree: true });
        }

        syncCountsAndSearch(friendlist);
        if (wasHidden || !indicatorEl.style.width) {
            requestAnimationFrame(() => updateIndicator(true));
        }
    }

    function mount(friendlist) {
        const header = friendlist.querySelector(".friendListHeaderContainer");
        if (!header) return false;

        reconcileOnlineState(friendlist);

        if (structureObserver) structureObserver.disconnect();
        structureObserver = new MutationObserver(() => scheduleSync(friendlist, 40));
        structureObserver.observe(header, { childList: true });
        const content = friendlist.querySelector(".FriendsListContent");
        if (content) {
            structureObserver.observe(content, { childList: true });
        }

        friendlist.addEventListener(
            "click",
            (e) => {
                if (!e.isTrusted) return;
                const group = e.target.closest && e.target.closest(".friendGroup");
                if (group && e.target.closest(".groupName")) {
                    autoExpanded.delete(group);
                }
            },
            true
        );

        friendlist.addEventListener("input", (e) => {
            if (e.target && (e.target.id === "friendSearchInputID" || e.target.classList.contains("friendSearchInput"))) {
                scheduleSync(friendlist, 30);
            }
        });

        friendlist.addEventListener("click", (e) => {
            if (e.target && e.target.closest && e.target.closest(".friendSearchClear")) {
                scheduleSync(friendlist, 40);
            }
        });

        return true;
    }

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
            const friendlist = document.querySelector(".friendlist");
            if (!friendlist) return;
            const existing = friendlist.querySelector("#friendSearchInputID");
            if (existing) {
                e.preventDefault();
                existing.focus();
                existing.select();
                return;
            }
            const btn = friendlist.querySelector(".searchIconButton");
            if (btn) {
                e.preventDefault();
                btn.click();
                setTimeout(() => {
                    const input = friendlist.querySelector("#friendSearchInputID");
                    if (input) input.focus();
                }, 60);
            }
        }
    });

    function bootstrap() {
        const friendlist = document.querySelector(".friendlist");
        if (friendlist && mount(friendlist)) return;

        const bootObserver = new MutationObserver(() => {
            const fl = document.querySelector(".friendlist");
            if (fl && mount(fl)) {
                bootObserver.disconnect();
            }
        });
        bootObserver.observe(document.body || root, { childList: true, subtree: true });
        setTimeout(() => bootObserver.disconnect(), 15000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
        bootstrap();
    }

    window.addEventListener("pagehide", () => {
        if (listObserver) listObserver.disconnect();
        if (structureObserver) structureObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        clearTimeout(syncTimer);
    });
})();
