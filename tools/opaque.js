// List elements that paint a (mostly) opaque background over a large area,
// i.e. the layers that hide the Lumina backdrop. Biggest first.
(() => {
  const vw = innerWidth, vh = innerHeight, minArea = vw * vh * 0.02;
  const alphaOf = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c === 'transparent' ? 0 : 1;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (w <= 0 || h <= 0 || w * h < minArea) continue;
    const cs = getComputedStyle(el);
    const a = alphaOf(cs.backgroundColor);
    const img = cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url(');
    if (a < 0.35 && !img) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    out.push({
      cls: (el.className && el.className.baseVal === undefined ? el.className : '').toString().trim().split(/\s+/).slice(0, 4).join(' '),
      tag: el.tagName.toLowerCase(),
      box: [Math.round(r.left), Math.round(r.top), Math.round(w), Math.round(h)],
      bg: cs.backgroundColor + (img ? ' + ' + cs.backgroundImage.slice(0, 70) : ''),
      area: Math.round((w * h) / (vw * vh) * 100),
    });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, 40);
})()
