"""Steam's CSS-module class map, read from steamui/*.js (Webpack and ESM builds).

  python tools/classmap.py build [--steamui DIR]   write tools/classmap.json
  python tools/classmap.py find <regex>            search readable names
  python tools/classmap.py hash <prefix>           reverse-lookup a hashed class
  python tools/classmap.py check <folder>          report unknown hashed classes in CSS
  python tools/classmap.py mod <index>             dump one module
"""
import json
import os
import re
import sys

STEAMUI = r"C:\Program Files (x86)\Steam\steamui"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "classmap.json")

# Webpack build: key:"_3mz8wQ6Q44B8P7pzPP4Iyw" (15+ chars, contains a digit)
PAIR = re.compile(r'([A-Za-z_$][\w$-]*|"[^"]+"):"([A-Za-z_-][\w-]{8,})"')
WEBPACK_HASH = re.compile(r"^(?=.*\d)[_A-Za-z][\w-]{14,}$")

# ESM build (Rolldown/esbuild): 12-13 char base64url hashes ending with "-"
# e.g. eCdQEGAxYXk-, _8djvr-VozwQ-, -CpmJ6WkwpQ-; hoisted to const/var bindings
# or inlined in object literals using quotes or template literals (`...`).
ESM_HASH = re.compile(r"^(?!--|-\d)[A-Za-z_-][A-Za-z0-9_-]{10,11}-$")
ESM_TOKEN = re.compile(
    r'(?:^|[\n;,{}(\s])([A-Za-z_$][\w$]*)\s*=\s*(["\'`])([^"\'`\\\n]{12,64})\2'
    r"|\{([^{}]{5,}?)\}"
)
ESM_PROP = re.compile(
    r'^\s*(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z_$][\w$-]*))\s*'
    r'(?::\s*(?:(["\'`])([^"\'`\\\n]*)\4|([A-Za-z_$][\w$]*)))?\s*$'
)


def detect_esm(steamui=STEAMUI):
    """Steam's ESM build loads its entry script via <script type="module">."""
    index = os.path.join(steamui, "index.html")
    if not os.path.isfile(index):
        return False
    with open(index, encoding="utf-8", errors="replace") as fh:
        return 'type="module"' in fh.read()


def _esm_token(raw):
    tok = raw.split(" ", 1)[0]
    return tok if ESM_HASH.match(tok) else None


def extract_webpack(text, rel):
    modules = []
    for block in re.finditer(r"\{((?:[^{}]){20,}?)\}", text):
        pairs = PAIR.findall(block.group(1))
        pairs = [(k.strip('"'), v) for k, v in pairs if WEBPACK_HASH.match(v)]
        if len(pairs) >= 2:
            modules.append({"file": rel, "classes": dict(pairs)})
    return modules


def extract_esm(text, rel):
    modules = []
    consts = {}
    for m in ESM_TOKEN.finditer(text):
        var_name, _, lit_val, block = m.groups()
        if var_name is not None:
            tok = _esm_token(lit_val)
            if tok:
                consts[var_name] = tok
            continue
        entries = [part for part in block.split(",") if part.strip()]
        if len(entries) < 2:
            continue
        pairs = []
        for part in entries:
            pm = ESM_PROP.match(part)
            if not pm:
                continue
            key = pm.group(1) or pm.group(2) or pm.group(3)
            if pm.group(4) is not None:
                tok = _esm_token(pm.group(5))
            elif pm.group(6) is not None:
                tok = consts.get(pm.group(6))
            else:
                tok = consts.get(key)
            if tok:
                pairs.append((key, tok))
        if len(pairs) >= 2 and len(pairs) * 10 >= len(entries) * 6:
            modules.append({"file": rel, "classes": dict(pairs)})
    return modules


def build(steamui=STEAMUI, force_esm=None):
    esm = detect_esm(steamui) if force_esm is None else force_esm
    extract = extract_esm if esm else extract_webpack
    modules = []
    for root, _, files in os.walk(steamui):
        for name in files:
            if not name.endswith((".js", ".mjs")):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            modules.extend(extract(text, os.path.relpath(path, steamui)))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(modules, fh, ensure_ascii=False, indent=0)
    total = sum(len(m["classes"]) for m in modules)
    kind = "esm" if esm else "webpack"
    print(f"[{kind}] {len(modules)} modules, {total} classes -> {OUT}")


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
    sel = re.compile(
        r"\.((?=[\w-]*\d)[_A-Za-z][\w-]{14,}|(?!--|-\d)[A-Za-z_-][A-Za-z0-9_-]{10,11}-)(?![A-Za-z0-9_-])"
    )
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
        steamui = args[args.index("--steamui") + 1] if "--steamui" in args else STEAMUI
        build(steamui=steamui)
    elif cmd == "find":
        find(args[0])
    elif cmd == "hash":
        reverse(args[0])
    elif cmd == "check":
        sys.exit(1 if check(args[0] if args else "src") else 0)
    else:
        print(__doc__)
