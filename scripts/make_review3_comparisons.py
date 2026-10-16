#!/usr/bin/env python3
"""Build before/after side-by-side comparisons for the visual-polish review."""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = "/home/z/my-project/download/review3"
OUT = os.path.join(BASE, "comparisons")
os.makedirs(OUT, exist_ok=True)

PAIRS = [
    ("before-login.png", "after-login.png", "شاشة تسجيل الدخول"),
    ("before-doctor-dash.png", "after-doctor-dash.png", "لوحة الطبيب"),
    ("before-medications.png", "after-medications-bento.png", "إدارة الأدوية"),
    ("before-reports.png", "after-reports.png", "التقارير"),
    ("before-session.png", "after-session.png", "الجلسة الحالية"),
]

W = 1440
HEADER = 64
GAP = 8

try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf", 26)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
except Exception:
    font = ImageFont.load_default()
    font_small = font

for before, after, title in PAIRS:
    bp = os.path.join(BASE, before)
    ap = os.path.join(BASE, after)
    if not (os.path.exists(bp) and os.path.exists(ap)):
        print(f"skip (missing): {before} / {after}")
        continue
    b = Image.open(bp).convert("RGB")
    a = Image.open(ap).convert("RGB")
    # scale to same width
    def scale(img, w):
        h = round(img.height * w / img.width)
        return img.resize((w, h), Image.LANCZOS)
    b, a = scale(b, W), scale(a, W)
    h = max(b.height, a.height)
    canvas = Image.new("RGB", (W * 2 + GAP, h + HEADER), (10, 16, 24))
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W * 2 + GAP, HEADER], fill=(12, 20, 30))
    # title (centered)
    tw = d.textlength(title, font=font)
    d.text(((W * 2 + GAP - tw) / 2, 16), title, fill=(235, 240, 245), font=font)
    # labels
    d.text((24, 18), "BEFORE", fill=(160, 174, 192), font=font_small)
    d.text((W + GAP + 24, 18), "AFTER", fill=(94, 234, 212), font=font_small)
    canvas.paste(b, (0, HEADER))
    canvas.paste(a, (W + GAP, HEADER))
    out = os.path.join(OUT, f"cmp-{title.replace(' ', '-')}.png")
    canvas.save(out, optimize=True)
    print("saved:", out)
print("done")
