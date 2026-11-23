"""Check the morphing nav menu (js/morph-nav.js) on both surfaces.

  python tools/morphtest.py [--shot-prefix PATH] [--no-click]

For the Store page (web view -> host window) and the Library (in-page):
hover Store / Library / Community, switch quickly back and forth, move away,
and report the surface used, pages at once, native popups, and whether
Steam's own menu showed while the host hid. Then clicks the first Library
item from the in-page panel. Navigation uses the nav labels.
"""
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
prefix = sys.argv[sys.argv.index("--shot-prefix") + 1] if "--shot-prefix" in sys.argv else None
click = "--no-click" not in sys.argv

m = cdp.connect("Steam")
cdp.call(m, "Page.bringToFront")
time.sleep(0.4)
HOST = "[...window.opener.g_PopupManager.GetPopups()].find(p => p.m_strTitle === 'Store Supernav').window.document"


def mouse(kind, x, y, **kw):
    cdp.call(m, "Input.dispatchMouseEvent", type=kind, x=x, y=y, **kw)


def navs():
    return json.loads(cdp.evaluate(m, """JSON.stringify([...document.querySelectorAll('.SuperNavMenu')].map(w => {
      const r = w.getBoundingClientRect(); return { text: w.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))"""))


def go(index):
    n = navs()[index]
    mouse("mouseMoved", n["x"], n["y"] + 500)
    for t in ("mousePressed", "mouseReleased"):
        mouse(t, n["x"], n["y"], button="left", clickCount=1)
    mouse("mouseMoved", n["x"], n["y"] + 500)
    time.sleep(1.5)


STATE = f"""JSON.stringify({{
  inpage: !!document.querySelector('.lm-morph-inpage.open'),
  host: !!{HOST}.querySelector('.lm-morph.open'),
  hostVisible: {HOST}.visibilityState,
  items: [...document.querySelectorAll('.lm-morph-inpage.open .lm-morph-page:not(.leave) .lm-morph-item'),
          ...{HOST}.querySelectorAll('.lm-morph.open .lm-morph-page:not(.leave) .lm-morph-item')].map(b => b.textContent).slice(0, 4),
  backdrop: (document.querySelector('.lm-morph-inpage.open') ? getComputedStyle(document.querySelector('.lm-morph-inpage')).backdropFilter : '-'),
  native: [...window.opener.g_PopupManager.GetPopups()].filter(p => /Supernav/.test(p.m_strTitle) && p.m_strTitle !== 'Store Supernav')
    .map(p => p.window.document.visibilityState).filter(v => v === 'visible').length,
}})"""

WATCH = f"""(() => {{ const hd = {HOST}, log = window.__lmWatch = {{ maxPages: 0, flash: [] }}; const t0 = performance.now();
  (function tick() {{
    const pages = document.querySelectorAll('.lm-morph-inpage .lm-morph-page').length + hd.querySelectorAll('.lm-morph .lm-morph-page').length;
    log.maxPages = Math.max(log.maxPages, pages);
    if (hd.visibilityState === 'visible' && !hd.documentElement.classList.contains('lm-morph-host')) log.flash.push(Math.round(performance.now() - t0));
    if (performance.now() - t0 < 5000) setTimeout(tick, 10); }})(); return 1; }})()"""


def run(label, page_index):
    go(page_index)
    n = navs()
    print(f"== {label} page")
    cdp.evaluate(m, WATCH)
    for i in range(3):
        mouse("mouseMoved", n[i]["x"], n[i]["y"])
        time.sleep(0.5)
        print(f"   hover {n[i]['text']}: {cdp.evaluate(m, STATE)}")
        if prefix and i == 1:
            cdp.screenshot(m, f"{prefix}-{label.lower()}.png")
    for i in [1, 2, 1, 0, 2, 0, 1] * 2:   # fast back and forth
        mouse("mouseMoved", n[i]["x"], n[i]["y"])
        time.sleep(0.03)
    time.sleep(0.5)
    mouse("mouseMoved", n[0]["x"], n[0]["y"] + 500)
    time.sleep(1.0)
    w = json.loads(cdp.evaluate(m, "JSON.stringify(window.__lmWatch)"))
    print(f"   after leaving: {cdp.evaluate(m, STATE)}")
    print(f"   most pages at once: {w['maxPages']} | Steam menu shown while host visible: {w['flash'] or 'never'}")


run("Store", 0)
run("Library", 1)

if click:
    n = navs()
    mouse("mouseMoved", n[1]["x"], n[1]["y"])
    time.sleep(0.5)
    pos = json.loads(cdp.evaluate(m, """JSON.stringify((() => { const b = document.querySelector('.lm-morph-inpage .lm-morph-page:not(.leave) .lm-morph-item');
      const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, b.textContent]; })())"""))
    mouse("mouseMoved", n[1]["x"], pos[1] - 20)
    mouse("mouseMoved", pos[0], pos[1])
    time.sleep(0.2)
    for t in ("mousePressed", "mouseReleased"):
        mouse(t, pos[0], pos[1], button="left", clickCount=1)
    time.sleep(1.2)
    print(f"clicked '{pos[2]}' in the in-page panel ->", cdp.evaluate(m, """JSON.stringify({ libraryHome: !!document.querySelector('[class*="LibraryHome"]'),
      open: !!document.querySelector('.lm-morph.open') })"""))
