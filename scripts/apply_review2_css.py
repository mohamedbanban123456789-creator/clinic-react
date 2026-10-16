#!/usr/bin/env python3
"""
Review-2 CSS pass — project-wide design-system correction for Sakeena Clinic.

Scope (per design review, applied at the token level so every screen inherits):
  C1  Neutral dark-navy page background (≈ #0B1220–#101827), ONE subtle gradient.
  C2  Aurora mesh blobs + giant "سكينة" watermark support + login orbs removed.
  C3  Glass borders unified around rgba(255,255,255,0.08–0.12); calmer top-lights.
  C4  Stat-card / med / safety icon tiles: neutral glass + colored icon (no
      full-saturation gradient tiles).
  C5  Single interactive accent: teal-only primary button (was teal→blue→purple).
  C6  Typography floor: 13px minimum.
  A3  Sidebar: nav scrolls internally, profile pinned (min-height:0 fix).
  A8  Mobile header: two clean grid rows (toggle | title | bell / search+profile).
  A9  Login / change-password: no clipping on short screens.
"""

import re
import sys

CSS = "/home/z/my-project/src/app/globals.css"
src = open(CSS, encoding="utf-8").read()
changes = []


def sub(old, new, label, count=1, required=True):
    global src
    n = src.count(old)
    if n == 0:
        if required:
            print(f"  !! MISS  [{label}] — pattern not found")
        return
    src = src.replace(old, new, count if count else -1)
    changes.append(f"{label} ({n}x)")


# ---------------------------------------------------------------- C1 tokens
sub(
    """  --page-bg:
    radial-gradient(ellipse 80% 50% at 50% -20%, oklch(0.24 0.06 220 / 0.8), transparent 70%),
    radial-gradient(ellipse 60% 40% at 90% 80%, oklch(0.22 0.05 170 / 0.5), transparent 70%),
    oklch(0.16 0.04 218);
  --page-bg-fallback: #141a26;""",
    """  --page-bg:
    radial-gradient(ellipse 90% 55% at 50% -18%, oklch(0.22 0.03 245 / 0.55), transparent 70%),
    oklch(0.165 0.025 250);
  --page-bg-fallback: #0B1220;""",
    "C1 page background -> neutral navy + one subtle gradient",
)

sub(
    """  --glass-bg:
    linear-gradient(145deg, oklch(1 0 0 / 0.13) 0%, oklch(1 0 0 / 0.04) 40%, oklch(1 0 0 / 0.08) 100%),
    oklch(0.19 0.045 220 / 0.72);""",
    """  --glass-bg:
    linear-gradient(145deg, oklch(1 0 0 / 0.10) 0%, oklch(1 0 0 / 0.04) 40%, oklch(1 0 0 / 0.07) 100%),
    oklch(0.20 0.03 250 / 0.76);""",
    "C1 glass base -> neutral navy 76%",
)

sub(
    """  --glass-shadow:
    inset 0 1px 1px 0 oklch(1 0 0 / 0.65),
    inset 0 -1px 1px 0 oklch(0 0 0 / 0.22),
    inset 0 0 28px 0 oklch(1 0 0 / 0.06),
    0 24px 52px -16px oklch(0.08 0.04 220 / 0.75),
    0 1px 2px 0 oklch(0 0 0 / 0.25);""",
    """  --glass-shadow:
    inset 0 1px 1px 0 oklch(1 0 0 / 0.30),
    inset 0 -1px 1px 0 oklch(0 0 0 / 0.22),
    0 24px 52px -16px oklch(0.05 0.02 250 / 0.75),
    0 1px 2px 0 oklch(0 0 0 / 0.25);""",
    "C3 glass shadow -> soft (no 28px inner glow)",
)

sub("  --glass-border: oklch(1 0 0 / 0.18);", "  --glass-border: oklch(1 0 0 / 0.10);",
    "C3 glass border 0.18 -> 0.10", required=True)
sub("  --glass-strong-bg: linear-gradient(180deg, oklch(0.17 0.04 220 / 0.88) 0%, oklch(0.12 0.03 220 / 0.94) 100%);",
    "  --glass-strong-bg: linear-gradient(180deg, oklch(0.17 0.03 250 / 0.88) 0%, oklch(0.13 0.025 250 / 0.94) 100%);",
    "C1 glass-strong -> neutral navy")
sub("  --chip-bg: linear-gradient(150deg, oklch(1 0 0 / 0.10) 0%, oklch(1 0 0 / 0.04) 100%);",
    "  --chip-bg: linear-gradient(150deg, oklch(1 0 0 / 0.09) 0%, oklch(1 0 0 / 0.04) 100%);",
    "C3 chip bg calmed")
sub("  --chip-border: oklch(1 0 0 / 0.16);", "  --chip-border: oklch(1 0 0 / 0.10);",
    "C3 chip border 0.16 -> 0.10")
sub("  --border: oklch(1 0 0 / 0.14);", "  --border: oklch(1 0 0 / 0.10);",
    "C3 border 0.14 -> 0.10")
sub("  --border-soft: oklch(1 0 0 / 0.1);", "  --border-soft: oklch(1 0 0 / 0.08);",
    "C3 border-soft 0.1 -> 0.08")
sub("  --bg: oklch(0.22 0.05 220);", "  --bg: oklch(0.22 0.03 250);", "C1 --bg token -> navy")
sub("  --shadow: 0 24px 52px -16px oklch(0.08 0.04 220 / 0.75), 0 1px 2px 0 oklch(0 0 0 / 0.25);",
    "  --shadow: 0 24px 52px -16px oklch(0.05 0.02 250 / 0.75), 0 1px 2px 0 oklch(0 0 0 / 0.25);",
    "C1 shadow token hue -> navy")

# ------------------------------------------------------ C2 aurora removal
sub(
    """/* =====================================================================
   Serene Aurora — animated mesh background layer (rendered by AppShell
   and mirrored statically on the login pages via ::before/::after)
   ===================================================================== */

@keyframes aurora-float {
  0% { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
  50% { transform: translate3d(35px, -25px, 0) scale(1.08) rotate(4deg); }
  100% { transform: translate3d(-20px, 30px, 0) scale(0.95) rotate(-3deg); }
}

.aurora-layer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.aurora-mesh {
  position: absolute;
  border-radius: 9999px;
  will-change: transform;
  transform: translateZ(0);
  animation: aurora-float 22s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;
}
.aurora-mesh.m1 { width: 680px; height: 680px; top: -128px; inset-inline-end: -96px; background: radial-gradient(circle, oklch(0.72 0.14 190 / 0.30) 0%, oklch(0.72 0.14 190 / 0.12) 45%, transparent 70%); }
.aurora-mesh.m2 { width: 760px; height: 760px; top: 15%; inset-inline-start: -15%; background: radial-gradient(circle, oklch(0.62 0.12 250 / 0.34) 0%, oklch(0.62 0.12 250 / 0.14) 45%, transparent 70%); animation-delay: -7s; }
.aurora-mesh.m3 { width: 680px; height: 680px; bottom: -20%; inset-inline-end: 15%; background: radial-gradient(circle, oklch(0.74 0.13 165 / 0.26) 0%, oklch(0.74 0.13 165 / 0.10) 45%, transparent 70%); animation-delay: -14s; }
.aurora-mesh.m4 { width: 420px; height: 420px; top: 35%; inset-inline-end: 32%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.22) 0%, oklch(0.7 0.1 295 / 0.09) 45%, transparent 70%); animation-delay: -5s; }
.aurora-mesh.m5 { width: 500px; height: 500px; bottom: 10%; inset-inline-start: 25%; background: radial-gradient(circle, oklch(0.65 0.12 215 / 0.20) 0%, oklch(0.65 0.12 215 / 0.08) 45%, transparent 70%); animation-delay: -11s; }
.aurora-watermark {
  position: absolute;
  top: 6%;
  inset-inline-start: -48px;
  font-weight: 700;
  font-size: 24vw;
  line-height: 1;
  color: oklch(1 0 0 / 0.78);
  user-select: none;
}

""",
    """/* =====================================================================
   Background — single neutral navy gradient (see :root --page-bg).
   No watermark, no aurora mesh, no blurred orbs (design review C).
   ===================================================================== */

""",
    "C2 remove aurora mesh + watermark CSS",
)

# login orbs
sub(
    """.login-page::before, .login-page::after { width: 480px; height: 480px; bottom: -15%; inset-inline-end: -10%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.26) 0%, oklch(0.7 0.1 295 / 0.10) 45%, transparent 70%); animation-delay: -12s; }
.login-page::before { width: 560px; height: 560px; top: -10%; inset-inline-start: -12%; background: radial-gradient(circle, oklch(0.72 0.14 190 / 0.30) 0%, oklch(0.72 0.14 190 / 0.12) 45%, transparent 70%); }
.login-page::after { width: 480px; height: 480px; bottom: -15%; inset-inline-end: -10%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.26) 0%, oklch(0.7 0.1 295 / 0.10) 45%, transparent 70%); animation-delay: -12s; }
""",
    "",
    "C2 remove login page orbs",
)

# reduced-motion aurora override
sub(
    """  .aurora-mesh, .login-page::before, .login-page::after { width: 480px; height: 480px; bottom: -15%; inset-inline-end: -10%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.26) 0%, oklch(0.7 0.1 295 / 0.10) 45%, transparent 70%); animation-delay: -12s; }
""",
    "",
    "C2 remove reduced-motion orb override",
)

# ------------------------------------------------- C3 top-light borders calm
for old, new, label in [
    ("border-top-color: oklch(1 0 0 / 0.55)", "border-top-color: oklch(1 0 0 / 0.30)", "top-light 0.55->0.30"),
    ("border-top-color: oklch(1 0 0 / 0.45)", "border-top-color: oklch(1 0 0 / 0.28)", "top-light 0.45->0.28"),
    ("border-top-color: oklch(1 0 0 / 0.38)", "border-top-color: oklch(1 0 0 / 0.26)", "top-light 0.38->0.26"),
    ("border-top-color: oklch(1 0 0 / 0.35)", "border-top-color: oklch(1 0 0 / 0.25)", "top-light 0.35->0.25"),
    ("border-top-color: oklch(1 0 0 / 0.3)", "border-top-color: oklch(1 0 0 / 0.22)", "top-light 0.3->0.22"),
    ("border-top-color: oklch(1 0 0 / 0.6)", "border-top-color: oklch(1 0 0 / 0.32)", "top-light 0.6->0.32"),
]:
    n = src.count(old)
    src = src.replace(old, new)
    if n:
        changes.append(f"{label} ({n}x)")

# 0.7 top-lights appear on display-screen white pills — calm those too
n = src.count("border-top-color: oklch(1 0 0 / 0.7)")
src = src.replace("border-top-color: oklch(1 0 0 / 0.7)", "border-top-color: oklch(1 0 0 / 0.34)")
if n:
    changes.append(f"top-light 0.7->0.34 ({n}x)")

# ------------------------------------------------------- C4 stat icon tiles
sub(
    """.stat-icon {
  width: 46px; height: 46px;
  border-radius: 24%;
  display: grid; place-items: center;
  flex: 0 0 auto;
  color: var(--text-strong);
  box-shadow:
    inset 0 1px 1px 0 oklch(1 0 0 / 0.6),
    inset 0 -1px 1px 0 oklch(0 0 0 / 0.25),
    0 10px 20px -6px oklch(0.08 0.04 220 / 0.4);
  position: relative;
  overflow: hidden;
}
.stat-icon::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, oklch(1 0 0 / 0.3) 0%, transparent 60%);
  pointer-events: none;
}
.stat-card.violet .stat-icon { background: linear-gradient(135deg, oklch(0.75 0.12 280) 0%, oklch(0.68 0.12 310) 100%); }
.stat-card.amber .stat-icon { background: linear-gradient(135deg, oklch(0.85 0.14 80) 0%, oklch(0.76 0.15 60) 100%); }
.stat-card.mint .stat-icon { background: linear-gradient(135deg, oklch(0.8 0.14 165) 0%, oklch(0.7 0.13 185) 100%); }
.stat-card.blue .stat-icon { background: linear-gradient(135deg, oklch(0.78 0.12 185) 0%, oklch(0.7 0.13 225) 50%, oklch(0.66 0.11 270) 100%); }
.stat-card.coral .stat-icon { background: linear-gradient(135deg, oklch(0.7 0.19 22) 0%, oklch(0.62 0.2 22) 100%); }""",
    """.stat-icon {
  width: 46px; height: 46px;
  border-radius: 24%;
  display: grid; place-items: center;
  flex: 0 0 auto;
  background: linear-gradient(150deg, oklch(1 0 0 / 0.12) 0%, oklch(1 0 0 / 0.05) 100%);
  border: 1px solid oklch(1 0 0 / 0.12);
  box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.22);
  color: oklch(1 0 0 / 0.9);
}
/* Unified neutral glass tiles — the tone only tints the icon + a soft wash. */
.stat-card.violet .stat-icon { color: oklch(0.8 0.11 280); background: linear-gradient(150deg, oklch(0.62 0.08 280 / 0.30) 0%, oklch(1 0 0 / 0.05) 100%); }
.stat-card.amber .stat-icon { color: oklch(0.85 0.13 75); background: linear-gradient(150deg, oklch(0.6 0.08 75 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%); }
.stat-card.mint .stat-icon { color: oklch(0.8 0.14 165); background: linear-gradient(150deg, oklch(0.55 0.08 165 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%); }
.stat-card.blue .stat-icon { color: oklch(0.76 0.11 225); background: linear-gradient(150deg, oklch(0.55 0.08 225 / 0.30) 0%, oklch(1 0 0 / 0.05) 100%); }
.stat-card.coral .stat-icon { color: oklch(0.78 0.15 25); background: linear-gradient(150deg, oklch(0.55 0.09 25 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%); }""",
    "C4 stat icons -> neutral glass + colored icon",
)

# med icons + safety icon
sub(
    """.med-icon.violet { background: linear-gradient(135deg, oklch(0.75 0.12 280), oklch(0.68 0.12 310)); color: var(--text-strong); border-color: oklch(1 0 0 / 0.35); }
.med-icon.teal { background: linear-gradient(135deg, oklch(0.78 0.12 185), oklch(0.7 0.13 225)); color: oklch(0.98 0.005 200); border-color: oklch(1 0 0 / 0.35); }
.med-icon.coral { background: linear-gradient(135deg, oklch(0.7 0.19 22), oklch(0.62 0.2 22)); color: var(--text-strong); border-color: oklch(1 0 0 / 0.35); }""",
    """.med-icon.violet { background: linear-gradient(150deg, oklch(0.62 0.08 280 / 0.30) 0%, oklch(1 0 0 / 0.05) 100%); color: oklch(0.8 0.11 280); border-color: oklch(1 0 0 / 0.12); }
.med-icon.teal { background: linear-gradient(150deg, oklch(0.55 0.08 185 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%); color: oklch(0.78 0.12 190); border-color: oklch(1 0 0 / 0.12); }
.med-icon.coral { background: linear-gradient(150deg, oklch(0.55 0.09 25 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%); color: oklch(0.78 0.15 25); border-color: oklch(1 0 0 / 0.12); }""",
    "C4 med icons -> tinted glass",
)
sub(
    """.safety-icon {
  width: 44px; height: 44px;
  display: grid; place-items: center;
  color: oklch(0.96 0.1 165);
  background: linear-gradient(135deg, oklch(0.8 0.14 165), oklch(0.7 0.13 185));
  border: 1px solid oklch(1 0 0 / 0.35);
  border-radius: 14px;
  box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.6);
}""",
    """.safety-icon {
  width: 44px; height: 44px;
  display: grid; place-items: center;
  color: oklch(0.8 0.14 165);
  background: linear-gradient(150deg, oklch(0.55 0.08 165 / 0.28) 0%, oklch(1 0 0 / 0.05) 100%);
  border: 1px solid oklch(1 0 0 / 0.12);
  border-radius: 14px;
  box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.22);
}""",
    "C4 safety icon -> tinted glass",
)

# ------------------------------------------------------- C5 teal-only button
sub(
    """.btn-primary {
  color: oklch(1 0 0);
  background: linear-gradient(135deg, oklch(0.62 0.11 190) 0%, oklch(0.55 0.1 225) 50%, oklch(0.52 0.1 270) 100%);
  box-shadow:
    inset 0 1px 1px 0 oklch(1 0 0 / 0.7),
    0 10px 24px -6px oklch(0.5 0.1 200 / 0.5);
}""",
    """.btn-primary {
  color: oklch(1 0 0);
  background: linear-gradient(135deg, oklch(0.72 0.11 190) 0%, oklch(0.58 0.11 192) 100%);
  box-shadow:
    inset 0 1px 1px 0 oklch(1 0 0 / 0.45),
    0 10px 24px -6px oklch(0.55 0.1 190 / 0.45);
}""",
    "C5 primary button -> single teal accent",
)
sub("  --primary-deep: oklch(0.66 0.11 225);", "  --primary-deep: oklch(0.58 0.11 192);",
    "C5 primary-deep token -> teal")

# ------------------------------------------------------------- A3 sidebar
sub(
    ".sidebar nav { flex: 1; overflow: auto; margin: 0 -6px; padding: 0 6px; }",
    ".sidebar nav { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0 -6px; padding: 0 6px; }",
    "A3 sidebar nav internal scroll (min-height:0)",
)
sub(
    ".brand { display: flex; align-items: center; gap: 12px; padding: 0 6px 20px; }",
    ".brand { display: flex; align-items: center; gap: 12px; padding: 0 6px 20px; flex-shrink: 0; }",
    "A3 brand pinned",
)
sub(
    """.sidebar-profile {
  border: 1px solid oklch(1 0 0 / 0.16);""",
    """.sidebar-profile {
  flex-shrink: 0;
  border: 1px solid oklch(1 0 0 / 0.16);""",
    "A3 profile card pinned (flex-shrink 0)",
)

# ------------------------------------------------- A9 login short screens
sub(
    """.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}""",
    """.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
}""",
    "A9 login page: no overflow clipping (short screens scroll)",
)
sub(
    """@media (max-width: 640px) {
  .app { padding: 12px; }""",
    """@media (max-height: 760px) {
  .login-card { padding: 26px 26px; }
  .login-card h2 { font-size: 21px; }
  .login-card > p { margin: 0 0 16px; }
  .login-card .field { margin-bottom: 12px; }
  .mobile-brand { margin-bottom: 14px; }
  .remember { margin: 4px 0 14px; }
  .login-security { margin-top: 14px; }
}

@media (max-width: 640px) {
  .app { padding: 12px; }""",
    "A9 compact login card on short viewports",
)

# --------------------------------------------- A8 mobile header two rows
sub(
    """@media (max-width: 640px) {
  .app { padding: 12px; }
  .page-head { flex-direction: column; align-items: stretch; }
  .page-title h1 { font-size: 24px; }
  .header-actions { width: 100%; }
  .global-search { width: 100%; flex: 1 1 160px; }""",
    """@media (max-width: 1024px) {
  /* Two clean header rows: [toggle | title | bell] then [search | profile] */
  .page-head {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 10px 12px;
    margin-bottom: 16px;
  }
  .page-title { grid-column: 2; grid-row: 1; min-width: 0; }
  .header-actions { display: contents; }
  .nav-toggle { grid-column: 1; grid-row: 1; }
  .notification { grid-column: 3; grid-row: 1; justify-self: end; }
  .global-search { grid-column: 1 / 3; grid-row: 2; width: auto; min-width: 0; }
  .mini-profile { grid-column: 3; grid-row: 2; justify-self: end; max-width: 190px; }
}

@media (max-width: 640px) {
  .app { padding: 12px; }
  .page-title h1 { font-size: 22px; }
  .mini-profile { max-width: 168px; }
  .mini-profile small { display: none; }
  .global-search { min-width: 0; }""",
    "A8 mobile header grid — two rows, no overlap",
)

# --------------------------------------------------- C6 13px typography floor
for size in ["11.5px", "12px", "12.5px"]:
    n = len(re.findall(rf"font-size: {re.escape(size)}", src))
    src = re.sub(rf"font-size: {re.escape(size)}", "font-size: 13px", src)
    if n:
        changes.append(f"C6 font-size {size} -> 13px ({n}x)")

# -------------------------------------------- display screen navy background
sub(
    """  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, oklch(0.24 0.06 220 / 0.85), transparent 70%),
    radial-gradient(ellipse 60% 40% at 90% 80%, oklch(0.22 0.05 170 / 0.55), transparent 70%),
    oklch(0.16 0.04 218);""",
    """  background:
    radial-gradient(ellipse 90% 55% at 50% -18%, oklch(0.22 0.03 245 / 0.55), transparent 70%),
    oklch(0.165 0.025 250);""",
    "C1 display screen background -> navy",
)

# notification badge ring color follows new navy base
sub("border: 2px solid oklch(0.2 0.05 220);", "border: 2px solid oklch(0.18 0.03 250);",
    "badge ring color -> navy")

# ------------------------------------------------------------------ write
open(CSS, "w", encoding="utf-8").write(src)
print(f"\n{len(changes)} change groups applied:")
for c in changes:
    print(f"  + {c}")
