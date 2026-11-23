"""Hover a supernav label several times and report each menu item's animation.

  python tools/menutest.py [label] [rounds]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
label = sys.argv[1] if len(sys.argv) > 1 else "社区"
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 3

FIND = """(() => {
  const el = [...document.querySelectorAll('div,span,a')].find(e =>
    e.childElementCount === 0 && e.textContent.trim() === %s && e.getBoundingClientRect().top < 80);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
})()"""

INSPECT = """(() => {
  const items = [...document.querySelectorAll('[class*="MenuItem"], [class*="contextMenuItem"]')];
  const css = [...document.querySelectorAll('link[href*="lumina"]')].map(l => l.href.split('/').pop());
  return {
    title: document.title,
    css,
    items: items.slice(0, 6).map(e => {
      const cs = getComputedStyle(e);
      return {
        text: e.textContent.trim().slice(0, 12),
        anim: cs.animationName, delay: cs.animationDelay, dur: cs.animationDuration,
        running: e.getAnimations().map(a => a.playState + '@' + Math.round(a.currentTime ?? -1)),
        opacity: cs.opacity,
      };
    }),
  };
})()"""


def mouse(ws, x, y):
    cdp.call(ws, "Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.5)
pos = cdp.evaluate(main, FIND % json.dumps(label))
if not pos:
    raise SystemExit(f"nav label {label!r} not found")
before = {t["id"] for t in cdp.targets()}

for n in range(1, rounds + 1):
    mouse(main, pos[0] - 30, pos[1] + 300)   # start away from the nav
    time.sleep(0.6)
    mouse(main, *pos)
    popup = None
    for _ in range(30):
        time.sleep(0.03)
        for t in cdp.targets():
            if t.get("type") == "page" and "Supernav" in (t.get("title") or ""):
                popup = t
                break
        if popup:
            break
    if not popup:
        print(f"round {n}: no supernav popup appeared")
        continue
    ws = cdp.websocket.create_connection(popup["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    info = cdp.evaluate(ws, INSPECT)
    new = popup["id"] not in before
    print(f"round {n}: popup {popup['title']!r} id={popup['id'][:8]} {'NEW window' if new else 'reused window'}")
    print("   css:", ", ".join(info["css"]))
    for it in info["items"]:
        print(f"   {it['text']:12} anim={it['anim']} delay={it['delay']} running={it['running']} opacity={it['opacity']}")
    if n == 1:
        cdp.screenshot(ws, "shots/06-menu-open.png") if False else None
    before.add(popup["id"])
    ws.close()

mouse(main, pos[0] - 30, pos[1] + 300)
