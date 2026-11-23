// Read-only probe for a morphing nav menu: can the main window reach the
// supernav popup windows (via SharedJSContext's g_PopupManager) and read their
// menu items, and how do the nav labels open them?
// Used with: python tools/cdp.py evalf tools/supernav.js
(() => {
  const out = {};
  const shared = window.opener;
  let pm = null;
  try { pm = shared && shared.g_PopupManager; } catch (e) { out.openerError = e.message; }
  out.popupManager = !!pm;
  if (pm) {
    const popups = [...pm.GetPopups()];
    out.popups = popups.map(p => { try { return p.m_strTitle || p.title || p.m_strName; } catch { return "?"; } });
    out.supernav = popups.filter(p => /Supernav|Account Menu/i.test(p.m_strTitle || "")).map(p => {
      let doc = null;
      try { doc = p.window && p.window.document; } catch (e) { return { title: p.m_strTitle, error: e.message }; }
      if (!doc) return { title: p.m_strTitle, doc: false };
      const items = [...doc.querySelectorAll(".contextMenuItem")];
      return {
        title: p.m_strTitle, visibility: doc.visibilityState,
        items: items.map(i => i.textContent.trim()).slice(0, 12),
        separators: doc.querySelectorAll("[class*='Separator']").length,
        itemHasReactProps: items.length ? Object.keys(items[0]).some(k => k.startsWith("__reactProps")) : null,
        itemHandlers: items.length ? (() => { const k = Object.keys(items[0]).find(k => k.startsWith("__reactProps"));
          return k ? Object.keys(items[0][k]).filter(n => /^on/.test(n)) : []; })() : null,
      };
    });
  }
  // nav labels in the main window
  const labels = [...document.querySelectorAll("div,span,a")].filter(e => e.childElementCount === 0 &&
    e.getBoundingClientRect().top < 80 && /^(STORE|LIBRARY|COMMUNITY|商店|库|社区)$/i.test(e.textContent.trim()));
  out.navLabels = labels.map(e => {
    const chain = [];
    for (let n = e, i = 0; n && i < 4; n = n.parentElement, i++) {
      const k = Object.keys(n).find(k => k.startsWith("__reactProps"));
      const handlers = k ? Object.keys(n[k]).filter(h => /^on/.test(h)) : [];
      chain.push(`${n.tagName.toLowerCase()}.${[...n.classList].filter(c => !/\d/.test(c)).join(".")}${handlers.length ? " [" + handlers.join(",") + "]" : ""}`);
    }
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), x: Math.round(r.left), w: Math.round(r.width), chain };
  });
  return JSON.stringify(out, null, 1);
})()
