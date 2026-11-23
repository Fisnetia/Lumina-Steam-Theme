"""Expand a library collection and report which rows changed and which
lm-row-in animations started. Clicks again to restore.

  python tools/expandtest.py [index]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
index = int(sys.argv[1]) if len(sys.argv) > 1 else 0

SETUP = r"""(() => {
  const list = document.querySelector('.ReactVirtualized__Grid__innerScrollContainer');
  const headers = [...list.querySelectorAll('[class*="SectionHeaderContent"]')].filter(e => e.getBoundingClientRect().height > 10);
  const h = headers[%d];
  const panel = h.closest('.Panel');
  const container = h.parentElement;
  const log = window.__lmExp = { added: [], removed: [], moved: [], text: [], before: [...container.classList].join(' ') };
  window.__lmExpObs && window.__lmExpObs.disconnect();
  const label = (n) => (n.textContent || '').trim().slice(0, 18);
  const obs = window.__lmExpObs = new MutationObserver(ms => ms.forEach(m => {
    if (m.type === 'childList' && m.target === list) {
      m.addedNodes.forEach(n => log.added.push(n.style.top + ' ' + label(n)));
      m.removedNodes.forEach(n => log.removed.push(n.style.top + ' ' + label(n)));
    } else if (m.type === 'attributes' && m.target.parentElement === list) {
      log.moved.push(m.oldValue.match(/top: [^;]+/)?.[0] + ' -> ' + m.target.style.top + ' ' + label(m.target));
    } else if (m.type === 'characterData' || m.type === 'childList') {
      const p = m.target.nodeType === 1 ? m.target.closest('.Panel') : m.target.parentElement?.closest('.Panel');
      if (p && log.text.length < 12) log.text.push(p.style.top + ' content changed -> ' + label(p));
    }
  }));
  log.anim = [];
  const t0 = performance.now();
  window.__lmExpAnim && document.removeEventListener('animationstart', window.__lmExpAnim, true);
  window.__lmExpAnim = (e) => { if (e.animationName === 'lm-row-in') log.anim.push(
    `+${Math.round(performance.now() - t0)}ms top=${e.target.style.top} i=${e.target.style.getPropertyValue('--lm-i')} ${label(e.target)}`); };
  document.addEventListener('animationstart', window.__lmExpAnim, true);
  obs.observe(list, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['style'], subtree: true, characterData: true });
  const icon = [...container.querySelectorAll('*')].find(e => [...e.classList].some(c => /^CollapseIcon/.test(c)) && !e.classList.contains('CollapseIconParent'))
    || container.querySelector('svg');
  const r = (icon || h).getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, name: label(h),
    icon: icon ? icon.tagName + '.' + [...icon.classList].filter(c => !/\d/.test(c)).join('.') : 'none' });
})()"""

DUMP = r"""(() => {
  const log = window.__lmExp; window.__lmExpObs.disconnect();
  const list = document.querySelector('.ReactVirtualized__Grid__innerScrollContainer');
  const h = [...list.querySelectorAll('[class*="SectionHeaderContent"]')].find(e => e.textContent.trim().startsWith(%s));
  log.after = h ? [...h.parentElement.classList].join(' ') : '?';
  return JSON.stringify(log);
})()"""


def click(ws, x, y):
    for t in ("mousePressed", "mouseReleased"):
        cdp.call(ws, "Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.4)
info = json.loads(cdp.evaluate(main, SETUP % index))
print("clicking header:", info["name"], "via", info["icon"])
click(main, info["x"], info["y"])
time.sleep(0.6)
log = json.loads(cdp.evaluate(main, DUMP % json.dumps(info["name"][:6])))
print("header classes before:", log["before"])
print("header classes after: ", log["after"])
for key in ("added", "removed", "moved", "text", "anim"):
    items = log[key]
    print(f"{key}: {len(items)}")
    for it in items[:(30 if key == "anim" else 8)]:
        print("   ", it)
click(main, info["x"], info["y"])   # restore
print("clicked again to restore")
