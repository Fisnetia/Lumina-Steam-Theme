"""Build the theme from src/ into dist/ and install it into Millennium.

{{Key}} or {{Anchor.Key}} in CSS/JS becomes Steam's hashed class (".hash", or
":is(...)" when several modules match); unknown names fail the build.
vendor/ is copied as is.

  python tools/build.py               refresh the class map, build, install
  python tools/build.py --offline     reuse tools/classmap.json
  python tools/build.py --no-install  build only
  python tools/build.py --plugin      also install the lumina-extended plugin
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
THEME_NAME = "lumina"
THEMES_DIR = r"C:\Program Files (x86)\Steam\millennium\themes"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classmap  # noqa: E402

PLACEHOLDER = re.compile(r"\{\{([A-Za-z_][\w-]*)(?:\.([A-Za-z_][\w-]*))?\}\}")


def resolver(modules):
    cache = {}

    def resolve(anchor, key):
        if (anchor, key) in cache:
            return cache[(anchor, key)]
        hashes = []
        for m in modules:
            cls = m["classes"]
            if key in cls and anchor in cls and cls[key] not in hashes:
                hashes.append(cls[key])
        cache[(anchor, key)] = hashes
        return hashes

    return resolve


def compile_css(text, resolve, where, errors, stats):
    def sub(match):
        first, second = match.group(1), match.group(2)
        anchor, key = (first, second) if second else (first, first)
        hashes = resolve(anchor, key)
        if not hashes:
            errors.append(f"{where}: {match.group(0)} not found in this Steam build")
            return match.group(0)
        stats["refs"] += 1
        if len(hashes) == 1:
            return "." + hashes[0]
        stats["multi"] += 1
        stats.setdefault("multi_names", set()).add(f"{match.group(0)} x{len(hashes)}")
        return ":is(" + ",".join("." + h for h in hashes) + ")"

    return PLACEHOLDER.sub(sub, text)


def check_skin(skin):
    """Every file skin.json points at must exist in dist/."""
    missing = []

    def need(path):
        if path and not path.startswith("http") and not os.path.exists(os.path.join(DIST, path)):
            missing.append(path)

    for patch in skin.get("Patches", []):
        need(patch.get("TargetCss"))
        need(patch.get("TargetJs"))
    for cond in skin.get("Conditions", {}).values():
        for value in cond.get("values", {}).values():
            for target in ("TargetCss", "TargetJs"):
                if target in value:
                    need(value[target]["src"])
    for key in ("RootColors", "Steam-WebKit", "header_image", "splash_image"):
        need(skin.get(key))
    return missing


def build(offline=False):
    if not offline or not os.path.exists(classmap.OUT):
        classmap.build()
    modules = classmap.load()
    resolve = resolver(modules)

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    errors, stats = [], {"refs": 0, "multi": 0, "files": 0}
    for root, _, files in os.walk(SRC):
        for name in files:
            src_path = os.path.join(root, name)
            rel = os.path.relpath(src_path, SRC)
            out_path = os.path.join(DIST, rel)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            # vendor/ is third-party: copied untouched
            vendored = rel.split(os.sep)[0] == "vendor"
            if name.endswith((".css", ".js")) and not vendored:
                with open(src_path, encoding="utf-8") as fh:
                    text = fh.read()
                text = compile_css(text, resolve, rel, errors, stats)
                with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)
            else:
                shutil.copy2(src_path, out_path)
            stats["files"] += 1

    with open(os.path.join(DIST, "skin.json"), encoding="utf-8") as fh:
        skin = json.load(fh)
    for path in check_skin(skin):
        errors.append(f"skin.json: {path} does not exist")

    if errors:
        print("\n".join(errors))
        print(f"build FAILED with {len(errors)} error(s)")
        return False
    print(f"built {stats['files']} files into dist/ "
          f"({stats['refs']} class references, {stats['multi']} matched several modules)")
    for name in sorted(stats.get("multi_names", ())):
        print(f"  several modules: {name}")
    return True


MARKER = ".lumina-install"
PLUGIN_SRC = os.path.join(ROOT, "plugin", "lumina-extended")
PLUGINS_DIR = r"C:\Program Files (x86)\Steam\millennium\plugins"


def copy_into(src, target):
    """Copy src to target, replacing only a copy of ours (marker file) or a junction."""
    if os.path.isjunction(target) or os.path.islink(target):
        os.rmdir(target)  # removes the link only, never what it points to
        print(f"removed old link {target}")
    elif os.path.isdir(target):
        if not os.path.exists(os.path.join(target, MARKER)):
            print(f"{target} exists and was not installed by this script; leaving it alone")
            return False
        shutil.rmtree(target)
    shutil.copytree(src, target)
    open(os.path.join(target, MARKER), "w").close()
    print(f"installed into {target}")
    return True


# installs under old names (removed only if they carry our marker)
LEGACY = [
    (os.path.join(THEMES_DIR, "frost-glass"), ".frost-glass-install"),
    (os.path.join(PLUGINS_DIR, "frost-glass-we"), ".frost-glass-install"),
    (os.path.join(PLUGINS_DIR, "lumina-we"), MARKER),
]


def remove_legacy():
    for path, marker in LEGACY:
        if os.path.isdir(path) and os.path.exists(os.path.join(path, marker)):
            shutil.rmtree(path)
            print(f"removed old install {path}")


def install():
    remove_legacy()
    return copy_into(DIST, os.path.join(THEMES_DIR, THEME_NAME))


def install_plugin():
    """The optional lumina-extended plugin; enable it in Millennium's plugin list afterwards."""
    return copy_into(PLUGIN_SRC, os.path.join(PLUGINS_DIR, "lumina-extended"))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ok = build(offline="--offline" in sys.argv)
    if ok and "--no-install" not in sys.argv:
        ok = install()
        if ok and "--plugin" in sys.argv:
            ok = install_plugin()
    sys.exit(0 if ok else 1)
