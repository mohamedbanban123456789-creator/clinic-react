#!/usr/bin/env python3
"""Master CSS transformation for the Sakeena liquid-glass polish mission.

Applies (with per-change reporting):
 1. Glass opacity darkening (WCAG floor) + blur clamping (GPU)
 2. Text alpha floors + semantic text brightening
 3. Deep-tint status badges (high-contrast glassy chips)
 4. Aurora blobs: filter:blur -> radial-gradients (GPU)
 5. Typography: real 700 weights (font max), letter-spacing 0 for Arabic,
    size floors, H2 normalization
 6. Touch targets + dvh modals + overflow-x clip
Run: python3 scripts/apply_css_polish.py
"""
import re

CSS = "/home/z/my-project/src/app/globals.css"
src = open(CSS, encoding="utf-8").read()
changes = []


def rep(pattern, repl, count=0, flags=0, label=""):
    global src
    new, n = re.subn(pattern, repl, src, count=count, flags=flags)
    if n:
        src = new
        changes.append(f"{label or pattern[:60]}  x{n}")
    return n


# ================= 1. GLASS TIERS: darker floor + blur clamp ===============
rep(r"--glass-blur: 28px;", "--glass-blur: 12px;", label="token --glass-blur 28->12")
rep(r"--glass-strong-blur: 32px;", "--glass-strong-blur: 12px;", label="token --glass-strong-blur 32->12")

# --glass-bg: raise dark layer alpha 0.35 -> 0.72, tame white highlight
rep(
    r"--glass-bg:\n    linear-gradient\(145deg, oklch\(1 0 0 / 0\.22\) 0%, oklch\(1 0 0 / 0\.05\) 40%, oklch\(1 0 0 / 0\.10\) 100%\),\n    oklch\(0\.22 0\.05 220 / 0\.35\);",
    "--glass-bg:\n    linear-gradient(145deg, oklch(1 0 0 / 0.13) 0%, oklch(1 0 0 / 0.04) 40%, oklch(1 0 0 / 0.08) 100%),\n    oklch(0.19 0.045 220 / 0.72);",
    label="token --glass-bg darkened (0.35->0.72 dark layer)",
)

# --chip-bg subtler
rep(
    r"--chip-bg: linear-gradient\(150deg, oklch\(1 0 0 / 0\.18\) 0%, oklch\(1 0 0 / 0\.06\) 100%\);",
    "--chip-bg: linear-gradient(150deg, oklch(1 0 0 / 0.10) 0%, oklch(1 0 0 / 0.04) 100%);",
    label="token --chip-bg 0.18/0.06 -> 0.10/0.04",
)

# no-backdrop-filter fallback values
rep(r"--glass-bg: oklch\(0\.2 0\.05 220 / 0\.92\);", "--glass-bg: oklch(0.17 0.04 220 / 0.96);", label="fallback --glass-bg")
rep(r"--chip-bg: oklch\(0\.2 0\.05 220 / 0\.85\);", "--chip-bg: oklch(0.18 0.045 220 / 0.88);", label="fallback --chip-bg")

# hero/welcome/call-banner panels share the same layered recipe -> darken dark layer 0.35/0.3 -> 0.72/0.68
src = src.replace("linear-gradient(165deg, oklch(1 0 0 / 0.22) 0%, oklch(1 0 0 / 0.05) 40%, oklch(1 0 0 / 0.1) 100%),\n    oklch(0.22 0.05 220 / 0.35);",
                  "linear-gradient(165deg, oklch(1 0 0 / 0.13) 0%, oklch(1 0 0 / 0.04) 40%, oklch(1 0 0 / 0.08) 100%),\n    oklch(0.19 0.045 220 / 0.72);")
changes.append("welcome-strip/doctor-hero layered bg darkened x2")
rep(r"oklch\(0\.22 0\.05 220 / 0\.3\);\n  backdrop-filter: blur\(24px\)", "oklch(0.19 0.045 220 / 0.68);\n  backdrop-filter: blur(12px)", label="call-request-banner bg darkened")
rep(r"linear-gradient\(160deg, oklch\(1 0 0 / 0\.25\) 0%, oklch\(1 0 0 / 0\.08\) 100%\),\n    oklch\(0\.22 0\.05 220 / 0\.3\);",
    "linear-gradient(160deg, oklch(1 0 0 / 0.14) 0%, oklch(1 0 0 / 0.05) 100%),\n    oklch(0.19 0.045 220 / 0.68);", label="call-request-banner gradient darkened")

# standalone card+chip panels: add dark layer under the chip so text keeps AA on page bg
panel_fix = {
    r"\.review-card \{\n  padding: 22px;\n  background:\n    radial-gradient\(420px 220px at 85% -20%, oklch\(0\.68 0\.13 280 / 0\.3\), transparent 65%\),\n    var\(--chip-bg\);":
        ".review-card {\n  padding: 22px;\n  background:\n    radial-gradient(420px 220px at 85% -20%, oklch(0.68 0.13 280 / 0.3), transparent 65%),\n    var(--chip-bg),\n    oklch(0.19 0.045 220 / 0.55);",
    r"\.confidential-card \{\n  padding: 20px;\n  background:\n    radial-gradient\(380px 200px at 80% -20%, oklch\(0\.68 0\.13 280 / 0\.28\), transparent 65%\),\n    var\(--chip-bg\);":
        ".confidential-card {\n  padding: 20px;\n  background:\n    radial-gradient(380px 200px at 80% -20%, oklch(0.68 0.13 280 / 0.28), transparent 65%),\n    var(--chip-bg),\n    oklch(0.19 0.045 220 / 0.55);",
}
for pat, repl in panel_fix.items():
    rep(pat, repl, label=f"panel dark underlay: {pat[:28]}")

rep(r"(\.registration-prompt \{\n  padding: 34px;\n  align-self: start;\n  background: )var\(--chip-bg\);",
    r"\1var(--chip-bg),\n    oklch(0.19 0.045 220 / 0.55);", label="registration-prompt dark underlay")

# ================= 2. BLUR CLAMP (GPU 60fps) ===============================
rep(r"backdrop-filter: blur\(18px\) saturate\(190%\);\n  -webkit-backdrop-filter: blur\(18px\) saturate\(190%\);",
    "backdrop-filter: blur(10px) saturate(180%);\n  -webkit-backdrop-filter: blur(10px) saturate(180%);", label="glass-tile 18->10")
rep(r"backdrop-filter: blur\(24px\) saturate\(200%\);\n  -webkit-backdrop-filter: blur\(24px\) saturate\(200%\);",
    "backdrop-filter: blur(12px) saturate(180%);\n  -webkit-backdrop-filter: blur(12px) saturate(180%);", label="blur 24->12 (pill & co)")
rep(r"backdrop-filter: blur\(28px\) saturate\(210%\);\n  -webkit-backdrop-filter: blur\(28px\) saturate\(210%\);",
    "backdrop-filter: blur(12px) saturate(180%);\n  -webkit-backdrop-filter: blur(12px) saturate(180%);", label="blur 28->12 (modal/login)")
rep(r"backdrop-filter: blur\(36px\) saturate\(220%\);\n  -webkit-backdrop-filter: blur\(36px\) saturate\(220%\);",
    "backdrop-filter: blur(12px) saturate(180%);\n  -webkit-backdrop-filter: blur(12px) saturate(180%);", label="toast 36->12")
rep(r"backdrop-filter: blur\(24px\);\n  -webkit-backdrop-filter: blur\(24px\);",
    "backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);", label="modal-backdrop 24->8")
rep(r"backdrop-filter: blur\(20px\);\n  -webkit-backdrop-filter: blur\(20px\);",
    "backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);", label="chat-toggle 20->8")

# nested blur removal: nav-item.active sits INSIDE the blurred sidebar
rep(r"\.nav-item\.active \{\n  background: linear-gradient\(160deg, oklch\(1 0 0 / 0\.25\) 0%, oklch\(1 0 0 / 0\.08\) 100%\);\n  backdrop-filter: blur\(24px\) saturate\(200%\);\n  -webkit-backdrop-filter: blur\(24px\) saturate\(200%\);\n",
    ".nav-item.active {\n  background: linear-gradient(160deg, oklch(1 0 0 / 0.25) 0%, oklch(1 0 0 / 0.08) 100%);\n", label="REMOVE nested blur .nav-item.active")

# icon-button / mini-profile: 24 -> 8 (small elements, GPU-cheap)
rep(r"\.icon-button \{[^}]*?backdrop-filter: blur\(24px\) saturate\(200%\);\n  -webkit-backdrop-filter: blur\(24px\) saturate\(200%\);",
    ".icon-button {", label="REMOVE icon-button blur (nested/small)")
src = src.replace(
    ".icon-button {\n  border: 1px solid oklch(1 0 0 / 0.22);",
    ".icon-button {\n  backdrop-filter: blur(8px) saturate(160%);\n  -webkit-backdrop-filter: blur(8px) saturate(160%);\n  border: 1px solid oklch(1 0 0 / 0.22);",
)
changes.append("icon-button blur 8px re-added")
rep(r"\.mini-profile \{[^}]*?backdrop-filter: blur\(24px\) saturate\(200%\);\n  -webkit-backdrop-filter: blur\(24px\) saturate\(200%\);",
    ".mini-profile {", label="REMOVE mini-profile 24px blur")
src = src.replace(
    ".mini-profile {\n  border: 1px solid oklch(1 0 0 / 0.22);",
    ".mini-profile {\n  backdrop-filter: blur(8px) saturate(160%);\n  -webkit-backdrop-filter: blur(8px) saturate(160%);\n  border: 1px solid oklch(1 0 0 / 0.22);",
)
changes.append("mini-profile blur 8px re-added")

# searches: global-search (page bg) keeps 10px; compact/large are nested in cards -> none
rep(r"\.global-search, \.compact-search, \.large-search \{\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  border: 1px solid oklch\(1 0 0 / 0\.22\);\n  border-top-color: oklch\(1 0 0 / 0\.55\);\n  border-bottom-color: oklch\(1 0 0 / 0\.12\);\n  background: linear-gradient\(160deg, oklch\(1 0 0 / 0\.25\) 0%, oklch\(1 0 0 / 0\.08\) 100%\);\n  backdrop-filter: blur\(12px\) saturate\(180%\);\n  -webkit-backdrop-filter: blur\(12px\) saturate\(180%\);",
    ".global-search, .compact-search, .large-search {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  border: 1px solid oklch(1 0 0 / 0.22);\n  border-top-color: oklch(1 0 0 / 0.55);\n  border-bottom-color: oklch(1 0 0 / 0.12);\n  background: linear-gradient(160deg, oklch(1 0 0 / 0.25) 0%, oklch(1 0 0 / 0.08) 100%);", label="searches: drop nested blur")
src = src.replace(
    ".global-search:focus-within,",
    ".global-search {\n  backdrop-filter: blur(10px) saturate(160%);\n  -webkit-backdrop-filter: blur(10px) saturate(160%);\n}\n.global-search:focus-within,",
)
changes.append("global-search standalone 10px blur")

# display screens
rep(r"\.display-now \{[^}]*?backdrop-filter: blur\(24px\) saturate\(200%\);\n  -webkit-backdrop-filter: blur\(24px\) saturate\(200\%\);",
    ".display-now {", label="display-now blur 24 removed")
rep(r"backdrop-filter: blur\(24px\) saturate\(200%\); -webkit-backdrop-filter: blur\(24px\) saturate\(200\%\);",
    "backdrop-filter: blur(10px) saturate(160%); -webkit-backdrop-filter: blur(10px) saturate(160%);", label="display-queue blur 10")
src = src.replace(
    ".display-now {\n  text-align: center;",
    ".display-now {\n  backdrop-filter: blur(10px) saturate(160%);\n  -webkit-backdrop-filter: blur(10px) saturate(160%);\n  text-align: center;",
)
changes.append("display-now 10px blur re-added")
rep(r"\.nav-overlay \{\n  position: fixed;\n  inset: 0;\n  background: oklch\(0\.05 0\.02 220 / 0\.6\);\n  backdrop-filter: blur\(12px\);\n  -webkit-backdrop-filter: blur\(12px\);",
    ".nav-overlay {\n  position: fixed;\n  inset: 0;\n  background: oklch(0.05 0.02 220 / 0.6);\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);", label="nav-overlay 12->6")

# donut::after nested in card -> drop
rep(r"  background: oklch\(0\.17 0\.04 220 / 0\.96\);\n  backdrop-filter: blur\(8px\);\n  -webkit-backdrop-filter: blur\(8px\);\n",
    "  background: oklch(0.17 0.04 220 / 0.96);\n", label="donut::after nested blur removed")

# final @supports restore block -> align with new values
rep(r"\.glass-tile \{ backdrop-filter: blur\(18px\) saturate\(190\%\); \}",
    ".glass-tile { backdrop-filter: blur(10px) saturate(180%); }", label="@supports glass-tile")
rep(r"\.glass-pill \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}",
    ".glass-pill { backdrop-filter: blur(12px) saturate(180%); }", label="@supports glass-pill")
rep(r"\.nav-item\.active \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}\n  \.icon-button \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}\n  \.global-search, \.compact-search, \.large-search \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}\n  \.mini-profile \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}\n  \.modal \{ backdrop-filter: blur\(28px\) saturate\(210\%\); \}\n  \.modal-backdrop \{ backdrop-filter: blur\(24px\); \}",
    ".nav-item.active { backdrop-filter: none; }\n  .icon-button { backdrop-filter: blur(8px) saturate(160%); }\n  .global-search { backdrop-filter: blur(10px) saturate(160%); }\n  .compact-search, .large-search { backdrop-filter: none; }\n  .mini-profile { backdrop-filter: blur(8px) saturate(160%); }\n  .modal { backdrop-filter: blur(12px) saturate(180%); }\n  .modal-backdrop { backdrop-filter: blur(8px); }", label="@supports nav/icon/search/modal")
rep(r"\.login-card \{ backdrop-filter: blur\(28px\) saturate\(210\%\); \}\n  \.toast \{ backdrop-filter: blur\(36px\) saturate\(220\%\); \}",
    ".login-card { backdrop-filter: blur(12px) saturate(180%); }\n  .toast { backdrop-filter: blur(12px) saturate(180%); }", label="@supports login/toast")
rep(r"\.chat-toggle \{ backdrop-filter: blur\(20px\); \}\n  \.donut::after \{ backdrop-filter: blur\(8px\); \}\n  \.display-now \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}\n  \.display-queue \{ backdrop-filter: blur\(24px\) saturate\(200\%\); \}",
    ".chat-toggle { backdrop-filter: blur(8px); }\n  .donut::after { backdrop-filter: none; }\n  .display-now { backdrop-filter: blur(10px) saturate(160%); }\n  .display-queue { backdrop-filter: blur(10px) saturate(160%); }", label="@supports chat/display")

# ================= 3. AURORA: filter blur -> radial gradients ==============
rep(r"\.aurora-mesh \{\n  position: absolute;\n  border-radius: 9999px;\n  filter: blur\(100px\);\n  will-change: transform;\n  animation: aurora-float 22s cubic-bezier\(0\.4, 0, 0\.6, 1\) infinite alternate;\n\}",
    ".aurora-mesh {\n  position: absolute;\n  border-radius: 9999px;\n  will-change: transform;\n  transform: translateZ(0);\n  animation: aurora-float 22s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;\n}", label="aurora-mesh: filter blur REMOVED, translateZ added")
aurora = {
    r"\.aurora-mesh\.m1 \{[^}]*\}": ".aurora-mesh.m1 { width: 680px; height: 680px; top: -128px; inset-inline-end: -96px; background: radial-gradient(circle, oklch(0.72 0.14 190 / 0.30) 0%, oklch(0.72 0.14 190 / 0.12) 45%, transparent 70%); }",
    r"\.aurora-mesh\.m2 \{[^}]*\}": ".aurora-mesh.m2 { width: 760px; height: 760px; top: 15%; inset-inline-start: -15%; background: radial-gradient(circle, oklch(0.62 0.12 250 / 0.34) 0%, oklch(0.62 0.12 250 / 0.14) 45%, transparent 70%); animation-delay: -7s; }",
    r"\.aurora-mesh\.m3 \{[^}]*\}": ".aurora-mesh.m3 { width: 680px; height: 680px; bottom: -20%; inset-inline-end: 15%; background: radial-gradient(circle, oklch(0.74 0.13 165 / 0.26) 0%, oklch(0.74 0.13 165 / 0.10) 45%, transparent 70%); animation-delay: -14s; }",
    r"\.aurora-mesh\.m4 \{[^}]*\}": ".aurora-mesh.m4 { width: 420px; height: 420px; top: 35%; inset-inline-end: 32%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.22) 0%, oklch(0.7 0.1 295 / 0.09) 45%, transparent 70%); animation-delay: -5s; }",
    r"\.aurora-mesh\.m5 \{[^}]*\}": ".aurora-mesh.m5 { width: 500px; height: 500px; bottom: 10%; inset-inline-start: 25%; background: radial-gradient(circle, oklch(0.65 0.12 215 / 0.20) 0%, oklch(0.65 0.12 215 / 0.08) 45%, transparent 70%); animation-delay: -11s; }",
}
for pat, repl in aurora.items():
    rep(pat, repl, label=f"aurora {pat[12:14]} radial-gradient")

# login-page blobs: filter 90px -> radial gradients
rep(r"\.login-page::before, \.login-page::after \{\n  content: \"\";\n  position: absolute;\n  border-radius: 9999px;\n  filter: blur\(90px\);\n  pointer-events: none;\n  animation: aurora-float 26s cubic-bezier\(0\.4, 0, 0\.6, 1\) infinite alternate;\n\}",
    ".login-page::before, .login-page::after {\n  content: \"\";\n  position: absolute;\n  border-radius: 9999px;\n  pointer-events: none;\n  transform: translateZ(0);\n  animation: aurora-float 26s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;\n}", label="login blobs: filter blur REMOVED")
rep(r"\.login-page::before \{[^}]*\}", ".login-page::before { width: 560px; height: 560px; top: -10%; inset-inline-start: -12%; background: radial-gradient(circle, oklch(0.72 0.14 190 / 0.30) 0%, oklch(0.72 0.14 190 / 0.12) 45%, transparent 70%); }", label="login::before radial")
rep(r"\.login-page::after \{[^}]*\}", ".login-page::after { width: 480px; height: 480px; bottom: -15%; inset-inline-end: -10%; background: radial-gradient(circle, oklch(0.7 0.1 295 / 0.26) 0%, oklch(0.7 0.1 295 / 0.10) 45%, transparent 70%); animation-delay: -12s; }", label="login::after radial")

# body: fixed attachment repaint cost -> drop; overflow-x clip guard
rep(r"body \{\n  margin: 0;\n  min-height: 100vh;\n  background-color: var\(--page-bg-fallback\);\n  background-image: var\(--page-bg\);\n  background-attachment: fixed;\n  color: var\(--text\);\n  font-size: 15px;\n  line-height: 1\.7;\n  font-weight: 500;\n\}",
    "html, body { overflow-x: clip; }\n\nbody {\n  margin: 0;\n  min-height: 100vh;\n  background-color: var(--page-bg-fallback);\n  background-image: var(--page-bg);\n  color: var(--text);\n  font-size: 15px;\n  line-height: 1.7;\n  font-weight: 500;\n  text-underline-offset: 3px;\n}", label="body: fixed attachment removed, overflow-x clip")

# ================= 4. TEXT TOKENS + PLACEHOLDERS ============================
rep(r"--muted: oklch\(1 0 0 / 0\.78\);", "--muted: oklch(1 0 0 / 0.87);", label="token --muted 0.78->0.87")
rep(r"--faint: oklch\(1 0 0 / 0\.68\);", "--faint: oklch(1 0 0 / 0.78);", label="token --faint 0.68->0.78")

# placeholders FIRST (before generic color bump): dimmer than value text but >= 4.5:1
rep(r"(::placeholder[^\{]*)\{\n?\s*color: oklch\(1 0 0 / 0\.6\);", lambda m: m.group(0).replace("oklch(1 0 0 / 0.6)", "oklch(1 0 0 / 0.72)"), label="placeholders 0.6->0.72")
rep(r"color: oklch\(1 0 0 / 0\.55\);\n\}\n\.soap-section textarea::placeholder \{ color: oklch\(1 0 0 / 0\.55\); \}",
    "color: oklch(1 0 0 / 0.72);\n}\n.soap-section textarea::placeholder { color: oklch(1 0 0 / 0.72); }", label="soap placeholder 0.55->0.72")
rep(r"\.soap-section textarea::placeholder \{ color: oklch\(1 0 0 / 0\.55\); \}",
    ".soap-section textarea::placeholder { color: oklch(1 0 0 / 0.72); }", label="soap placeholder 0.55->0.72")

# generic alpha-white TEXT floor: color: oklch(1 0 0 / 0.xx)
def bump_alpha(m):
    val = float(m.group(1))
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
changes.append(f"alpha-white text floor bump  x{n}")

# ================= 5. SEMANTIC TEXT BRIGHTENING =============================
sem_map = [
    (r"color: oklch\(0\.85 0\.09 190\)", "color: oklch(0.93 0.09 190)"),
    (r"color: oklch\(0\.94 0\.08 190\)", "color: oklch(0.97 0.07 190)"),
    (r"color: oklch\(0\.92 0\.08 190\)", "color: oklch(0.96 0.08 190)"),
    (r"color: oklch\(0\.95 0\.08 190\)", "color: oklch(0.97 0.07 190)"),
    (r"color: oklch\(0\.9 0\.08 190 / 0\.9\)", "color: oklch(0.95 0.08 190)"),
    (r"color: oklch\(0\.95 0\.07 75\)", "color: oklch(0.98 0.07 75)"),
    (r"color: oklch\(0\.92 0\.1 75\)", "color: oklch(0.97 0.09 75)"),
    (r"color: oklch\(0\.92 0\.1 75\)", "color: oklch(0.97 0.09 75)"),
    (r"color: oklch\(0\.93 0\.1 165\)", "color: oklch(0.96 0.1 165)"),
    (r"color: oklch\(0\.88 0\.11 22\)", "color: oklch(0.94 0.13 22)"),
    (r"color: oklch\(0\.92 0\.05 22\)", "color: oklch(0.97 0.04 22)"),
    (r"color: oklch\(0\.9 0\.08 22\)", "color: oklch(0.96 0.05 22)"),
    (r"color: oklch\(0\.88 0\.1 280\)", "color: oklch(0.94 0.1 280)"),
    (r"color: oklch\(0\.85 0\.1 280 / 0\.9\)", "color: oklch(0.94 0.1 280)"),
]
for pat, repl in sem_map:
    rep(pat, repl, label=f"semantic: {repl[:40]}")

# field-error bump
rep(r"\.field-error \{ color: oklch\(0\.94 0\.13 22\) !important; font-size: 12\.5px !important; margin: 5px 2px !important; \}",
    ".field-error { color: oklch(0.95 0.14 22) !important; font-size: 12.5px !important; font-weight: 700 !important; margin: 5px 2px !important; }", label="field-error brightened + 700")

# ================= 6. STATUS BADGES — deep tinted glass + bright text ======
rep(r"\.badge-waiting \{ color: oklch\(0\.98 0\.07 75\); background: oklch\(0\.8 0\.14 75 / 0\.16\); border-color: oklch\(0\.8 0\.14 75 / 0\.4\); \}",
    ".badge-waiting { color: oklch(0.99 0.04 75); background: linear-gradient(160deg, oklch(0.44 0.11 75 / 0.92) 0%, oklch(0.36 0.1 75 / 0.94) 100%); border-color: oklch(0.8 0.14 75 / 0.5); box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.28); }", label="badge-waiting deep amber glass")
rep(r"\.badge-current \{ color: oklch\(0\.96 0\.08 190\); background: oklch\(0\.74 0\.11 190 / 0\.18\); border-color: oklch\(0\.74 0\.11 190 / 0\.42\); \}",
    ".badge-current { color: oklch(0.99 0.03 190); background: linear-gradient(160deg, oklch(0.42 0.1 190 / 0.92) 0%, oklch(0.34 0.09 190 / 0.94) 100%); border-color: oklch(0.74 0.11 190 / 0.5); box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.28); }", label="badge-current deep teal glass")
rep(r"\.badge-done \{ color: oklch\(0\.96 0\.1 165\); background: oklch\(0\.72 0\.15 160 / 0\.16\); border-color: oklch\(0\.72 0\.15 160 / 0\.4\); \}",
    ".badge-done { color: oklch(0.99 0.04 165); background: linear-gradient(160deg, oklch(0.4 0.11 165 / 0.92) 0%, oklch(0.33 0.1 165 / 0.94) 100%); border-color: oklch(0.72 0.15 160 / 0.5); box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.28); }", label="badge-done deep emerald glass")

# emergency tag + recon badge + draft/processing pills -> deep tint glass
rep(r"\.emergency-tag \{\n  display: inline-flex; align-items: center; gap: 4px;\n  color: oklch\(0\.97 0\.04 22\);\n  background: oklch\(0\.62 0\.2 22 / 0\.2\);\n  border: 1px solid oklch\(0\.85 0\.09 22 / 0\.4\);",
    ".emergency-tag {\n  display: inline-flex; align-items: center; gap: 4px;\n  color: oklch(0.99 0.02 22);\n  background: linear-gradient(160deg, oklch(0.4 0.14 22 / 0.92) 0%, oklch(0.32 0.13 22 / 0.94) 100%);\n  border: 1px solid oklch(0.85 0.09 22 / 0.5);", label="emergency-tag deep rose glass")
rep(r"  background: oklch\(0\.62 0\.2 22 / 0\.18\);\n  border: 1px solid oklch\(0\.85 0\.09 22 / 0\.45\);\n  color: oklch\(0\.94 0\.13 22\);\n  font-size: 12\.5px;\n  font-weight: 800;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n\}",
    "  color: oklch(0.99 0.02 22);\n  background: linear-gradient(160deg, oklch(0.4 0.14 22 / 0.92) 0%, oklch(0.32 0.13 22 / 0.94) 100%);\n  border: 1px solid oklch(0.85 0.09 22 / 0.5);\n  font-size: 12.5px;\n  font-weight: 700;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  box-shadow: inset 0 1px 1px 0 oklch(1 0 0 / 0.28);\n}", label="recon-badge deep rose glass")
rep(r"\.recon-badge\.exact \{\n  color: oklch\(0\.96 0\.1 165\);\n  background: oklch\(0\.72 0\.15 160 / 0\.18\);\n  border-color: oklch\(0\.72 0\.15 160 / 0\.45\);\n\}",
    ".recon-badge.exact {\n  color: oklch(0.99 0.04 165);\n  background: linear-gradient(160deg, oklch(0.4 0.11 165 / 0.92) 0%, oklch(0.33 0.1 165 / 0.94) 100%);\n  border-color: oklch(0.72 0.15 160 / 0.5);\n}", label="recon-badge.exact deep emerald")
rep(r"\.draft-badge \{\n  display: inline-flex; align-items: center; gap: 6px;\n  color: oklch\(0\.94 0\.1 280\);\n  background: oklch\(0\.68 0\.13 280 / 0\.24\);\n  border: 1px solid oklch\(0\.68 0\.13 280 / 0\.45\);",
    ".draft-badge {\n  display: inline-flex; align-items: center; gap: 6px;\n  color: oklch(0.99 0.02 280);\n  background: linear-gradient(160deg, oklch(0.42 0.12 280 / 0.9) 0%, oklch(0.34 0.11 280 / 0.92) 100%);\n  border: 1px solid oklch(0.68 0.13 280 / 0.5);", label="draft-badge deep lavender glass")
rep(r"\.processing-pill \{\n  display: flex; align-items: center; gap: 8px;\n  color: oklch\(0\.94 0\.1 280\);\n  background: oklch\(0\.68 0\.13 280 / 0\.24\);\n  border: 1px solid oklch\(0\.68 0\.13 280 / 0\.45\);",
    ".processing-pill {\n  display: flex; align-items: center; gap: 8px;\n  color: oklch(0.99 0.02 280);\n  background: linear-gradient(160deg, oklch(0.42 0.12 280 / 0.9) 0%, oklch(0.34 0.11 280 / 0.92) 100%);\n  border: 1px solid oklch(0.68 0.13 280 / 0.5);", label="processing-pill deep lavender")

# login-error box: darker rose glass + bright text
rep(r"\.login-error \{\n  display: flex; align-items: center; gap: 11px;\n  background: oklch\(0\.62 0\.2 22 / 0\.16\);\n  border: 1px solid oklch\(0\.85 0\.09 22 / 0\.45\);\n  color: oklch\(0\.94 0\.13 22\);",
    ".login-error {\n  display: flex; align-items: center; gap: 11px;\n  background: linear-gradient(160deg, oklch(0.4 0.14 22 / 0.55) 0%, oklch(0.3 0.12 22 / 0.6) 100%);\n  border: 1px solid oklch(0.85 0.09 22 / 0.45);\n  color: oklch(0.98 0.04 22);", label="login-error deep rose glass")

# critical-alert: darken tint so title passes
rep(r"\.critical-alert \{\n  display: flex; align-items: flex-start; gap: 13px;\n  color: oklch\(0\.96 0\.05 22\);\n  background: oklch\(0\.62 0\.2 22 / 0\.14\);\n  border: 1px solid oklch\(0\.85 0\.09 22 / 0\.4\);",
    ".critical-alert {\n  display: flex; align-items: flex-start; gap: 13px;\n  color: oklch(0.97 0.04 22);\n  background: linear-gradient(160deg, oklch(0.45 0.15 22 / 0.4) 0%, oklch(0.32 0.13 22 / 0.5) 100%);\n  border: 1px solid oklch(0.85 0.09 22 / 0.4);", label="critical-alert darker rose glass")
rep(r"\.critical-alert h3 \{ margin: 0; font-size: 15\.5px; color: oklch\(0\.97 0\.04 22\); \}",
    ".critical-alert h3 { margin: 0; font-size: 15.5px; color: oklch(0.99 0.02 22); }", label="critical-alert title bright")

# due/danger text usages (inline on glass)
rep(r"\.due-text \{ color: oklch\(0\.94 0\.13 22\); font-weight: 800; \}",
    ".due-text { color: oklch(0.95 0.14 22); font-weight: 700; }", label="due-text brightened")
rep(r"\.danger-text \{ color: oklch\(0\.94 0\.13 22\); font-weight: 800; \}",
    ".danger-text { color: oklch(0.95 0.14 22); font-weight: 700; }", label="danger-text brightened")

# ================= 7. TYPOGRAPHY ============================================
# font-weight 800 -> 700 (IBM Plex Sans Arabic tops out at 700; 800 = faux bold)
rep(r"font-weight: 800;", "font-weight: 700;", label="font-weight 800 -> 700 (real weight)")
# negative tracking breaks Arabic letter joining
rep(r"letter-spacing: -0\.01em;", "letter-spacing: 0;", label="letter-spacing 0 (Arabic joining)")
# H2 normalization: card headers 18 -> 19 (matches modal h2)
rep(r"\.card-header h2, \.card-header h3 \{ margin: 0 0 4px; font-size: 18px; font-weight: 700; color: var\(--text-strong\); \}",
    ".card-header h2, .card-header h3 { margin: 0 0 4px; font-size: 19px; font-weight: 700; color: var(--text-strong); line-height: 1.45; }", label="card-header h2/h3 -> 19px + lh")
# tiny text floors (>= 12px)
rep(r"\.message small \{ color: oklch\(1 0 0 / 0\.75\); font-size: 11\.5px; display: block; margin-top: 4px; \}",
    ".message small { color: oklch(1 0 0 / 0.75); font-size: 12px; display: block; margin-top: 4px; }", label="message small 11.5->12")
rep(r"\.receipt-footnote \{ color: oklch\(1 0 0 / 0\.75\); font-size: 11\.5px; text-align: center; margin: 16px 24px 0; \}",
    ".receipt-footnote { color: oklch(1 0 0 / 0.75); font-size: 12.5px; text-align: center; margin: 16px 24px 0; }", label="receipt-footnote 11.5->12.5")
# queue-row line-height for patient cells
rep(r"\.queue-row \{\n  min-height: 66px;\n  padding: 9px 14px;\n  border-bottom: 1px solid oklch\(1 0 0 / 0\.1\);\n  font-size: 14px;",
    ".queue-row {\n  min-height: 66px;\n  padding: 9px 14px;\n  border-bottom: 1px solid oklch(1 0 0 / 0.1);\n  font-size: 14px;\n  line-height: 1.65;", label="queue-row line-height 1.65")

# ================= 8. TOUCH TARGETS + MOBILE ================================
rep(r"\.tabs button \{\n  border: 1px solid transparent;\n  background: transparent;\n  padding: 9px 16px;",
    ".tabs button {\n  border: 1px solid transparent;\n  background: transparent;\n  padding: 10px 16px;", label="tabs touch 10px")
rep(r"  font-size: 12\.5px;\n  white-space: nowrap;\n  min-height: 38px;\n\}\n\.template-row button:hover",
    "  font-size: 12.5px;\n  white-space: nowrap;\n  min-height: 40px;\n}\n.template-row button:hover", label="template buttons 40px")
rep(r"  font-size: 12\.5px;\n  font-weight: 700;\n  cursor: pointer;\n  min-height: 36px;\n\}\n\.data-row \.row-action:hover",
    "  font-size: 12.5px;\n  font-weight: 700;\n  cursor: pointer;\n  min-height: 40px;\n}\n.data-row .row-action:hover", label="data-row action 40px")
rep(r"\.move-controls button \{\n  border: 0; background: transparent;\n  color: oklch\(1 0 0 / 0\.75\);\n  font-size: 15px; line-height: 13px;\n  padding: 2px 4px;\n  cursor: pointer;\n\}",
    ".move-controls button {\n  border: 0; background: transparent;\n  color: oklch(1 0 0 / 0.82);\n  font-size: 15px; line-height: 18px;\n  padding: 3px 8px;\n  min-height: 22px;\n  min-width: 28px;\n  cursor: pointer;\n}", label="move-controls bigger touch")
rep(r"\.close-chat \{\n  position: absolute; top: 10px; left: 12px;\n  border: 0; background: transparent;\n  color: oklch\(1 0 0 / 0\.8\);\n  z-index: 2;\n  font-size: 20px;\n  cursor: pointer;\n  width: 32px; height: 32px;\n  border-radius: 8px;\n\}",
    ".close-chat {\n  position: absolute; top: 10px; left: 12px;\n  border: 0; background: transparent;\n  color: oklch(1 0 0 / 0.85);\n  z-index: 2;\n  font-size: 18px;\n  cursor: pointer;\n  width: 36px; height: 36px;\n  border-radius: 10px;\n}", label="close-chat 36px touch")
# modal: dvh for mobile browser chrome
rep(r"\.modal \{\n  width: min\(620px, 95vw\);\n  max-height: 92vh;",
    ".modal {\n  width: min(620px, 95vw);\n  max-height: 92vh;\n  max-height: 92dvh;", label="modal dvh")
# chat heights dvh
rep(r"\.chat-page \{ max-width: 860px; margin: auto; height: min\(680px, 78vh\); padding: 22px; \}",
    ".chat-page { max-width: 860px; margin: auto; height: min(680px, 78vh); height: min(680px, 78dvh); padding: 22px; }", label="chat-page dvh")

# ================= REPORT ===================================================
open(CSS, "w", encoding="utf-8").write(src)
print(f"APPLIED {len(changes)} transformations:")
for c in changes:
    print("  *", c)

# residual audit: any remaining >14px blur?
leftovers = re.findall(r"blur\((\d+)px\)", src)
big = [int(v) for v in leftovers if int(v) > 14]
print(f"\nRemaining blur values > 14px: {big if big else 'NONE'}")
# residual low-alpha text
low = re.findall(r"color: oklch\(1 0 0 / 0\.(6[0-9]|[0-5]\d)\)", src)
print(f"Remaining alpha-white text < 0.70: {low if low else 'NONE'}")
