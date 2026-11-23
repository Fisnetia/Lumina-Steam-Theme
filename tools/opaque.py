"""Run opaque.js in a Steam window and print the result with readable class names.

  python tools/opaque.py [--title Steam]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cdp  # noqa: E402
import classmap  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
title = sys.argv[sys.argv.index("--title") + 1] if "--title" in sys.argv else "Steam"

rev = {}
for i, m in enumerate(classmap.load()):
    for k, v in m["classes"].items():
        rev.setdefault(v, set()).add(f"{i}.{k}")


def readable(cls):
    return " ".join("|".join(sorted(rev[c])) if c in rev else c for c in cls.split())


ws = cdp.connect(title)
for row in cdp.evaluate(ws, open(os.path.join(HERE, "opaque.js"), encoding="utf-8").read()):
    print(f"{row['area']:3}% {str(row['box']):24} {row['tag']:5} {readable(row['cls'])[:70]:70} {row['bg']}")
