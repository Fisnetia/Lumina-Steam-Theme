"""Collapse a library collection by clicking its icon and report the fade-out,
the moment Steam collapses, the slide-up, and leftover classes.

  python tools/collapsetest.py [index]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
index = int(sys.argv[1]) if len(sys.argv) > 1 else 1

HEADER = """[...document.querySelectorAll('.ReactVirtualized__Grid__innerScrollContainer .CollapseIconParent')][%d]""" % index

SETUP = r"""(() => {
  const h = %s;
  if (h.classList.contains('SingleLine')) h.querySelector('svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'ok';
})()""" % HEADER

ARM = r"""(() => {
  const h = %s;
  const log = window.__lmCol = { events: [], t0: 0 };
  const t = () => Math.round(performance.now() - log.t0);
  const label = (n) => (n.textContent || '').trim().slice(0, 16);
  // Time from mousedown: the click itself is held back by library-anim.js.
  document.addEventListener('mousedown', () => { if (!log.t0) log.t0 = performance.now(); }, true);
  window.__lmColAnim && document.removeEventListener('animationstart', window.__lmColAnim, true);
  window.__lmColAnim = (e) => { if (/^lm-row-(out|up)$/.test(e.animationName)) log.events.push(
    `+${t()}ms ${e.animationName} top=${e.target.style.top} shift=${e.target.style.getPropertyValue('--lm-shift') || '-'} ${label(e.target)}`); };
  document.addEventListener('animationstart', window.__lmColAnim, true);
  new MutationObserver((ms, o) => { if (h.classList.contains('SingleLine')) { log.events.push(`+${t()}ms Steam collapsed`); o.disconnect(); } })
    .observe(h, { attributes: true, attributeFilter: ['class'] });
  const r = h.querySelector('svg').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, name: label(h) });
})()""" % HEADER

main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
time.sleep(0.3)
cdp.evaluate(main, SETUP)
time.sleep(0.9)
info = json.loads(cdp.evaluate(main, ARM))
print("collapsing:", info["name"])
for t in ("mousePressed", "mouseReleased"):
    cdp.call(main, "Input.dispatchMouseEvent", type=t, x=info["x"], y=info["y"], button="left", clickCount=1)
time.sleep(1.0)
log = json.loads(cdp.evaluate(main, "JSON.stringify(window.__lmCol)"))
out = [e for e in log["events"] if "lm-row-out" in e]
up = [e for e in log["events"] if "lm-row-up" in e]
other = [e for e in log["events"] if "lm-row" not in e]
print(f"fade-out animations: {len(out)}", *out[:3], sep="\n   ")
print(*other, sep="\n")
print(f"slide-up animations: {len(up)}", *up[:4], sep="\n   ")
left = cdp.evaluate(main, "document.querySelectorAll('.lm-row-out, .lm-row-up').length")
state = cdp.evaluate(main, f"{HEADER}.classList.contains('SingleLine') ? 'collapsed' : 'expanded'")
print(f"leftover animation classes: {left}; header is now {state}")
