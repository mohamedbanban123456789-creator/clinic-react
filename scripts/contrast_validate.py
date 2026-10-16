#!/usr/bin/env python3
"""Validate PLANNED token values against WCAG before applying to CSS."""

exec(open('/home/z/my-project/scripts/contrast_audit.py').read().split('print("=== Effective')[0])

# ---------- PLANNED NEW VALUES ----------
# darker glass (mission: dark-theme glass opacity 0.65-0.8)
new_glass_white_hi = oklch_to_srgb(1, 0, 0, 0.12)
new_glass_dark = oklch_to_srgb(0.19, 0.045, 220, 0.72)

def new_glass_over(bg):
    step1 = composite(new_glass_white_hi, bg)
    return composite(new_glass_dark, step1)

# dimmer aurora blobs (reduced opacities: 0.30 max-ish on the two strongest)
page_bright2 = composite(oklch_to_srgb(0.74, 0.13, 165, 0.4), page_dark)
page_mid2 = composite(oklch_to_srgb(0.62, 0.12, 250, 0.3), page_dark)

new_surfaces = {
    "NEW glass on dark": new_glass_over(page_dark),
    "NEW glass on mid": new_glass_over(page_mid2),
    "NEW glass on bright": new_glass_over(page_bright2),
}
print("=== NEW surface luminance ===")
for n, s in new_surfaces.items():
    print(f"  {n:24s} Y={rel_lum(s):.4f}")

new_tokens = {
    "--text .98 (body)": oklch_to_srgb(0.98, 0.005, 200),
    "--muted .87": oklch_to_srgb(1, 0, 0, 0.87),
    "--faint .78": oklch_to_srgb(1, 0, 0, 0.78),
    "placeholder .72": oklch_to_srgb(1, 0, 0, 0.72),
}
print("\n=== NEW text tokens on NEW glass ===")
print(f"{'token':22s} {'dark':15s} {'mid':15s} {'bright':15s}")
for t, tok in new_tokens.items():
    row = [fmt(contrast(composite(tok, s), s)) for s in new_surfaces.values()]
    print(f"{t:22s} {row[0]:15s} {row[1]:15s} {row[2]:15s}")

# chip on new glass
chip_on_glass = composite(oklch_to_srgb(1, 0, 0, 0.10), new_surfaces["NEW glass on mid"])
print(f"\n  chip surface Y = {rel_lum(chip_on_glass):.4f}")

# NEW semantic badge text colors on chip-on-glass
sem = {
    "amber text .97/.09/75": oklch_to_srgb(0.97, 0.09, 75),
    "teal text .95/.09/190": oklch_to_srgb(0.95, 0.09, 190),
    "emerald .95/.11/165": oklch_to_srgb(0.95, 0.11, 165),
    "rose .94/.13/22": oklch_to_srgb(0.94, 0.13, 22),
    "lavender .93/.11/280": oklch_to_srgb(0.93, 0.11, 280),
}
print("\n=== NEW semantic texts on chip-over-glass(mid) ===")
for n, c in sem.items():
    print(f"  {n:26s} {fmt(contrast(c, chip_on_glass))}")

# badges with tinted bg (bump tint alpha slightly: .18-.2)
tinted = {
    "badge amber on tint": (oklch_to_srgb(0.97, 0.09, 75), composite(oklch_to_srgb(0.8, 0.14, 75, 0.18), chip_on_glass)),
    "badge teal on tint": (oklch_to_srgb(0.95, 0.09, 190), composite(oklch_to_srgb(0.74, 0.11, 190, 0.2), chip_on_glass)),
    "badge emerald on tint": (oklch_to_srgb(0.95, 0.11, 165), composite(oklch_to_srgb(0.72, 0.15, 160, 0.18), chip_on_glass)),
    "badge rose on tint": (oklch_to_srgb(0.94, 0.13, 22), composite(oklch_to_srgb(0.62, 0.2, 22, 0.2), chip_on_glass)),
    "field-error .94 rose": (oklch_to_srgb(0.94, 0.13, 22), chip_on_glass),
}
print("\n=== NEW badges ===")
for n, (fg, bg) in tinted.items():
    print(f"  {n:26s} {fmt(contrast(fg, bg))}")

# glass-strong (near-opaque) — unchanged dark 0.88/0.94
strong = composite(oklch_to_srgb(0.12, 0.03, 220, 0.94), page_bright2)
print(f"\n=== glass-strong on bright: Y={rel_lum(strong):.4f} ===")
print(f"  --muted .87 on strong    {fmt(contrast(composite(oklch_to_srgb(1,0,0,0.87), strong), strong))}")
print(f"  amber .97 on strong      {fmt(contrast(oklch_to_srgb(0.97,0.09,75), strong))}")
print(f"  rose .94 on strong       {fmt(contrast(oklch_to_srgb(0.94,0.13,22), strong))}")
print(f"  lavender .93 on strong   {fmt(contrast(oklch_to_srgb(0.93,0.11,280), strong))}")

# login card over mid aurora (radial-gradient blobs dimmer)
login2 = new_glass_over(page_mid2)
print(f"\n=== NEW login card: placeholder .72 {fmt(contrast(composite(oklch_to_srgb(1,0,0,0.72), login2), login2))} ===")
