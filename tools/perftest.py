"""Main-window cost of 40 wheel notches on the game list: native vs smooth
scrolling, or (--theme-css) theme CSS on vs off.

  python tools/perftest.py [rounds] [--theme-css]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
rounds = int(args[0]) if args else 2
css_mode = "--theme-css" in sys.argv
GRID = "document.querySelector('.ReactVirtualized__Grid.ReactVirtualized__List')"
KEYS = ("TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration")

FRAMES = r"""(() => { const f = window.__lmFrames = []; let last = performance.now(); window.__lmFramesOn = true;
  (function tick(now) { f.push(now - last); last = now; if (window.__lmFramesOn) requestAnimationFrame(tick); })(last);
  return 1; })()"""


def metrics(ws):
    return {m["name"]: m["value"] for m in cdp.call(ws, "Performance.getMetrics")["metrics"]}


def run(ws, x, y):
    cdp.evaluate(ws, f"{GRID}.scrollTop = 0")
    time.sleep(0.8)
    cdp.evaluate(ws, FRAMES)
    before = metrics(ws)
    t0 = time.time()
    for d in [100] * 20 + [-100] * 20:
        cdp.call(ws, "Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=d)
        time.sleep(0.06)
    time.sleep(0.8)
    wall = time.time() - t0
    after = metrics(ws)
    frames = json.loads(cdp.evaluate(ws, "(() => { window.__lmFramesOn = false; return JSON.stringify(window.__lmFrames.slice(1)); })()"))
    d = {k: (after[k] - before[k]) * 1000 for k in KEYS}
    d["wall"] = wall * 1000
    d["frames"] = len(frames)
    d["dropped"] = sum(1 for f in frames if f > 25)
    d["worst"] = max(frames) if frames else 0
    return d


main = cdp.connect("Steam")
cdp.call(main, "Performance.enable")
cdp.call(main, "Page.bringToFront")
time.sleep(0.3)
x, y = cdp.evaluate(main, f"(() => {{ const b = {GRID}.getBoundingClientRect(); return [b.left + b.width / 2, b.top + 200]; }})()")
LINKS = "document.querySelectorAll('link[href*=\"lumina\"]').forEach(l => l.disabled = %s)"
modes = ("theme on", "theme off") if css_mode else ("native", "smooth")
results = {m: [] for m in modes}
try:
    for _ in range(rounds):
        for mode in modes:
            if css_mode:
                cdp.evaluate(main, "document.documentElement.style.setProperty('--lm-smooth-scroll', '0ms')")
                cdp.evaluate(main, LINKS % ("true" if mode == "theme off" else "false"))
                time.sleep(0.5)
            elif mode == "native":
                cdp.evaluate(main, "document.documentElement.style.setProperty('--lm-smooth-scroll', '0ms')")
            else:
                cdp.evaluate(main, "document.documentElement.style.removeProperty('--lm-smooth-scroll')")
            results[mode].append(run(main, x, y))
finally:
    cdp.evaluate(main, LINKS % "false")
    cdp.evaluate(main, "document.documentElement.style.removeProperty('--lm-smooth-scroll')")
    cdp.evaluate(main, f"{GRID}.scrollTop = 0")

print(f"40 wheel notches (20 down, 20 up) over ~{results[modes[0]][0]['wall'] / 1000:.1f}s, averaged over {rounds} rounds:")
print(f"{'':10} {'task':>8} {'script':>8} {'style':>8} {'layout':>8} {'frames':>7} {'>25ms':>6} {'worst':>7}")
for mode, rs in results.items():
    avg = {k: sum(r[k] for r in rs) / len(rs) for k in rs[0]}
    print(f"{mode:10} {avg['TaskDuration']:7.0f}ms {avg['ScriptDuration']:7.0f}ms {avg['RecalcStyleDuration']:7.0f}ms "
          f"{avg['LayoutDuration']:7.0f}ms {avg['frames']:7.0f} {avg['dropped']:6.1f} {avg['worst']:6.0f}ms")
