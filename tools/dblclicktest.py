"""Click a library collection header several times quickly, mouse still, and
check the resulting state. Icon: every click toggles. Title: each double
click toggles once.

  python tools/dblclicktest.py [index] [gap_ms] [start] [icon|name] [clicks]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
index = int(sys.argv[1]) if len(sys.argv) > 1 else 1
gap = (int(sys.argv[2]) if len(sys.argv) > 2 else 80) / 1000
start = sys.argv[3] if len(sys.argv) > 3 else "expanded"
where = sys.argv[4] if len(sys.argv) > 4 else "icon"
clicks = int(sys.argv[5]) if len(sys.argv) > 5 else 2

HEADER = "[...document.querySelectorAll('.ReactVirtualized__Grid__innerScrollContainer .CollapseIconParent')][%d]" % index
STATE = f"({HEADER}.classList.contains('SingleLine') ? 'collapsed' : 'expanded')"
POS = f"""(() => {{ const h = {HEADER}; const icon = h.querySelector('svg').getBoundingClientRect();
  const box = h.getBoundingClientRect();
  const x = %s ? icon.left + icon.width / 2 : icon.right + 60;
  return [x, box.top + box.height / 2, h.textContent.trim().slice(0, 16)]; }})()""" % ("true" if where == "icon" else "false")
ARM = f"""(() => {{ const h = {HEADER}; const log = window.__lmDbl = [];
  // Record real state changes only (selecting the header also changes its classes).
  let last = h.classList.contains('SingleLine') ? 'C' : 'E';
  new MutationObserver(() => {{ const s = h.classList.contains('SingleLine') ? 'C' : 'E';
    if (s !== last) {{ log.push(s); last = s; }} }}).observe(h, {{ attributes: true, attributeFilter: ['class'] }});
  return 1; }})()"""
REPORT = r"""JSON.stringify((() => {
  const list = document.querySelector('.ReactVirtualized__Grid__innerScrollContainer');
  return {
    leftover: [...document.querySelectorAll('.lm-row-in, .lm-row-out, .lm-row-up')].map(e => e.className.match(/lm-row-\w+/g).join('+') + ' top=' + e.style.top),
    invisible: [...list.children].filter(r => +getComputedStyle(r).opacity < 0.5).map(r => r.style.top + ' ' + r.textContent.trim().slice(0, 14)),
  };
})())"""

main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.3)
if cdp.evaluate(main, STATE) != start:
    cdp.evaluate(main, f"{HEADER}.querySelector('svg').dispatchEvent(new MouseEvent('click', {{ bubbles: true }}))")
    time.sleep(1.0)
x, y, name = cdp.evaluate(main, POS)
cdp.evaluate(main, ARM)
begin = cdp.evaluate(main, STATE)
print(f"{name}: start {begin}, {clicks} clicks on {where}, {int(gap * 1000)}ms apart, mouse still")
for n in range(1, clicks + 1):
    for t in ("mousePressed", "mouseReleased"):
        cdp.call(main, "Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=n)
    if n < clicks:
        time.sleep(gap)
time.sleep(1.2)
trans = json.loads(cdp.evaluate(main, "JSON.stringify(window.__lmDbl)"))
end = cdp.evaluate(main, STATE)
if where == "icon":
    expected = begin if clicks % 2 == 0 else ("collapsed" if begin == "expanded" else "expanded")
else:
    expected = begin if (clicks // 2) % 2 == 0 else ("collapsed" if begin == "expanded" else "expanded")
verdict = "ok" if end == expected else f"WRONG, expected {expected}"
print(f"  transitions: {trans} -> {end}   [{verdict}]")
rep = json.loads(cdp.evaluate(main, REPORT))
print("  leftover classes:", rep["leftover"] or "none")
print("  rows stuck invisible:", rep["invisible"] or "none")
