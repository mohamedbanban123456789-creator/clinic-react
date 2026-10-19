#!/usr/bin/env python3
"""Follow-up: fix the alpha parsing bug (0.85 -> float('85')=85.0) and residual
webkit blur line. Idempotent."""
import re

CSS = "/home/z/my-project/src/app/globals.css"
src = open(CSS, encoding="utf-8").read()
changes = []


def bump_alpha(m):
    val = float("0." + m.group(1))  # FIX: parse as fraction
    if val <= 0.66:
        new = "78"
    elif val <= 0.72:
        new = "82"
    elif val <= 0.78:
        new = "86"
    elif val <= 0.82:
        new = "90"
    elif val <= 0.88:
        new = "92"
    else:
        return m.group(0)
    return m.group(0).replace(f"/ 0.{m.group(1)})", f"/ 0.{new})")


pattern = re.compile(r"(?<![a-z-])color: oklch\(1 0 0 / 0\.(\d{2})\)")
src, n = pattern.subn(bump_alpha, src)
changes.append(f"alpha-white text floor bump (fixed) x{n}")

# residual webkit blur line in call-request-banner
src = src.replace(
    "  backdrop-filter: blur(12px) saturate(200%);\n  -webkit-backdrop-filter: blur(24px) saturate(200%);\n  box-shadow: inset 0 1px 1.5px 0 oklch(1 0 0 / 0.7), 0 12px 28px -10px oklch(0.08 0.04 220 / 0.65);\n  flex-wrap: wrap;",
    "  backdrop-filter: blur(12px) saturate(180%);\n  -webkit-backdrop-filter: blur(12px) saturate(180%);\n  box-shadow: inset 0 1px 1.5px 0 oklch(1 0 0 / 0.7), 0 12px 28px -10px oklch(0.08 0.04 220 / 0.65);\n  flex-wrap: wrap;",
)
changes.append("call-request-banner webkit blur aligned")

open(CSS, "w", encoding="utf-8").write(src)
for c in changes:
    print(" *", c)

# verify
src = open(CSS, encoding="utf-8").read()
from collections import Counter
left = Counter()
for line in src.split("\n"):
    m = re.search(r"(?<![a-z-])color: oklch\(1 0 0 / 0\.(\d{2})\)", line)
    if m and float("0." + m.group(1)) < 0.72 and "watermark" not in line:
        left[m.group(1)] += 1
        print("LOW:", line.strip()[:90])
print("remaining low-alpha text:", dict(left) or "NONE")
big = [v for v in re.findall(r"blur\((\d+)px\)", src) if int(v) > 14]
print("blur > 14px:", big or "NONE")
