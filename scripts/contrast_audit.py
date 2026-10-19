#!/usr/bin/env python3
"""WCAG contrast audit for the Sakeena Clinic liquid-glass design system.
Converts oklch tokens -> sRGB -> relative luminance -> contrast ratios,
compositing translucent glass layers over realistic page backgrounds.
"""

def oklch_to_srgb(L, C, h, alpha=1.0):
    """oklch -> linear sRGB (approximate, good enough for contrast math)."""
    # oklch -> oklab
    import math
    h_rad = math.radians(h)
    a = C * math.cos(h_rad)
    b = C * math.sin(h_rad)
    # oklab -> LMS' (nonlinear)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l = l_ ** 3
    m = m_ ** 3
    s = s_ ** 3
    # LMS -> linear sRGB
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def clamp(x):
        return 0.0 if x < 0 else (1.0 if x > 1 else x)
    def gamma(x):
        x = clamp(x)
        return x / 12.92 if x <= 0.0031308 else ((x + 0.055) / 1.055) ** 2.4
    return (gamma(r), gamma(g), gamma(bb), alpha)


def to_rgb01(t):
    """linear tuple (already gamma-encoded approx from gamma()) -> 0..1"""
    return t


def rel_lum(rgb):
    r, g, b, _ = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def composite(fg, bg):
    """alpha-composite two sRGB (gamma-space approx) tuples -> resulting tuple"""
    fr, fg_, fb, fa = fg
    br, bg_, bb, ba = bg
    out_a = fa + ba * (1 - fa)
    if out_a == 0:
        return (0, 0, 0, 1)
    def mix(fc, bc):
        return (fc * fa + bc * ba * (1 - fa)) / out_a
    return (mix(fr, br), mix(fg_, bg_), mix(fb, bb), 1.0)


def contrast(c1, c2):
    l1 = rel_lum(c1)
    l2 = rel_lum(c2)
    lo, hi = min(l1, l2), max(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def fmt(ratio):
    tag = "AAA" if ratio >= 7 else ("AA" if ratio >= 4.5 else ("AA-lg" if ratio >= 3 else "FAIL"))
    return f"{ratio:5.2f}:1  {tag}"


# ---------------------------------------------------------------- backgrounds
# Page: deep blue-charcoal base; aurora blobs brighten local regions.
page_dark = oklch_to_srgb(0.16, 0.04, 218)          # darkest base
page_mid = composite(oklch_to_srgb(0.62, 0.12, 250, 0.35), page_dark)   # blob wash mid
page_bright = composite(oklch_to_srgb(0.74, 0.13, 165, 0.55), page_dark)  # brightest blob area

# Glass panel composite = white gradient (0.22->0.05) + dark layer (0.35)
glass_white_hi = oklch_to_srgb(1, 0, 0, 0.22)
glass_white_lo = oklch_to_srgb(1, 0, 0, 0.05)
glass_dark = oklch_to_srgb(0.22, 0.05, 220, 0.35)


def glass_over(bg):
    step1 = composite(glass_white_hi, bg)
    step2 = composite(glass_dark, step1)
    return step2

surfaces = {
    "glass on dark base": glass_over(page_dark),
    "glass on mid wash": glass_over(page_mid),
    "glass on BRIGHT blob": glass_over(page_bright),
}

print("=== Effective surface luminance (Y) ===")
for name, s in surfaces.items():
    print(f"  {name:26s} Y={rel_lum(s):.4f}")

# ---------------------------------------------------------------- text tokens
text_tokens = {
    "--text (L .98)": oklch_to_srgb(0.98, 0.005, 200),
    "--text-strong (white)": oklch_to_srgb(1, 0, 0),
    "--muted (white .78)": oklch_to_srgb(1, 0, 0, 0.78),
    "--faint (white .68)": oklch_to_srgb(1, 0, 0, 0.68),
    "placeholder (white .6)": oklch_to_srgb(1, 0, 0, 0.60),
    "stat-card p (white .75)": oklch_to_srgb(1, 0, 0, 0.75),
    "stat-card span (white .72)": oklch_to_srgb(1, 0, 0, 0.72),
    "nav-group (white .66)": oklch_to_srgb(1, 0, 0, 0.66),
    "nav-item (white .85)": oklch_to_srgb(1, 0, 0, 0.85),
}

print("\n=== Text tokens on glass surfaces (alpha correctly composited) ===")
print(f"{'token':30s} {'on dark':16s} {'on mid':16s} {'on BRIGHT':16s}")
for tname, tok in text_tokens.items():
    row = []
    for sname, surf in surfaces.items():
        eff = composite(tok, surf)
        row.append(fmt(contrast(eff, surf)))
    print(f"{tname:30s} {row[0]:16s} {row[1]:16s} {row[2]:16s}")

# ---------------------------------------------------------------- badges
# badge backgrounds = tint @ .16-.18 alpha over glass-on-mid
badge_glass = surfaces["glass on mid wash"]
badges = {
    "badge-waiting amber": (
        oklch_to_srgb(0.95, 0.07, 75),
        composite(oklch_to_srgb(0.8, 0.14, 75, 0.16), badge_glass),
    ),
    "badge-current teal": (
        oklch_to_srgb(0.92, 0.08, 190),
        composite(oklch_to_srgb(0.74, 0.11, 190, 0.18), badge_glass),
    ),
    "badge-done emerald": (
        oklch_to_srgb(0.93, 0.1, 165),
        composite(oklch_to_srgb(0.72, 0.15, 160, 0.16), badge_glass),
    ),
    "field-error rose": (
        oklch_to_srgb(0.88, 0.11, 22),
        badge_glass,
    ),
    "btn-primary text (white on calm)": (
        oklch_to_srgb(1, 0, 0),
        oklch_to_srgb(0.55, 0.1, 225),  # mid of the CTA gradient
    ),
}

print("\n=== Badges / semantic chips (on mid glass) ===")
for bname, (fg, bg) in badges.items():
    print(f"  {bname:32s} {fmt(contrast(fg, bg))}")

# ---------------------------------------------------------------- muted on dense surfaces
toast_bg = oklch_to_srgb(0.12, 0.03, 220, 0.96)
print("\n=== Toast / dense surfaces ===")
print(f"  toast text (white)           {fmt(contrast(oklch_to_srgb(1,0,0), toast_bg))}")
print(f"  toast on BRIGHT blob bg      {fmt(contrast(oklch_to_srgb(1,0,0), composite(toast_bg, page_bright)))}")

# ---------------------------------------------------------------- login screen
login_glass = glass_over(page_mid)
print("\n=== Login card (glass on mid) ===")
print(f"  white body                   {fmt(contrast(oklch_to_srgb(1,0,0), login_glass))}")
print(f"  --muted .78                  {fmt(contrast(composite(oklch_to_srgb(1,0,0,0.78), login_glass), login_glass))}")
print(f"  --faint .68                  {fmt(contrast(composite(oklch_to_srgb(1,0,0,0.68), login_glass), login_glass))}")
print(f"  placeholder .6               {fmt(contrast(composite(oklch_to_srgb(1,0,0,0.60), login_glass), login_glass))}")
