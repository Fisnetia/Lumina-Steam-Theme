"""Check the lumina-extended plugin: Status, List, fetching through its server, and
optionally showing an item (backs up and restores the current wallpaper).

  python tools/plugintest.py [--use <id>] [--shot FILE] [--gpu]
"""
import subprocess
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
use = sys.argv[sys.argv.index("--use") + 1] if "--use" in sys.argv else None
shot = sys.argv[sys.argv.index("--shot") + 1] if "--shot" in sys.argv else None
gpu = "--gpu" in sys.argv

GPU_PS = r"""
$pids = @(Get-Process steamwebhelper -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$s = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -SampleInterval 1 -MaxSamples 8
$per = foreach ($set in $s) {
  ($set.CounterSamples | Where-Object { $_.InstanceName -match '^pid_(\d+)_' -and $pids -contains [int]$Matches[1] } |
    Measure-Object CookedValue -Sum).Sum }
'{0:N1}' -f (($per | Measure-Object -Average).Average)
"""


def gpu_use():
    out = subprocess.run(["powershell", "-NoProfile", "-Command", GPU_PS], capture_output=True, text=True)
    return out.stdout.strip() + "%"


def evaluate(ws, expr):
    res = cdp.call(ws, "Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
    if "exceptionDetails" in res:
        raise RuntimeError(json.dumps(res["exceptionDetails"])[:600])
    return res["result"].get("value")


main = cdp.connect("Steam")
cdp.call(main, "Page.bringToFront")   # covered windows don't render; measure a visible one
call = ("(async () => JSON.parse(await (window.Millennium || window.opener.Millennium)"
        ".callServerMethod('lumina-extended', '%s', {})))()")
status = evaluate(main, call % "Status")
print("Status:", status)
items = evaluate(main, call % "List")
counts = {}
for it in items:
    counts[it["type"]] = counts.get(it["type"], 0) + 1
print(f"List: {len(items)} items", counts)
base = status.get("base")
if base:
    scene = next(it for it in items if it["type"] == "scene")
    probe = f"""(async () => {{
      const b = {json.dumps(base)} + {json.dumps(scene['id'])} + '/';
      const p = await fetch(b + encodeURIComponent({json.dumps(scene['preview'])}));
      const r = await fetch(b + 'scene.pkg', {{ headers: {{ Range: 'bytes=0-15' }} }});
      const head = new TextDecoder().decode((await r.arrayBuffer()).slice(4, 12));
      return `preview ${{p.status}} ${{p.headers.get('content-type')}} ${{(await p.blob()).size}}B; ` +
             `scene.pkg range ${{r.status}} ${{r.headers.get('content-range')}} magic "${{head}}"`;
    }})()"""
    print("fetch from the page:", evaluate(main, probe))

if use:
    it = next(i for i in items if i["id"] == use)
    meta = {"kind": it["type"] if it["type"] in ("scene", "web", "video") else "picture", "source": "plugin",
            "id": it["id"], "title": it["title"], "file": it["file"], "preview": it["preview"]}
    IDB = r"""
      const db = await new Promise((ok, no) => { const r = indexedDB.open('lumina', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      const get = (k) => new Promise((ok, no) => { const t = db.transaction('kv'); const q = t.objectStore('kv').get(k);
        t.oncomplete = () => ok(q.result || null); t.onerror = () => no(t.error); });
      const put = (entries) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'), s = t.objectStore('kv');
        for (const [k, v] of Object.entries(entries)) v ? s.put(v, k) : s.delete(k); t.oncomplete = ok; t.onerror = () => no(t.error); });
    """
    if gpu:
        print("GPU before (current wallpaper):", gpu_use())
    print(evaluate(main, "(async () => {" + IDB + f"""
      window.__lmPluginBackup = {{ meta: await get('meta'), wallpaper: await get('wallpaper'), poster: await get('poster') }};
      await put({{ meta: {json.dumps(meta)}, wallpaper: null, poster: null }});
      db.close(); new BroadcastChannel('lumina').postMessage('wallpaper');
      return 'using ' + {json.dumps(it['type'] + ': ' + it['title'])};
    }})()"""))
    try:
        for t in (3, 8):
            time.sleep(3 if t == 3 else 5)
            print(f"+{t}s:", evaluate(main, "JSON.stringify(window.__lmWallpaperState())"))
        if gpu:
            print("GPU while shown:", gpu_use())
        if shot:
            cdp.screenshot(main, shot)
            print("screenshot:", shot)
    finally:
        print(evaluate(main, "(async () => {" + IDB + """
          const b = window.__lmPluginBackup || {};
          await put({ meta: b.meta || null, wallpaper: b.wallpaper || null, poster: b.poster || null });
          db.close(); new BroadcastChannel('lumina').postMessage('wallpaper');
          return 'restored previous wallpaper';
        })()"""))
