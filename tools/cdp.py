"""Minimal CDP client for Steam (start Steam with -dev or -cef-enable-debugging).

  python tools/cdp.py list
  python tools/cdp.py eval "<js>"  |  evalf file.js  |  shot out.png   [--title <window>]
"""
import base64
import itertools
import json
import sys
import urllib.request

import websocket

PORT = 8080
_ids = itertools.count(1)


def targets():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as r:
        return json.load(r)


def connect(title="Steam"):
    for t in targets():
        if t.get("type") == "page" and t.get("title") == title:
            return websocket.create_connection(t["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
    raise SystemExit(f"no page titled {title!r}; try: python tools/cdp.py list")


def call(ws, method, **params):
    msg_id = next(_ids)
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == msg_id:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg["result"]


def evaluate(ws, expr):
    res = call(ws, "Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
    if "exceptionDetails" in res:
        raise RuntimeError(res["exceptionDetails"].get("exception", {}).get("description", res["exceptionDetails"]))
    return res["result"].get("value")


def screenshot(ws, path):
    # covered windows aren't painted and the capture would hang
    call(ws, "Page.bringToFront")
    import time
    time.sleep(0.6)
    data = call(ws, "Page.captureScreenshot", format="png")["data"]
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    title = "Steam"
    if "--title" in args:
        i = args.index("--title")
        title = args[i + 1]
        del args[i:i + 2]
    cmd = args[0] if args else "list"
    if cmd == "list":
        for t in targets():
            print(f"{t.get('type'):15} {t.get('title')!r:40} {t.get('url', '')[:70]}")
    else:
        ws = connect(title)
        if cmd == "eval":
            out = evaluate(ws, args[1])
        elif cmd == "evalf":
            out = evaluate(ws, open(args[1], encoding="utf-8").read())
        elif cmd == "shot":
            screenshot(ws, args[1])
            out = f"saved {args[1]}"
        print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, indent=1))
