"""Steam's CSS-module class map, read from steamui/*.js.

  python tools/classmap.py build             write tools/classmap.json
  python tools/classmap.py find <regex>      search readable names
  python tools/classmap.py hash <prefix>     reverse-lookup a hashed class
  python tools/classmap.py check <folder>    report unknown hashed classes in CSS
  python tools/classmap.py mod <index>       dump one module
"""
import json
import os
import re
import sys

STEAMUI = r"C:\Program Files (x86)\Steam\steamui"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "classmap.json")

# key:"value" where value looks like a CSS-module hash (has a digit or _ and is long)
PAIR = re.compile(r'([A-Za-z_$][\w$-]*|"[^"]+"):"([A-Za-z_-][\w-]{8,})"')
HASHY = re.compile(r"^(?=.*\d)[_A-Za-z][\w-]{14,}$")


def build():
    modules = []
    for root, _, files in os.walk(STEAMUI):
        for name in files:
            if not name.endswith(".js"):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            # walk object literals: split on "{" boundaries and collect runs of pairs
            for block in re.finditer(r"\{((?:[^{}]){20,}?)\}", text):
                pairs = PAIR.findall(block.group(1))
                pairs = [(k.strip('"'), v) for k, v in pairs if HASHY.match(v)]
                if len(pairs) >= 2:
                    modules.append({"file": os.path.relpath(path, STEAMUI), "classes": dict(pairs)})
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(modules, fh, ensure_ascii=False, indent=0)
    total = sum(len(m["classes"]) for m in modules)
    print(f"{len(modules)} modules, {total} classes -> {OUT}")


def load():
    if not os.path.exists(OUT):
        build()
    with open(OUT, encoding="utf-8") as fh:
        return json.load(fh)


def find(pattern):
    rx = re.compile(pattern, re.I)
    for i, m in enumerate(load()):
        hits = {k: v for k, v in m["classes"].items() if rx.search(k)}
        if hits:
            sample = ", ".join(list(m["classes"])[:4])
            print(f"[module {i} | {m['file']} | {sample} ...]")
            for k, v in hits.items():
                print(f"  {k:40} .{v}")


def reverse(prefix):
    for i, m in enumerate(load()):
        for k, v in m["classes"].items():
            if v.startswith(prefix.lstrip(".")):
                print(f"[module {i} | {m['file']}] {k} = .{v}")


def check(folder):
    known = {v for m in load() for v in m["classes"].values()}
    sel = re.compile(r"\.((?=[\w-]*\d)[_A-Za-z][\w-]{14,})")
    bad = 0
    for root, _, files in os.walk(folder):
        for name in files:
            if not name.endswith(".css"):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as fh:
                for n, line in enumerate(fh, 1):
                    for cls in sel.findall(line):
                        if cls not in known:
                            bad += 1
                            print(f"{path}:{n}: .{cls} not in current Steam build")
    print("all hashed classes found" if not bad else f"{bad} unknown class reference(s)")
    return bad


def module(index):
    m = load()[int(index)]
    print(f"[module {index} | {m['file']}]")
    for k, v in m["classes"].items():
        print(f"  {k:40} .{v}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cmd, *args = sys.argv[1:] or ["build"]
    if cmd == "mod":
        module(args[0])
        sys.exit(0)
    if cmd == "build":
        build()
    elif cmd == "find":
        find(args[0])
    elif cmd == "hash":
        reverse(args[0])
    elif cmd == "check":
        sys.exit(1 if check(args[0] if args else "src") else 0)
    else:
        print(__doc__)
