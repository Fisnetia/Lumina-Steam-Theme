"""Record a supernav dropdown closing: class changes, HideWindow calls,
visibility, and per-frame opacity of the close animation.

  python tools/closetest.py [label]
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

RECORD = r"""(() => {
  const log = window.__lmLog = [];
  const t = () => Math.round(performance.now() * 10) / 10;
  const note = (what) => log.push([t(), what]);
  const menu = [...document.querySelectorAll('div')].find(e => e.classList.contains('contextMenu'));
  note('start; menu classes=' + (menu ? menu.className : 'none') + ' vis=' + document.visibilityState);
  const mo = new MutationObserver(ms => ms.forEach(m => {
    const el = m.target;
    const name = el === document.documentElement ? 'html' : el === document.body ? 'body'
      : el.classList.contains('contextMenu') ? 'contextMenu' : el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.');
    note(`${name} ${m.attributeName}: ${(m.oldValue || '').slice(0, 80)} -> ${(el.getAttribute(m.attributeName) || '').slice(0, 80)}`);
  }));
  mo.observe(document.documentElement, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['class', 'style'] });
  document.addEventListener('visibilitychange', () => note('visibilitychange -> ' + document.visibilityState));
  window.addEventListener('blur', () => note('window blur'));
  let frames = 0, last = 0;
  (function tick() {
    frames++; last = t();
    if (menu && menu.classList.contains('lm-closing')) {
      const cs = getComputedStyle(menu);
      note(`frame: opacity=${(+cs.opacity).toFixed(2)} clip=${cs.clipPath}`);
    }
    requestAnimationFrame(tick);
  })();
  window.__lmFrames = () => [frames, last];
  const W = window.SteamClient && SteamClient.Window;
  if (W) for (const k of Object.keys(W)) {
    if (typeof W[k] !== 'function' || W[k].__lm) continue;
    const orig = W[k];
    W[k] = function (...a) { note('SteamClient.Window.' + k + '(' + JSON.stringify(a).slice(0, 60) + ')'); return orig.apply(this, a); };
    W[k].__lm = true;
  }
  return 'recording';
})()"""

DUMP = "JSON.stringify({log: window.__lmLog, frames: window.__lmFrames && window.__lmFrames(), now: performance.now(), vis: document.visibilityState})"


def mouse(ws, x, y):
    cdp.call(ws, "Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.5)
pos = cdp.evaluate(main, FIND % json.dumps(label))
if not pos:
    raise SystemExit(f"nav label {label!r} not found")

mouse(main, pos[0] - 30, pos[1] + 300)
time.sleep(0.6)
mouse(main, *pos)
popup = None
for _ in range(60):
    time.sleep(0.05)
    popup = next((t for t in cdp.targets() if t.get("type") == "page" and "Supernav" in (t.get("title") or "")), None)
    if popup:
        break
if not popup:
    raise SystemExit("no supernav popup appeared")
time.sleep(0.8)   # let the open animation finish

ws = cdp.websocket.create_connection(popup["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
print("popup:", popup["title"], popup["id"][:8])
print(cdp.evaluate(ws, RECORD))

mouse(main, pos[0] - 30, pos[1] + 300)   # move away -> menu closes
time.sleep(1.5)

still = any(t["id"] == popup["id"] for t in cdp.targets())
data = json.loads(cdp.evaluate(ws, DUMP))
log = data["log"]
t0 = next((ts for ts, w in log if "contextMenu class" in w and "ready" in w.split("->")[0] and "ready" not in w.split("->")[1]), None)
print(f"window target still exists: {still}; visibility now: {data['vis']}")
print(f"frames: count={data['frames'][0]} last frame at {data['frames'][1]}ms, now {data['now']:.1f}ms")
for ts, what in log:
    rel = f"{ts - t0:+8.1f}" if t0 is not None else f"{ts:9.1f}"
    print(f"{rel} ms  {what}")
if t0 is not None:
    print(f"\nlast animation frame {data['frames'][1] - t0:+.1f} ms after ready was removed")
ws.close()
