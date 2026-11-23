"""Inspect a supernav dropdown's first open after Steam starts (run right after
a restart): stylesheets, visibility and animation state.

  python tools/firstopen.py [label]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
label = sys.argv[1] if len(sys.argv) > 1 else "社区"

FIND = """(() => {
  const el = [...document.querySelectorAll('div,span,a')].find(e =>
    e.childElementCount === 0 && e.textContent.trim() === %s && e.getBoundingClientRect().top < 80);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
})()"""

STATE = r"""JSON.stringify((() => {
  const menu = [...document.querySelectorAll('div')].find(e => e.classList.contains('contextMenu'));
  const anims = menu ? [menu, ...menu.querySelectorAll('.contextMenuItem')].slice(0, 4).flatMap(e =>
    e.getAnimations().map(a => ({ name: a.animationName, state: a.playState,
      start: a.startTime && Math.round(a.startTime), t: a.currentTime && Math.round(a.currentTime) }))) : null;
  return {
    now: Math.round(performance.now()), timeline: Math.round(document.timeline.currentTime || 0),
    vis: document.visibilityState, hooked: !!window.__lmMenuAnim,
    menu: menu ? menu.className.split(' ').filter(c => !c.startsWith('_') && !/^[A-Z]\w{15,}/.test(c)) : null,
    anims,
    css: performance.getEntriesByType('resource').filter(r => r.name.includes('lumina'))
      .map(r => r.name.split('/').pop().split('?')[0] + '@' + Math.round(r.responseEnd)),
    links: [...document.querySelectorAll('link[href*="lumina"]')].length,
  };
})())"""

before = {t.get("title"): t for t in cdp.targets()}
supernavs = sorted(t for t in before if t and "Supernav" in t)
print("popup windows before any hover:", supernavs or "none")

main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.5)
pos = cdp.evaluate(main, FIND % json.dumps(label))
if not pos:
    raise SystemExit(f"nav label {label!r} not found")

target = next((t for title, t in before.items() if title and "Supernav" in title and title.lower().startswith(
    {"社区": "community", "商店": "store", "库": "library"}.get(label, label).lower())), None)
pre_ws = None
if target:
    pre_ws = cdp.websocket.create_connection(target["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    print("before hover:", cdp.evaluate(pre_ws, STATE))

cdp.call(main, "Input.dispatchMouseEvent", type="mouseMoved", x=pos[0] - 30, y=pos[1] + 300)
time.sleep(0.4)
cdp.call(main, "Input.dispatchMouseEvent", type="mouseMoved", x=pos[0], y=pos[1])
t0 = time.time()
popup = target
while not popup and time.time() - t0 < 3:
    popup = next((t for t in cdp.targets() if "Supernav" in (t.get("title") or "") and t.get("title") not in before), None)
    time.sleep(0.02)
if not popup:
    raise SystemExit("no supernav popup appeared")
ws = pre_ws or cdp.websocket.create_connection(popup["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
for i in range(6):
    print(f"+{int((time.time() - t0) * 1000):4d}ms:", cdp.evaluate(ws, STATE))
    time.sleep(0.08)
cdp.call(main, "Input.dispatchMouseEvent", type="mouseMoved", x=pos[0] - 30, y=pos[1] + 300)
