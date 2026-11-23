"""Check smooth wheel scrolling: one notch, five quick notches, a touchpad-like
delta (native), and a jump made mid-glide.

  python tools/scrolltest.py
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
GRID = "document.querySelector('.ReactVirtualized__Grid.ReactVirtualized__List')"

SAMPLE = r"""(() => {
  const g = %s; const s = window.__lmSamples = []; const t0 = performance.now();
  (function f() { s.push([Math.round(performance.now() - t0), Math.round(g.scrollTop)]);
    if (performance.now() - t0 < %d) requestAnimationFrame(f); })();
  return 1; })()"""


def wheel(ws, x, y, dy):
    cdp.call(ws, "Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=dy)


def samples(ws):
    return json.loads(cdp.evaluate(ws, "JSON.stringify(window.__lmSamples)"))


def summary(s):
    pts = [s[0]] + [p for i, p in enumerate(s[1:], 1) if p[1] != s[i - 1][1]]
    return " ".join(f"{t}ms:{v}" for t, v in pts[:16]) + (" ..." if len(pts) > 16 else "")


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.3)
print("smooth-scroll loaded:", cdp.evaluate(main, "!!window.__lmSmoothScroll"),
      "| --lm-smooth-scroll =", repr(cdp.evaluate(main, "getComputedStyle(document.documentElement).getPropertyValue('--lm-smooth-scroll')")))
x, y = cdp.evaluate(main, f"(() => {{ const b = {GRID}.getBoundingClientRect(); return [b.left + b.width / 2, b.top + 200]; }})()")


def reset():
    cdp.evaluate(main, f"{GRID}.scrollTop = 0")
    time.sleep(0.5)


reset()
cdp.evaluate(main, SAMPLE % (GRID, 500))
wheel(main, x, y, 100)
time.sleep(0.6)
s = samples(main)
print(f"1. one notch: {summary(s)}\n   distinct positions: {len(set(v for _, v in s))} (1-2 would mean a jump)")

reset()
cdp.evaluate(main, SAMPLE % (GRID, 900))
for _ in range(5):
    wheel(main, x, y, 100)
    time.sleep(0.03)
time.sleep(0.9)
s = samples(main)
print(f"2. five notches: {summary(s)}\n   ended at {s[-1][1]} (target 500)")

reset()
cdp.evaluate(main, SAMPLE % (GRID, 300))
wheel(main, x, y, 37)
time.sleep(0.4)
s = samples(main)
print(f"3. touchpad-like 37px: {summary(s)}")

reset()
cdp.evaluate(main, SAMPLE % (GRID, 700))
wheel(main, x, y, 100); wheel(main, x, y, 100); wheel(main, x, y, 100)
time.sleep(0.06)
cdp.evaluate(main, f"{GRID}.scrollTop = 2000")
time.sleep(0.7)
s = samples(main)
print(f"4. external jump to 2000 mid-glide: {summary(s)}\n   ended at {s[-1][1]} (should stay 2000)")
reset()
