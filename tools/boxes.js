// Dump the box tree of a popup menu window: each element's size, position,
// padding/border/margin, background and overflow, with readable class names
// where Steam provides them. Used with: python tools/cdp.py --title "<window>" evalf tools/boxes.js
(() => {
  const out = [];
  const root = document.querySelector('.contextMenu') || document.body;
  const short = (e) => {
    const cls = [...e.classList].filter(c => !/^_?[A-Za-z0-9_-]{18,}$/.test(c) || /[a-z]{4,}/.test(c) && !/\d/.test(c));
    return e.tagName.toLowerCase() + (cls.length ? '.' + cls.slice(0, 3).join('.') : '') +
      ' [' + [...e.classList].filter(c => /\d/.test(c)).slice(0, 2).join(' ') + ']';
  };
  const walk = (e, depth) => {
    if (depth > 9) return;
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ' bg=' + cs.backgroundColor : '';
    const ov = cs.overflowY !== 'visible' ? ' ovY=' + cs.overflowY : '';
    const sb = e.scrollHeight > e.clientHeight + 1 && cs.overflowY !== 'visible' ? ` scroll(${e.offsetWidth - e.clientWidth}px bar)` : '';
    out.push(`${'  '.repeat(depth)}${short(e)} x=${Math.round(r.left)} w=${Math.round(r.width)} h=${Math.round(r.height)}` +
      ` pad=${cs.padding} bord=${cs.borderWidth} mar=${cs.margin}${bg}${ov}${sb}`);
    [...e.children].forEach(c => walk(c, depth + 1));
  };
  walk(document.documentElement, 0);
  return `window ${innerWidth}x${innerHeight}\n` + out.slice(0, 60).join('\n');
})()
