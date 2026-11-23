"""Open and close the library's "Games and Software" filter and record the menu
node and the close-animation copy, frame by frame.

  python tools/inpagemenu.py
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FIND = r"""(() => {
  const el = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && /^(游戏和软件|游戏|软件|Games)/.test(e.textContent.trim())
    && e.getBoundingClientRect().left < 400 && e.getBoundingClientRect().top > 80 && e.getBoundingClientRect().top < 300);
  if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, el.textContent.trim()];
})()"""

ARM = r"""(() => {
  const log = window.__lmMenuLog = []; const t0 = performance.now();
  const t = () => Math.round(performance.now() - t0);
  const isMenu = n => n.nodeType === 1 && (n.classList.contains('contextMenu') || n.querySelector && n.querySelector('.contextMenu'));
  new MutationObserver(ms => ms.forEach(m => {
    if (m.type === 'childList') {
      m.addedNodes.forEach(n => isMenu(n) && log.push(`+${t()} added ${n.tagName}.${String(n.className).slice(0, 40)} under ${m.target.tagName}.${String(m.target.className).slice(0, 30)}`));
      m.removedNodes.forEach(n => isMenu(n) && log.push(`+${t()} removed ${n.tagName}.${String(n.className).slice(0, 40)} from ${m.target.tagName}.${String(m.target.className).slice(0, 30)}`));
    } else if (m.target.classList && m.target.classList.contains('contextMenu')) {
      log.push(`+${t()} contextMenu ${m.attributeName}: ${(m.oldValue || '').replace(/_\S+|\b[A-Za-z0-9-]{18,}\b/g, '').trim().slice(0, 60)} -> ${(m.target.getAttribute(m.attributeName) || '').replace(/_\S+|\b[A-Za-z0-9-]{18,}\b/g, '').trim().slice(0, 60)}`);
    }
  })).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style'] });
  // Per frame: the close copy from js/menu-anim.js, while it exists.
  let seen = false;
  (function tick() {
    const g = document.querySelector('[data-lm-ghost]');
    if (g) { seen = true; const cs = getComputedStyle(g); log.push(`+${t()} frame: close copy opacity=${(+cs.opacity).toFixed(2)} clip=${cs.clipPath.slice(0, 40)}`); }
    else if (seen) { log.push(`+${t()} close copy removed`); seen = false; }
    if (t() < 2500) requestAnimationFrame(tick);
  })();
  return 1;
})()"""

DESCRIBE = r"""JSON.stringify((() => {
  const m = [...document.querySelectorAll('.contextMenu')].find(e => e.getBoundingClientRect().height > 20);
  if (!m) return null;
  const path = []; let e = m;
  while (e && e !== document.body && path.length < 6) { path.push(e.tagName.toLowerCase() + '.' + [...e.classList].filter(c => !/\d/.test(c)).join('.')); e = e.parentElement; }
  const cs = getComputedStyle(m), r = m.getBoundingClientRect();
  return { path, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    shadow: cs.boxShadow, clip: cs.clipPath, backdrop: cs.backdropFilter, anims: m.getAnimations().map(a => a.animationName + ':' + a.playState) };
})())"""

main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.3)
before = {t["id"] for t in cdp.targets()}
pos = cdp.evaluate(main, FIND)
if not pos:
    raise SystemExit("filter dropdown not found")
print("dropdown label:", pos[2])
cdp.evaluate(main, ARM)
for t in ("mousePressed", "mouseReleased"):
    cdp.call(main, "Input.dispatchMouseEvent", type=t, x=pos[0], y=pos[1], button="left", clickCount=1)
time.sleep(0.15)
print("during open:", cdp.evaluate(main, DESCRIBE))
time.sleep(0.6)
print("open:", cdp.evaluate(main, DESCRIBE))
new = [t.get("title") for t in cdp.targets() if t["id"] not in before]
print("new windows:", new or "none (menu is in the main window)")
cdp.call(main, "Input.dispatchKeyEvent", type="keyDown", key="Escape", code="Escape", windowsVirtualKeyCode=27)
cdp.call(main, "Input.dispatchKeyEvent", type="keyUp", key="Escape", code="Escape", windowsVirtualKeyCode=27)
time.sleep(0.6)
print("after Escape:", cdp.evaluate(main, DESCRIBE))
for line in json.loads(cdp.evaluate(main, "JSON.stringify(window.__lmMenuLog)")):
    print("  ", line)
