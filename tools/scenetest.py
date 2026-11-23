"""Show a Wallpaper Engine scene as the wallpaper without the file dialog
(files go in through DOM.setFileInputFiles) and report how it runs. The
current wallpaper is restored unless --keep.

  python tools/scenetest.py <item folder> [--shot FILE] [--keep]
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
if not args:
    raise SystemExit(__doc__)
item = args[0]
shot = sys.argv[sys.argv.index("--shot") + 1] if "--shot" in sys.argv else None
if shot in args:
    args.remove(shot)
keep = "--keep" in sys.argv

project = json.load(open(os.path.join(item, "project.json"), encoding="utf-8"))
files = [os.path.join(item, "scene.pkg"), os.path.join(item, "project.json")]
if project.get("preview") and os.path.exists(os.path.join(item, project["preview"])):
    files.append(os.path.join(item, project["preview"]))

IDB = r"""
  const db = await new Promise((ok, no) => { const r = indexedDB.open('lumina', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const get = (k) => new Promise((ok, no) => { const t = db.transaction('kv'); const q = t.objectStore('kv').get(k);
    t.oncomplete = () => ok(q.result || null); t.onerror = () => no(t.error); });
  const put = (entries) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'), s = t.objectStore('kv');
    for (const [k, v] of Object.entries(entries)) v ? s.put(v, k) : s.delete(k); t.oncomplete = ok; t.onerror = () => no(t.error); });
"""


def evaluate(ws, expr, by_value=True):
    res = cdp.call(ws, "Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=by_value)
    if "exceptionDetails" in res:
        raise RuntimeError(json.dumps(res["exceptionDetails"])[:600])
    return res["result"]


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")
inp = evaluate(main, "(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true;"
                     " i.id = '__lmSceneTestInput'; i.style.display = 'none'; document.body.appendChild(i); return i; })()",
               by_value=False)
cdp.call(main, "DOM.setFileInputFiles", files=files, objectId=inp["objectId"])

STORE = r"""(async () => {""" + IDB + r"""
  const inp = document.getElementById('__lmSceneTestInput');
  const byName = Object.fromEntries([...inp.files].map(f => [f.name.toLowerCase(), f]));
  window.__lmSceneBackup = { meta: await get('meta'), wallpaper: await get('wallpaper'), poster: await get('poster'), frame: await get('frame') };
  const project = JSON.parse(await byName['project.json'].text());
  const preview = project.preview ? byName[String(project.preview).toLowerCase()] : null;
  await put({ meta: { kind: 'scene', source: 'local', title: project.title, project }, wallpaper: byName['scene.pkg'], poster: preview, frame: null });
  db.close(); inp.remove();
  new BroadcastChannel('lumina').postMessage('wallpaper');
  return `stored scene "${project.title}" (${Math.round(byName['scene.pkg'].size / 1024)} KB pkg); backed up ` +
    (window.__lmSceneBackup.meta ? JSON.stringify(window.__lmSceneBackup.meta.kind) :
     window.__lmSceneBackup.wallpaper ? window.__lmSceneBackup.wallpaper.type : 'nothing');
})()"""

RESTORE = r"""(async () => {""" + IDB + r"""
  const b = window.__lmSceneBackup || {};
  await put({ meta: b.meta || null, wallpaper: b.wallpaper || null, poster: b.poster || null, frame: b.frame || null });
  db.close(); new BroadcastChannel('lumina').postMessage('wallpaper');
  return 'restored previous wallpaper';
})()"""

print(evaluate(main, STORE)["value"])
try:
    for t in (2, 5, 9):
        time.sleep(t - (0 if t == 2 else {5: 2, 9: 5}[t]))
        st = evaluate(main, "JSON.stringify(window.__lmWallpaperState ? window.__lmWallpaperState() : null)")["value"]
        canvas = evaluate(main, "(() => { const c = document.querySelector('.lm-scene-layer canvas');"
                                " return c ? `${c.width}x${c.height} shown ${Math.round(c.getBoundingClientRect().width)}x"
                                "${Math.round(c.getBoundingClientRect().height)}` : 'no canvas'; })()")["value"]
        print(f"+{t}s: {st} | canvas {canvas}")
    if shot:
        cdp.screenshot(main, shot)
        print("screenshot:", shot)
finally:
    if not keep:
        print(evaluate(main, RESTORE)["value"])
