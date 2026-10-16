#!/usr/bin/env python3
"""Build before/after side-by-side comparison images for the design review."""

from PIL import Image, ImageDraw

BASE = "/home/z/my-project/download/review2"
OUT = f"{BASE}/comparisons"

PAIRS = [
    ("before-doctor-dash.png", "after-doctor-dash.png", "compare-doctor-dashboard.png"),
    ("before-settings.png", "after-settings.png", "compare-settings.png"),
    ("before-patients.png", "after-patients.png", "compare-patients.png"),
    ("before-session.png", "after-soap.png", "compare-soap-session.png"),
    ("before-secretary.png", "after-secretary.png", "compare-secretary-overview.png"),
    ("before-mobile360.png", "after-mobile360.png", "compare-mobile-360.png"),
    ("before-login.png", "after-login.png", "compare-login.png"),
]

import os

os.makedirs(OUT, exist_ok=True)

LABEL_H = 56
BG = (11, 18, 32)
FG = (233, 238, 245)
ACCENT = (72, 186, 180)

for before, after, name in PAIRS:
    b = Image.open(f"{BASE}/{before}")
    a = Image.open(f"{BASE}/{after}")
    # scale both to the same height (560) for compactness
    H = 560
    b = b.resize((int(b.width * H / b.height), H), Image.LANCZOS)
    a = a.resize((int(a.width * H / a.height), H), Image.LANCZOS)
    GAP = 14
    W = b.width + a.width + GAP
    canvas = Image.new("RGB", (W, H + LABEL_H), BG)
    canvas.paste(b, (0, LABEL_H))
    canvas.paste(a, (b.width + GAP, LABEL_H))
    d = ImageDraw.Draw(canvas)
    try:
        from PIL import ImageFont
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    except Exception:
        font = None
    d.rectangle([0, 0, b.width, LABEL_H], fill=(26, 33, 48))
    d.rectangle([b.width + GAP, 0, W, LABEL_H], fill=(16, 68, 66))
    d.text((b.width // 2 - 70, 14), "BEFORE", font=font, fill=(178, 186, 200))
    d.text((b.width + GAP + a.width // 2 - 62, 14), "AFTER", font=font, fill=(160, 255, 248))
    canvas.save(f"{OUT}/{name}", optimize=True)
    print(f"  + {name} ({canvas.width}x{canvas.height})")

print(f"\nSaved to {OUT}/")
