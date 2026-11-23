"""Store a generated test picture (or --video) the way the picker does and
report what the windows show; restores the current wallpaper afterwards.

  python tools/wallpapertest.py [--video] [--shot FILE]
"""
import json
import sys
import time

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
VIDEO = "--video" in sys.argv
SHOT = sys.argv[sys.argv.index("--shot") + 1] if "--shot" in sys.argv else None

HELPERS = r"""
  const db = await new Promise((ok, no) => { const r = indexedDB.open('lumina', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const get = (k) => new Promise((ok, no) => { const t = db.transaction('kv'); const q = t.objectStore('kv').get(k);
    t.oncomplete = () => ok(q.result || null); t.onerror = () => no(t.error); });
  const put = (entries) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'), s = t.objectStore('kv');
    for (const [k, v] of Object.entries(entries)) v ? s.put(v, k) : s.delete(k); t.oncomplete = ok; t.onerror = () => no(t.error); });
  const frame = (g, i) => { const grad = g.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, `hsl(${(i * 12) % 360} 80% 60%)`); grad.addColorStop(1, '#3b8cff'); g.fillStyle = grad; g.fillRect(0, 0, 320, 180); };
"""

STORE = r"""(async () => {""" + HELPERS + r"""
  window.__lmBackup = { meta: await get('meta'), wallpaper: await get('wallpaper'), poster: await get('poster'), frame: await get('frame') };
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
  frame(g, 0);
  const poster = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  let file = poster;
  if (__VIDEO__) {
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    rec.start(); let i = 0; const iv = setInterval(() => frame(g, ++i), 33);
    await new Promise(r => setTimeout(r, 2000)); rec.stop(); clearInterval(iv); await stopped;
    file = new Blob(chunks, { type: 'video/webm' });
  }
  await put({ meta: { kind: __VIDEO__ ? 'video' : 'picture', source: 'local', title: 'test' }, wallpaper: file, poster: __VIDEO__ ? poster : null, frame: null });
  db.close(); new BroadcastChannel('lumina').postMessage('wallpaper');
  return `stored ${file.type} ${Math.round(file.size / 1024)} KB; backed up ` +
    (window.__lmBackup.wallpaper ? `${window.__lmBackup.wallpaper.type} ${Math.round(window.__lmBackup.wallpaper.size / 1024)} KB` : 'nothing');
})()""".replace("__VIDEO__", "true" if VIDEO else "false")

RESTORE = r"""(async () => {""" + HELPERS + r"""
  const b = window.__lmBackup || {};
  await put({ meta: b.meta || null, wallpaper: b.wallpaper || null, poster: b.poster || null, frame: b.frame || null });
  db.close(); new BroadcastChannel('lumina').postMessage('wallpaper');
  return 'restored ' + (b.wallpaper ? `${b.wallpaper.type} ${Math.round(b.wallpaper.size / 1024)} KB` : 'nothing (default)');
})()"""

STATE = r"""(async () => {
  const v = document.querySelector('.lm-video-layer');
  let video = '(none)';
  if (v) { const t0 = v.currentTime; await new Promise(r => setTimeout(r, 400));
    video = `in ${v.parentElement === document.body ? 'body' : 'frame'}, readyState=${v.readyState}, paused=${v.paused}, ` +
      `advanced ${(v.currentTime - t0).toFixed(2)}s in 0.4s, filter=${getComputedStyle(v).filter.slice(0, 40)}`; }
  let backdrop = '(no picture)';
  for (const e of [document.body, ...document.querySelectorAll('body div')].slice(0, 400)) {
    const bg = getComputedStyle(e, '::before').backgroundImage;
    if (/blob:|wallpaper\.jpg/.test(bg)) { backdrop = bg.match(/blob:|wallpaper\.jpg/)[0]; break; } }
  return JSON.stringify({ wp: document.documentElement.style.getPropertyValue('--lm-wallpaper') ? 'blob' : '(none)', backdrop, video,
    row: ((document.querySelector('[data-lm-wallpaper] .FieldDescription') || {}).lastChild || {}).textContent || null });
})()"""


def awaited(ws, expr):
    res = cdp.call(ws, "Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
    if "exceptionDetails" in res:
        raise RuntimeError(res["exceptionDetails"])
    return res.get("result", {}).get("value")


def report(label):
    print(label)
    for t in cdp.targets():
        title = t.get("title") or ""
        if t.get("type") != "page" or not (title == "Steam" or "friends" in (t.get("url") or "").lower()):
            continue
        ws = cdp.websocket.create_connection(t["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
        print(f"   {title!r}: {awaited(ws, STATE)}")
        ws.close()


main = cdp.connect("Steam")
print(awaited(main, STORE))
time.sleep(1.0)
try:
    report("with the test file:")
    if SHOT:
        cdp.screenshot(main, SHOT)
        print("screenshot:", SHOT)
finally:
    print(awaited(main, RESTORE))
time.sleep(1.0)
report("after restoring:")
