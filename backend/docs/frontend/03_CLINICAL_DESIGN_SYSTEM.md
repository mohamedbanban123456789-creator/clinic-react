# Clinical Design System & UI/UX Specification — Psychiatric Practice Management System & Clinical AI Assistant

> **Document:** `docs/frontend/03_CLINICAL_DESIGN_SYSTEM.md`
> **Phase:** Frontend Engineering Initiative — **Step 3: Clinical Design System & UI/UX Specification**
> **Status:** NORMATIVE FOR STEP 4+ (all component implementation MUST conform; deviations require a design-system amendment)
> **Predecessors (approved, binding):**
> | # | Artifact | Authority for this playbook |
> |---|----------|------------------------------|
> | 1 | `docs/frontend/01_DOMAIN_FEATURE_SYNTHESIS.md` — APPROVED | Personas (Secretary Desk vs Doctor Cockpit), 43-feature census (S-01…S-18, D-01…D-13, F-01…F-10, X-01/X-02), visit spine, ZK-1…ZK-7, P-01…P-12, C-01…C-24, GAP-01…GAP-11, INV-1…INV-10 |
> | 2 | `docs/frontend/02_FRONTEND_ARCH_SPEC.md` — NORMATIVE | Zoneless-ready Angular 19/20 LTS, standalone + OnPush + `input()` signals, signal-first stores, two facades (`OpsApi` root / `ClinicalApi` cockpit-scoped), 5-interceptor chain, `SocketService` + version gate, route tree (`/front-desk/*`, `/cockpit/*`), CSS logical-properties mandate (§6.2), token contract (`styles/themes.css`), FT-1…FT-8 gates |
> **Operating constraint:** NO application source code (`.ts`/`.html`/`.scss`) in app directories was produced in this step. NO scaffolding (`ng new`) was executed. This document is specification only. Tailwind class strings and CSS variable blocks below are **design contracts, not implementation** — Step 4 implementers MUST realize them file-for-file.
> **Mirror:** this file is mirrored verbatim to `D:\Clinic-front\docs\frontend\03_CLINICAL_DESIGN_SYSTEM.md` (frontend working repo) and `D:\Clinic\docs\frontend\03_CLINICAL_DESIGN_SYSTEM.md` (record of authority). Any divergence resolves in favor of `D:\Clinic`.
> **Conformance language:** MUST / MUST NOT = blocking; SHOULD = strong default with recorded justification; MAY = permitted option.

---

## Table of Contents

- [0. Clinical Design Philosophy & Ergonomic Division](#0-clinical-design-philosophy--ergonomic-division)
- [1. Color Palette & Semantic Tokens (Light & Dark Modes)](#1-color-palette--semantic-tokens-light--dark-modes)
- [2. Typography Hierarchy & Micro-Layouts](#2-typography-hierarchy--micro-layouts)
- [3. Component Anatomy & Micro-Interactions](#3-component-anatomy--micro-interactions)
- [4. Notification & Error Toast System](#4-notification--error-toast-system)
- [5. Keyboard Navigation & Clinical Velocity](#5-keyboard-navigation--clinical-velocity)
- [Appendix A — Canonical CSS Token Contract (`styles/themes.css`)](#appendix-a--canonical-css-token-contract-stylestthemescss)
- [Appendix B — Logical-Property Compliance Contract](#appendix-b--logical-property-compliance-contract)
- [Appendix C — Motion, Elevation, Radius & Iconography](#appendix-c--motion-elevation-radius--iconography)
- [Appendix D — Traceability (Step-1 Features → Design Tokens/Components)](#appendix-d--traceability-step-1-features--design-tokenscomponents)
- [Appendix E — Step-4 Entry Criteria](#appendix-e--step-4-entry-criteria)

---

## 0. Clinical Design Philosophy & Ergonomic Division

### 0.1 Aesthetic baseline: distraction-free modern clinical luxury

The system is a **high-density diagnostic instrument**, not a marketing site. Visual language takes its baseline from Linear (density + command velocity), Osmind (calm psychiatric charting), and modern diagnostic consoles (tabular numerals, status-at-a-glance, zero ornament):

1. **Zero visual friction.** No gradients-as-decoration, no illustration walls, no brand noise inside clinical surfaces. One accent hue per cockpit (calm blue desk-side, indigo/violet doctor-side); everything else is neutral slate with status hues reserved for meaning.
2. **Clinical endurance.** Both personas work 8–12 h shifts. Contrast is engineered for sustained reading (ink on raised surfaces ≥ 7:1 body, ≥ 4.5:1 secondary), dark mode is a first-class clinical mode (night consults, low-light charting), and motion is reduced to ≤ 200 ms state confirmations — never ambient animation.
3. **Density with breathing room.** Front Desk density = 32–40 px rows, 12 px base type; Doctor Cockpit density = comfortable 20–24 px line boxes for long-form SOAP, 16–18 px measure-capped prose columns (60–72 ch). Density is a per-cockpit token, not a global zoom.
4. **Deterministic state rendering (P-07).** Every machine state (queue, scribe, shift, invoice, follow-up) has exactly one visual treatment defined in §3. Illegal transitions are rendered as **disabled controls with reason tooltips**, never hidden-then-500s.

### 0.2 Ergonomic division (normative)

| Dimension | **Front Desk** (Secretary terminal) | **Doctor Cockpit** (clinical + supervisory terminal) |
|---|---|---|
| Prime directive | **Velocity + scanning readability.** Sub-second check-in, drag-and-drop queue, POS-grade cashier modals | **Ambient calming focus.** Hands-free audio, one-thumb MSE chips, long-form SOAP without fatigue |
| Layout posture | High-density lanes, sticky board header, persistent dock, large touch targets (≥ 40 px) on money actions | Centered calm column (`max-w-[72ch]`), soft indigo wash on consult room only, restrained chrome |
| Typography | Tabular numerals everywhere (wait counters, currency); uppercase micro-labels for lanes | Comfortable serif-free prose (1.65–1.75 line-height on SOAP/vault), generous paragraph spacing |
| Color emphasis | Operational Sky/Cerulean for queue; Emerald/Amber/Crimson reserved strictly for money/safety meaning | Indigo/Violet wash denotes doctor authority + AI assistance; never used desk-side except directive receipts |
| Alert posture | **Prominent crisis banners** (crimson, top-docked, persistent until acknowledged); debt badges inline on every identity row | Discrepancy alerts non-blocking (supervision channel); scribe consent/withdraw locks are full-surface states, not toasts |
| Interaction cost | One-click billing, quick-amount chips, dual-tap destructive confirms, full keyboard path (Alt+N/E) | One-click atomic commit (scribe→encounter), chip-first MSE (no typing), waveform-first audio (no file dialogs) |
| Privacy | No clinical content ever rendered (ZK-1…ZK-7); privacy-blur N/A desk-side | One-click privacy blur, auto-lock, clinical-free titles/toasts/prints (C-14, ZK-7) |
| Sound | Silent intercom (badge + subtle pulse, no autoplay) | Optional soft tick on call-next confirm only; recording state MUST have visible + textual indicator (never color-only) |

### 0.3 Non-negotiable design invariants

- **DS-01 Logical-only layout.** §Appendix B is blocking: every layout token and every component anatomy in §3 specifies logical properties ONLY (`ps/pe/ms/me/start/end/text-start/text-end`, `border-s/e`, `rounded-s/e`, `inset-inline-start/end`, `padding-inline-*`, `margin-inline-*`). Physical direction utilities are banned and CI-failing.
- **DS-02 Token-only color.** No hex literals outside `styles/themes.css`. Every surface references a semantic variable. Direct Tailwind palette utilities for color (`bg-red-500`, `text-emerald-600`) are FORBIDDEN; status meaning travels via semantic tokens (`--alert-emergency`, `--status-ok`).
- **DS-03 Operational-only chrome (ZK-7).** Titles, toasts, palette entries, notification previews MUST NEVER contain SOAP text, diagnoses, drug names, vault excerpts, or MSE values. Copy tables in §4 are allowlisted templates.
- **DS-04 Blindness-by-absence (P-04/C-12).** Close/summary surfaces have NO expected-value field at any specificity — type-level absence, not `hidden` or `blur`. Design comps showing a "projected drawer" anywhere pre-reveal are DEFECTIVE comps.
- **DS-05 Explicitness over absence (P-06/C-10).** Missing ≠ `NOT_PERFORMED` ≠ empty string. Every required-justification control distinguishes the three states visually (empty = amber ring + helper; `NOT_PERFORMED` = filled neutral chip; value = filled semantic chip).
- **DS-06 Reduced-motion respect.** All §3 micro-interactions honor `prefers-reduced-motion: reduce` (pulse → static badge; reveal animation → instant swap; waveform → static level bar).

---

## 1. Color Palette & Semantic Tokens (Light & Dark Modes)

### 1.1 Token architecture (extends Step-2 §6.1.2, does not fork it)

Step-2 `themes.css` defined the skeleton (`--surface-base/raised/overlay`, `--ink-*`, `--line-*`, `--accent-calm`, `--status-*`, `--alert-*`, `--focus-ring`). This playbook **extends that skeleton to the full production scale** below. Step 4 MUST write Appendix A verbatim; variable names here are normative.

Naming convention: `--<family>-<role>[-<step>]` where family ∈ `surface | ink | line | brand | cockpit | ops | status | alert | scribe | vault | intercom | focus`. Steps follow a 50–950 scale (50 lightest → 950 darkest) for hue families; neutrals use role names (canvas/surface/card/border/elevated/overlay).

All values ship as **Hex (authoritative for implementation) + HSL (authoritative for tonal reasoning)**. Tailwind theme extension maps utilities to variables (e.g., `bg-canvas → var(--surface-canvas)`); raw hex utilities remain banned outside `themes.css`.

### 1.2 Neutral / Base — Slate-Zinc foundation

Calm blue-slate (low chroma, cool-neutral). Zinc admixture keeps borders from going blue-purple under fluorescent desk light.

#### Light mode — Neutrals

| Token | Hex | HSL | Role / usage | Pairs with (contrast) |
|---|---|---|---|---|
| `--surface-canvas` | `#F4F6F9` | `hsl(214 28% 96%)` | App canvas behind everything (both cockpits) | `ink-primary` 14.2:1 |
| `--surface-base` | `#F7F8FA` | `hsl(220 20% 97%)` | Step-2 compat alias of canvas; page gutters | `ink-primary` 14.6:1 |
| `--surface-surface` | `#FFFFFF` | `hsl(0 0% 100%)` | Default card/row face (queue rows, ledger lines) | `ink-primary` 15.9:1 |
| `--surface-raised` | `#FFFFFF` | `hsl(0 0% 100%)` | Step-2 compat; raised panels, dialog faces | `ink-primary` 15.9:1 |
| `--surface-card` | `#FFFFFF` | `hsl(0 0% 100%)` | Cards requiring 1 px `line-subtle` ring + `shadow-card` | `ink-primary` 15.9:1 |
| `--surface-sunken` | `#EDF0F5` | `hsl(216 24% 94%)` | Sunken wells: search input, amount display, waveform track | `ink-primary` 12.1:1 |
| `--surface-elevated` | `#FFFFFF` | `hsl(0 0% 100%)` | Popovers, palette, dock drawer (with `shadow-elevated`) | `ink-primary` 15.9:1 |
| `--surface-overlay` | `#FFFFFF` | `hsl(0 0% 100%)` | Step-2 compat; modal faces over scrim | `ink-primary` 15.9:1 |
| `--surface-scrim` | `rgba(16 24 40 / 0.48)` | `hsl(220 43% 11% / 48%)` | Modal/drawer scrim (both modes) | N/A (dim layer) |
| `--ink-primary` | `#16202F` | `hsl(213 37% 14%)` | Body copy, amounts, patient names | on `surface` 15.9:1 ✅ AAA |
| `--ink-secondary` | `#55677E` | `hsl(212 19% 41%)` | Secondary labels, timestamps, helper text | on `surface` 5.9:1 ✅ AA |
| `--ink-faint` | `#8595AB` | `hsl(213 17% 60%)` | Placeholders, column headers, disabled labels | on `surface` 3.4:1 (decorative/large only — MUST NOT carry body meaning) |
| `--ink-inverse` | `#FFFFFF` | `hsl(0 0% 100%)` | Text on filled brand/crisis chips | on `brand-700` 8.1:1 ✅ AAA |
| `--line-subtle` | `#E2E8F1` | `hsl(214 28% 91%)` | Card rings, row dividers, table rules | N/A (non-text) |
| `--line-strong` | `#C4CFDE` | `hsl(213 24% 79%)` | Input borders, drag outlines, focus-adjacent rings | N/A (3:1 vs surface ✅ UI-component AA) |
| `--line-focus` | `#2F6FED` | `hsl(221 83% 56%)` | See `--focus-ring` | 4.6:1 vs white ✅ |

#### Dark mode — Neutrals (luminance-inverted, hue-held)

| Token | Hex | HSL | Role / usage | Pairs with (contrast) |
|---|---|---|---|---|
| `--surface-canvas` | `#0F141D` | `hsl(214 32% 9%)` | App canvas | `ink-primary` 14.8:1 |
| `--surface-base` | `#11161F` | `hsl(215 32% 10%)` | Step-2 compat alias | `ink-primary` 14.4:1 |
| `--surface-surface` | `#1A2230` | `hsl(214 30% 15%)` | Row/card face | `ink-primary` 12.6:1 |
| `--surface-raised` | `#1A2230` | `hsl(214 30% 15%)` | Raised panels | `ink-primary` 12.6:1 |
| `--surface-card` | `#1E2736` | `hsl(214 29% 17%)` | Cards (with `line-subtle` ring) | `ink-primary` 11.9:1 |
| `--surface-sunken` | `#0C1119` | `hsl(216 33% 8%)` | Sunken wells (inputs, waveform track) | `ink-primary` 15.4:1 |
| `--surface-elevated` | `#232E42` | `hsl(215 32% 20%)` | Popovers/dock | `ink-primary` 10.8:1 |
| `--surface-overlay` | `#232E42` | `hsl(215 32% 20%)` | Modal faces | `ink-primary` 10.8:1 |
| `--surface-scrim` | `rgba(2 6 14 / 0.66)` | `hsl(220 75% 3% / 66%)` | Scrim (darker in dark mode) | N/A |
| `--ink-primary` | `#EAF0F8` | `hsl(213 44% 94%)` | Body copy | on `surface` 12.6:1 ✅ AAA |
| `--ink-secondary` | `#B3BED2` | `hsl(216 24% 76%)` | Secondary | on `surface` 7.8:1 ✅ AAA |
| `--ink-faint` | `#7E8CA3` | `hsl(215 17% 57%)` | Placeholders/headers | on `surface` 4.1:1 (secondary-minimum; never body) |
| `--ink-inverse` | `#0B1220` | `hsl(217 47% 8%)` | Text on light filled chips in dark mode | on `--alert-ok-bg` etc. ≥ 7:1 |
| `--line-subtle` | `#2A3549` | `hsl(215 27% 23%)` | Rings/dividers | 3:1+ vs surface ✅ |
| `--line-strong` | `#3D4C66` | `hsl(216 25% 32%)` | Input borders | 3:1+ vs surface ✅ |
| `--line-focus` | `#5B93FF` | `hsl(220 100% 68%)` | Focus ring (dark) | 4.1:1 vs raised ✅ |

> **SPEC-DS-1.2:** Dark surfaces hold hue (214–216°) and gain ~6–10 pts luminance separation between adjacent layers (canvas → surface → card → elevated). Borders in dark mode are LIGHTER than faces (inverted from light mode) so cards read by ring, not shadow.

### 1.3 Brand / Primary — Medical Slate / Calming Deep Slate

Reserved for **primary actions, wayfinding, and focus**. The ONLY hue permitted on desk-side primary buttons. Calm, institutional, non-urgent.

| Step | Light Hex | Light HSL | Dark Hex | Dark HSL | Usage |
|---|---|---|---|---|---|
| `brand-50` | `#EEF4FE` | `hsl(221 86% 95%)` | `#131E33` | `hsl(221 46% 14%)` | Tinted wash (selected row, info banner bg) |
| `brand-100` | `#DCE7FD` | `hsl(221 88% 92%)` | `#1A2A4A` | `hsl(221 47% 20%)` | Hover wash, chip bg |
| `brand-200` | `#B9CFFB` | `hsl(221 90% 86%)` | `#24406E` | `hsl(221 50% 29%)` | Active wash, range accents |
| `brand-500` | `#2F6FED` | `hsl(221 83% 56%)` | `#5B93FF` | `hsl(220 100% 68%)` | Focus ring, links, live-dot |
| `brand-600` | `#245BDB` | `hsl(223 72% 50%)` | `#7AA8FF` | `hsl(220 100% 74%)` | Hover on filled buttons |
| `brand-700` | `#1D4BB8` | `hsl(223 73% 42%)` | `#A4C2FF` | `hsl(221 100% 82%)` | Filled primary bg (light) / primary ink (dark) |
| `--brand-ink` | `#FFFFFF` | `hsl(0 0% 100%)` | `#0B1220` | `hsl(217 47% 8%)` | Text on filled primary |

Pairs: light `brand-700` on white **8.1:1** ✅ AAA (button text uses `brand-ink` on `brand-700` = 8.1:1); dark `brand-500 #5B93FF` on `#1A2230` = **5.2:1** ✅ AA; focus ring `brand-500` vs adjacent surface ≥ 3:1 ✅ (UI-component criterion).

**Button recipe (desk primary):** `bg-[var(--brand-700)] text-[var(--brand-ink)] hover:bg-[var(--brand-600)] focus-visible:ring-2 ring-[var(--focus-ring)] rounded-lg`. Dark mode swaps the two variables — markup unchanged (token-driven).

### 1.4 Clinical Cockpit & AI Scribe — Indigo / Violet spectrum

Denotes **doctor authority + AI assistance**. MUST NEVER appear desk-side except inside directive effect receipts (`DOCTOR_COMPLIMENTARY` zeroed-invoice chip, `DOCTOR_NEXT` version chip). Cockpit surfaces use indigo for doctor chrome, violet strictly for AI-generated content (suggestions, draft badges, diff highlights).

| Token | Light Hex | Light HSL | Dark Hex | Dark HSL | Usage + contrast |
|---|---|---|---|---|---|
| `--cockpit-wash` | `#EDEFfE` → canonical `#EEF0FE` | `hsl(237 86% 94%)` | `#1B1E3A` | `hsl(237 37% 17%)` | Consult-room ambient wash (page-level, cockpit only) |
| `--cockpit-ink` | `#2E33B8` | `hsl(239 60% 45%)` | `#B9BEFF` | `hsl(238 100% 86%)` | Doctor-authority labels, cockpit nav active (on wash 7.2:1 / 9.1:1 ✅) |
| `--cockpit-line` | `#C9CDF8` | `hsl(236 74% 88%)` | `#3A3F6B` | `hsl(237 29% 32%)` | Cockpit card rings, scribe panel dividers |
| `--scribe-ai` | `#6D28D9` | `hsl(262 83% 50%)` | `#A78BFA` | `hsl(250 95% 76%)` | AI badges, suggestion cards, draft-source chip (on white 7.5:1 ✅; dark on raised 6.4:1 ✅) |
| `--scribe-ai-bg` | `#F1EAFE` | `hsl(264 89% 95%)` | `#2A2145` | `hsl(254 36% 20%)` | AI suggestion card bg, diff-add bg tint |
| `--scribe-diff-add` | `#DEF7EC` tint w/ indigo ring | — | `#12362B` | — | Added-text highlight (bg + `border-s-2` AI ring) |
| `--scribe-diff-del` | `#FDE8E8` tint + strikethrough | — | `#3A1E24` | — | Removed-text highlight (never red-text-only; always + strikethrough + label) |

> **SPEC-DS-1.4:** Violet is AI-only. Human-authored clinical content (manual SOAP, addenda, vault) MUST NEVER use violet. AI text MUST carry the `AI` glyph + `scribe-ai` chip so provenance survives screenshots/prints.

### 1.5 Operational & Queue — Sky / Cerulean

Queue, wait times, intercom operational notices, shift-day chrome. Calm-informative; carries NO money meaning.

| Token | Light Hex | Light HSL | Dark Hex | Dark HSL | Usage + contrast |
|---|---|---|---|---|---|
| `--ops-info` | `#0369A1` | `hsl(201 96% 32%)` | `#7DD3FC` | `hsl(199 95% 74%)` | Queue position numerals, wait-time ink, intercom info (on white 6.9:1 ✅; dark on raised 8.2:1 ✅) |
| `--ops-info-bg` | `#E0F2FE` | `hsl(199 95% 92%)` | `#0C2A3D` | `hsl(201 66% 15%)` | Position badge bg, wait-chip bg, `queue.called` flash wash |
| `--ops-live` | `#0284C7` | `hsl(201 90% 40%)` | `#38BDF8` | `hsl(199 92% 60%)` | LIVE link dot, reconnect pulse |
| `--ops-stale` | `#B45309` (shared w/ warning) | — | `#FBBF24` | — | DEGRADED badge ink (see §1.6) |

### 1.6 Status & Safety — Emerald / Amber / Crimson-Rose

The ONLY hues permitted to carry money/safety meaning. Each ships as **ink + bg + line** triplets so meaning never depends on text color alone (icon + label always accompany).

#### Collected / Checked-in / Balanced — Emerald

| Token | Light Hex / HSL | Dark Hex / HSL | Usage + contrast |
|---|---|---|---|
| `--status-ok` | `#047857` / `hsl(164 94% 24%)` | `#34D399` / `hsl(158 64% 52%)` | Paid/collected numerals, BALANCED result, checked-in dot (light on white 5.4:1 ✅; dark on raised 8.6:1 ✅) |
| `--status-ok-bg` | `#D1FAE5` / `hsl(152 76% 90%)` | `#0B2E24` / `hsl(164 62% 11%)` | Success banner bg, PAID chip bg, BALANCED reveal panel |
| `--status-ok-line` | `#6EE7B7` / `hsl(156 72% 67%)` | `#14532D`-lifted `#1B4D3E` | Chip rings, reveal-panel border |

#### Debt / Unpaid / Warning / Stale — Amber / Ochre

| Token | Light Hex / HSL | Dark Hex / HSL | Usage + contrast |
|---|---|---|---|
| `--alert-debt` (ink) | `#92400E` / `hsl(32 89% 31%)` | `#FBBF24` / `hsl(43 96% 56%)` | Debt numerals, UNPAID/PARTIAL chips, floor-meter warn, DEGRADED banner ink (light 6.2:1 ✅; dark 9.4:1 ✅) |
| `--alert-debt-bg` | `#FEF3C7` / `hsl(48 96% 89%)` | `#33230A` / `hsl(37 67% 12%)` | Debt banner bg, warning toast bg, stale-badge bg |
| `--alert-debt-line` | `#FCD34D` / `hsl(45 97% 65%)` | `#6B4E12` / `hsl(43 71% 25%)` | Warning rings |

#### Psychiatric Emergency / Crisis / Shred Action — Crimson / Rose

Highest salience in the system. Reserved for: emergency queue state, crisis intake chrome, destructive-irreversible actions (reversal, write-off, blind-close confirm, vault shred pending-ratification placeholder, consent withdraw).

| Token | Light Hex / HSL | Dark Hex / HSL | Usage + contrast |
|---|---|---|---|
| `--alert-emergency` | `#B91C1C` / `hsl(0 72% 42%)` | `#FCA5A5` / `hsl(0 93% 77%)` | Emergency badges, crisis banner ink, destructive button bg-ink pair (light on white 5.9:1 ✅; dark on raised 8.8:1 ✅) |
| `--alert-emergency-bg` | `#FEE2E2` / `hsl(0 93% 91%)` | `#3B1215` / `hsl(355 53% 15%)` | Crisis banner bg, emergency row wash, destructive-sheet tint |
| `--alert-emergency-line` | `#FCA5A5` / `hsl(0 93% 77%)` | `#7F1D1D` / `hsl(0 70% 30%)` | Emergency rings, pulse ring |
| `--alert-emergency-solid` | `#C81E1E` / `hsl(0 74% 45%)` | `#EF4444` / `hsl(0 84% 60%)` | Filled destructive button bg (light) with `#FFFFFF` text (5.9:1 ✅) |

> **SPEC-DS-1.6 (salience budget):** Crimson MUST NOT appear for non-critical chrome (no crimson links, icons, illustrations). On any screen, crimson area ≤ 8% of viewport unless the crisis banner is active. Amber ≤ 15%. This keeps emergency meaning emergent, not ambient.

### 1.7 Contrast & accessibility ledger (WCAG 2.1 AA, normative)

Normative pairs (Step 4 MUST hold these; CI contrast sweep asserts them from `themes.css`):

| Pair (text on ground) | Light ratio | Dark ratio | Verdict |
|---|---|---|---|
| `ink-primary` on `surface-surface` | 15.9:1 | 12.6:1 | AAA both |
| `ink-secondary` on `surface-surface` | 5.9:1 | 7.8:1 | AA/AAA ✅ |
| `ink-faint` on `surface-surface` | 3.4:1 | 4.1:1 | Non-body only (placeholders, headers ≥ 14 px bold or decorative) |
| `brand-700` button text (`brand-ink` on `brand-700`) | 8.1:1 | 10.2:1 (inverse) | AAA ✅ |
| Links (`brand-600` light / `brand-500` dark on surface) | 6.4:1 | 5.2:1 | AA ✅ |
| `ops-info` on surface / `ops-info-bg` | 6.9:1 | 8.2:1 | AA ✅ |
| `status-ok` on surface / `ok-bg` | 5.4:1 | 8.6:1 | AA ✅ |
| `alert-debt` on surface / `debt-bg` | 6.2:1 | 9.4:1 | AA ✅ |
| `alert-emergency` on surface / `emergency-bg` | 5.9:1 | 8.8:1 | AA ✅ |
| `scribe-ai` on surface / `ai-bg` | 7.5:1 | 6.4:1 | AA ✅ |
| `cockpit-ink` on `cockpit-wash` | 7.2:1 | 9.1:1 | AAA ✅ |
| Focus ring vs adjacent surface | ≥ 3:1 | ≥ 3:1 | UI-component ✅ |
| Disabled text (`ink-faint` at 60% on surface) | ~2.2:1 | ~2.6:1 | Exempt ONLY when control is `aria-disabled` + tooltip explains why (WCAG disabled exception); disabled MUST never be the sole signal (also icon + copy) |

Rules:

1. **Body text floor:** any text < 18 px regular MUST use `ink-primary` or `ink-secondary` (never `ink-faint`).
2. **Status never color-only:** every status chip pairs hue + icon glyph + text label (e.g., emergency = pulse dot + `EMERGENCY` + reason excerpt).
3. **Focus visible always:** 2 px `focus-ring` outline with 2 px offset on every interactive element; `:focus:not(:focus-visible)` resets for mouse.
4. **Dark-mode parity:** no pair may drop below its light-mode conformance level when switching modes.
5. **Print:** light tokens used for print (receipts); dark print is forbidden (ink waste + contrast inversion).

---

## 2. Typography Hierarchy & Micro-Layouts

### 2.1 Font stacks (normative)

```css
/* CONTRACT — styles/typography.css */
--font-sans: "Inter", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
```

- **Sans (UI + prose):** `Inter` primary (tabular-grade hinting, clinical legibility at 12–14 px); `Plus Jakarta Sans` approved alternate for display headings where the deployment licenses it. Step 4 pins ONE display face (Inter tight-tracked by default; Jakarta opt-in per locale) — mixing both on one screen is forbidden.
- **Mono (numerals only):** all currency (`finalFeeMinor`, `collectedMinor`, `outstandingMinor`, `expectedCashMinor`, `differenceMinor`), queue wait counters (`estimatedWaitMin`), version chips (`v{N}`), and idempotency/outbox keys use `--font-mono` with `font-variant-numeric: tabular-nums lining-nums` so columns never jitter during live updates.
- **Loading:** `font-display: swap`; system-ui fallback MUST preserve metrics (`size-adjust` declared) so WS-driven re-renders don't reflow.
- **Clinical scripts:** Arabic clinical copy (if deployed) uses the same stacks with `dir=rtl`; letter-spacing is zeroed for RTL per §2.3.

### 2.2 Type scale (exact, normative)

Base 16 px root; all sizes in px + rem; tracking in em; all line-heights unitless (zoneless-safe, no sub-pixel CD churn).

| Level | Size / rem | Line-height | Tracking | Weight | Usage | Example Tailwind contract |
|---|---|---|---|---|---|---|
| `Display` | 30 px / 1.875rem | 1.2 (36 px) | −0.02em | 700 | Day-summary headline numerals, blind-reveal result word (`BALANCED`) | `text-[30px] leading-[1.2] tracking-[-0.02em] font-bold` |
| `H1` | 24 px / 1.5rem | 1.3 (31 px) | −0.015em | 700 | Route titles (`Waiting Room`, `Consult Room`, `Day Summary`) | `text-2xl leading-[1.3] tracking-[-0.015em] font-bold text-start` |
| `H2` | 20 px / 1.25rem | 1.35 (27 px) | −0.01em | 650 (600 + optical) | Section headers (chart timeline date groups, supervision blocks) | `text-xl leading-[1.35] font-semibold text-start` |
| `H3` | 16 px / 1rem | 1.45 (23 px) | −0.005em | 600 | Card titles, sheet titles, drawer titles | `text-base leading-[1.45] font-semibold text-start` |
| `Body-L` | 16 px / 1rem | 1.65 (26 px) | 0 | 400 (500 for emphasis) | Doctor SOAP prose, vault reading pane, addendum text | `text-base leading-[1.65] text-start max-w-[72ch]` |
| `Body` | 14 px / 0.875rem | 1.6 (22 px) | 0 | 400 | Default UI copy, ledger memos, intercom messages | `text-sm leading-[1.6] text-start` |
| `Body-S` | 13 px / 0.8125rem | 1.55 (20 px) | 0 | 400 | Queue row sub-lines, receipt meta, form helpers | `text-[13px] leading-[1.55] text-start` |
| `Label` | 12 px / 0.75rem | 1.45 (17 px) | +0.04em uppercase | 600 | Lane headers, field labels, table column headers | `text-xs leading-[1.45] tracking-[0.04em] uppercase text-start` |
| `Mono-Ledger` | 15 px / 0.9375rem | 1.5 (22 px) | 0 | 600 mono | Currency numerals, drawer count display, receipt totals | `font-mono text-[15px] leading-[1.5] tabular-nums text-end` |
| `Mono-Counter` | 13 px / 0.8125rem | 1.4 (18 px) | 0 | 500 mono | Wait-time counters, version chips, shift ids | `font-mono text-[13px] tabular-nums` |
| `Micro-Badge` | 11 px / 0.6875rem | 1.35 (15 px) | +0.06em uppercase | 700 | Status chips, emergency flags, directive pills | `text-[11px] leading-[1.35] tracking-[0.06em] uppercase font-bold` |

> Note: `font-650` is not a Tailwind default — implement as `font-semibold` (600) + `letter-spacing` tightening, or a variable-font `font-weight: 650` utility in `typography.css`. Either is conformant if the rendered spec above holds.

Additional rules:

1. **Numerals:** every `Mono-*` level MUST set `font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;` so live queue/billing updates don't shift columns.
2. **Prose measure:** `Body-L` clinical blocks cap at `max-w-[72ch]` (cockpit) / `max-w-[68ch]` (vault). Desk-side prose caps at full lane width (scanning, not reading).
3. **RTL:** tracking reset to `0` for `[dir="rtl"]` at `Label`/`Micro-Badge` levels (letterspacing breaks Arabic joining); `text-start/text-end` mirror automatically.
4. **Truncation:** patient names truncate `truncate` with `title` tooltip + full name in detail drawer; amounts NEVER truncate (wrap or shrink-chip instead).

### 2.3 Spacing, density & micro-layout tokens

Base unit 4 px. Two density contexts (never mixed on one surface):

| Token | Value | Desk usage | Cockpit usage |
|---|---|---|---|
| `--space-1..12` | 4/8/12/16/20/24/32/40/48/64 px scale | Board rows `py-2` (8 px), lanes `gap-2` | Consult prose `space-y-4`, timeline `gap-6` |
| `--row-desk` | 40 px min row height | Queue rows, ledger lines, follow-up rows | N/A |
| `--row-calm` | 56 px min touch row (money actions) | Checkout quick-amount chips, pay actions | N/A |
| `--radius-sm/md/lg/xl` | 6 / 10 / 14 / 20 px | Chips `rounded-full`, cards `rounded-xl`, sheets `rounded-2xl` (logical `rounded-s/e` where directional) | Same |
| `--shadow-card` | `0 1px 2px rgb(16 24 40 / .06)` | Queue cards, ledger cards | Chart cards |
| `--shadow-elevated` | `0 8px 24px rgb(16 24 40 / .14)` | Dock, palette, popovers | Scribe studio drawer |
| `--shadow-modal` | `0 24px 64px rgb(16 24 40 / .24)` | All modals/sheets | Same |
| `--focus-ring` | `0 0 0 2px canvas, 0 0 0 4px var(--focus-ring)` | Every interactive element | Same |

Layout shells:

- **Desk board shell:** sticky header (`sticky top-0` + `bg-canvas/90 backdrop-blur`), lane grid `grid gap-3`, rows `flex items-center gap-3 ps-3 pe-2 py-2`. Drawer/dock dock to `inset-inline-end` (mirrors in RTL automatically).
- **Cockpit shell:** centered column `mx-auto max-w-[880px] px-4 md:px-6`, ambient wash `bg-[var(--cockpit-wash)]` ONLY on consult route, prose `space-y-4`.
- **Sheet shell:** bottom-sheet on mobile (`rounded-t-2xl`), centered dialog ≥ 640 px (`rounded-2xl max-w-lg`), docked drawer on desktop for intercom/balance (`w-[380px] inset-inline-end-0`).

All shells use logical insets: `inset-inline-start/end`, `ps/pe`, `ms/me`, `text-start/end`, `border-s/e`, `rounded-s/e`. See Appendix B.

---

## 3. Component Anatomy & Micro-Interactions

> Conventions for every component below: **Purpose + trace** (Step-1 feature, Step-2 store/binding) → **Anatomy** (ordered slots, logical Tailwind contract) → **States** (default/hover/focus/active/disabled/loading + machine states) → **Micro-interaction** (timing, motion, reduced-motion) → **Accessibility** → **Guardrails** (ZK/blind/invariant tripwire notes). All class strings are normative patterns — Step 4 realizes them with the project's Tailwind version (v4 engine or pinned v3) without substituting physical properties.

### 3.1 Live Queue Patient Card (`OpsWaitingRoomBoard` row)

**Purpose + trace:** S-04/S-05/S-06/S-07 live board; `QueueStore` snapshot render; `queueVersion` OCC chip; C-01 optimistic ghost; C-20 server wait values only.

**Anatomy (inline-start → inline-end):**

```
[drag handle] [position badge] [identity block] [status chip] [wait counter] [emergency flag] [quick-call]
   24px           40px            flex-1            auto          mono         auto            36px
```

Normative Tailwind skeleton:

```html
<!-- CONTRACT PATTERN — logical properties only -->
<li class="flex items-center gap-3 rounded-xl border border-[var(--line-subtle)]
           bg-[var(--surface-surface)] ps-2 pe-2 py-2
           data-[emergency=true]:border-[var(--alert-emergency-line)]
           data-[emergency=true]:bg-[var(--alert-emergency-bg)]">
  <button aria-label="Reorder" data-drag-handle
    class="cursor-grab touch-none rounded-md p-2 text-[var(--ink-faint)]
           hover:bg-[var(--surface-sunken)] focus-visible:ring-2 active:cursor-grabbing
           disabled:cursor-not-allowed disabled:opacity-40">⋮⋮</button>
  <span data-position
    class="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--ops-info-bg)]
           font-mono text-[13px] font-semibold text-[var(--ops-info)] tabular-nums">03</span>
  <div class="min-w-0 flex-1 text-start">
    <p class="truncate text-sm font-semibold text-[var(--ink-primary)]">Patient Name</p>
    <p class="truncate text-[13px] text-[var(--ink-secondary)]">Checked in 12:04 · <span class="font-mono tabular-nums">≈25 min</span></p>
  </div>
  <span data-status class="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]">Waiting</span>
  <span data-emergency class="rounded-full border border-[var(--alert-emergency-line)]
        bg-[var(--alert-emergency-bg)] px-2 py-0.5 text-[11px] font-bold uppercase
        tracking-[0.06em] text-[var(--alert-emergency)]">Emergency</span>
  <button data-quick-call
    class="rounded-lg bg-[var(--brand-700)] px-3 py-2 text-sm font-semibold text-[var(--brand-ink)]
           hover:bg-[var(--brand-600)] focus-visible:ring-2 active:translate-y-px
           disabled:cursor-not-allowed disabled:opacity-50">Call</button>
</li>
```

Position/status/wait sub-recipes:

- **Position badge:** `bg-[var(--ops-info-bg)] text-[var(--ops-info)]`; head-of-queue (`position 0` + emergency) upgrades to `bg-[var(--alert-emergency-bg)] text-[var(--alert-emergency)]` + pulse dot.
- **Status chips:** `WAITING` = ops-info tint; `IN_CONSULTATION` = cockpit indigo tint (doctor-side meaning, read-only desk-side); `COMPLETED` = neutral; `SKIPPED` = faint + dashed ring. Always icon + text (never color-only).
- **Wait counter:** mono tabular, `≈{estimatedWaitMin} min` from server ONLY; stale (WS DEGRADED) appends `· v{N}` staleness suffix.

**States:**

| State | Visual | Interaction |
|---|---|---|
| Default | Card ring `line-subtle`, 40 px row | Hover: `bg sunken` wash on row; drag handle reveals full opacity |
| Hover | Row `border-[var(--line-strong)]`, handle `ink-secondary` | Drag affordance cursor-grab |
| Focus | 2 px `focus-ring` on focused control (handle, call, flag) | Roving tabindex across rows; arrows move, Enter activates |
| Active/dragging | Ghost `opacity-70 rotate-[0.5deg] shadow-elevated`, drop target `border-s-4 brand` indicator on inline-start edge | Drop dispatches `reorder` with `If-Match` + `expectedQueueVersion` + key; ghost reverts on `409` with snap (no animation masking) |
| Disabled | DnD disabled unless WS LIVE; non-WAITING rows non-draggable; emergency row pinned (drop-below disabled with lock tooltip) | Tooltip: "Queue offline — reconnecting" / "Emergency pinned until unflagged" / "Only waiting entries reorder" |
| Loading | Skeleton shimmer on initial `GET /queue` only; WS updates patch without skeleton | Never skeleton on version-gated patches (avoids flicker) |
| Emergency pulse | 2 px crimson ring + 8 px dot with `animate-ping`-grade pulse (1600 ms, `prefers-reduced-motion` → static) + `EMERGENCY` chip + reason excerpt | Flag/unflag both require reason dialog (S-06); unflag is `EMERGENCY_UNFLAG` audited |

**Micro-interactions:** drop-target indicator slides on inline-start edge (120 ms ease-out); `queue.called` flash washes the called row ops-bg for 1200 ms; wait counters crossfade numerals (150 ms) rather than reflowing layout (fixed `w-[7ch]` mono column). Ghost snap-back on `409` is instant + toast "Queue changed (v{a}→v{b}) — review and retry."

**Accessibility:** listbox semantics (`role=list`, rows `role=listitem`); drag via keyboard (Space lifts, arrows move, Enter drops, Esc cancels); emergency announced via `aria-live=polite`; position exposed as `aria-label="Position 3 of 9"`.

**Guardrails:** no clinical content in card (name/position/wait only); burying emergency (drop below position 0) structurally prevented; client never recomputes order/position/wait (P-09); illegal transitions disabled with reason.

### 3.2 Crisis Intake Alert Banner & Modal (`OpsCrisisIntakeDialog`)

**Purpose + trace:** S-03 crisis fast path; S-06 emergency flag; ZK-5 operational-only text discipline.

**Banner (persistent while any emergency active):**

```html
<!-- CONTRACT PATTERN -->
<div role="alert" data-crisis-banner
  class="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--alert-emergency-line)]
         bg-[var(--alert-emergency-bg)] px-4 py-2.5 text-start">
  <span aria-hidden="true" class="relative flex size-2.5 shrink-0">
    <span class="absolute inline-flex size-full animate-ping rounded-full bg-[var(--alert-emergency-solid)] opacity-60 motion-reduce:animate-none"></span>
    <span class="relative inline-flex size-2.5 rounded-full bg-[var(--alert-emergency-solid)]"></span>
  </span>
  <p class="flex-1 text-sm font-semibold text-[var(--alert-emergency)]">Crisis intake — 1 emergency waiting · position 0 held</p>
  <button class="rounded-lg border border-[var(--alert-emergency-line)] bg-[var(--surface-surface)]
                 px-3 py-1.5 text-sm font-semibold text-[var(--alert-emergency)]
                 hover:bg-[var(--alert-emergency-bg)] focus-visible:ring-2">Review</button>
</div>
```

**Modal (minimalist high-contrast admission for agitated patients):** deliberately SHORT — identifier (search-or-lite-register), emergency anchor ONLY (contact name + phone + relation), one-line operational note (capped, hint-visible), `isEmergency:true` + reason (prefilled "crisis intake", editable, required). NO full identity form, NO fee, NO debt step (deferred to completion). Contrast: white face on dark scrim, 20 px radius, single primary CTA "Admit to position 0" (crimson-solid, white text 5.9:1) + secondary "Cancel".

**States:** default (empty anchor fields, CTA disabled until anchor valid); hover/focus standard rings; active CTA `translate-y-px`; disabled CTA `opacity-50` + "Emergency contact required" helper; loading CTA spinner + "Admitting…" (idempotency key minted at confirm, duplicate taps ignored). Post-admit: banner increments, board row appears at 0 with flash, toast "Crisis entry admitted at position 0 (v{N})".

**Micro-interaction:** modal enters with 160 ms rise + scrim fade (reduced-motion → instant); banner slides from top (180 ms); no auto-dismiss — banner persists until emergency unflagged (reasoned).

**Accessibility:** `role=alertdialog aria-modal`, focus trap, initial focus on patient identifier, Esc cancels (returns focus to invoker), screen-reader announces "Emergency entry, position zero" on admit.

**Guardrails:** free-text note shows ZK-5 hint "Operational only — never type diagnoses, drug names, or findings." + live char cap; no clinical pre-fill; full record completed later via `PATCH /patients/:id` (separate surface).

### 3.3 Blind Cashier Checkout Modal (`OpsBillingCheckoutSheet`)

**Purpose + trace:** S-08/S-09/S-10/S-11 checkout; S-12 pay-down pivot; INV-3/INV-6 floor; P-04/C-12 blindness-by-absence; C-05 idempotency chips; C-11 minor-unit edge.

**Anatomy (top → bottom):**

```
Header: patient + queue context + invoice-shell state chip
Fee block: standard fee (mono, muted) → final fee input (Mono-Ledger, large, text-end) → floor meter
Reason block (armed when final < standard, non-complimentary): textarea + live "requires doctor" breach card
Method block: 3 presets (Cash / Transfer / Wallet → CASH|OTHER) + quick-amount chips (exact fee / exact outstanding / custom)
Collected block: collected input + remaining-to-allocate meter (oldest-first context)
Footer: idempotency chip + OCC/version chip + [Cancel] [Collect •••]
```

Normative skeleton (key slots):

```html
<!-- CONTRACT PATTERN — note text-end ONLY on numerals, text-start elsewhere -->
<section class="rounded-2xl bg-[var(--surface-overlay)] shadow-[var(--shadow-modal)]">
  <header class="flex items-center gap-3 border-b border-[var(--line-subtle)] px-5 py-4 text-start">
    <div class="flex-1">
      <h3 class="text-base font-semibold text-[var(--ink-primary)]">Checkout</h3>
      <p class="text-[13px] text-[var(--ink-secondary)]">Patient · Queue #3 · Invoice shell ready</p>
    </div>
    <span data-version-chip class="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 font-mono text-[13px] tabular-nums">v42</span>
  </header>
  <div class="space-y-4 px-5 py-5">
    <div class="rounded-xl bg-[var(--surface-sunken)] px-4 py-3">
      <p class="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--ink-secondary)] text-start">Amount due</p>
      <p data-amount-display class="font-mono text-[28px] font-bold tabular-nums text-end text-[var(--ink-primary)]">185.00</p>
    </div>
    <div data-floor-meter class="rounded-xl border border-[var(--line-subtle)] px-4 py-3">
      <div class="flex items-center justify-between text-[13px]"><span>Max secretary discount</span><span class="font-mono tabular-nums">30.00</span></div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><div data-floor-fill class="h-full rounded-full bg-[var(--status-ok)]" style="width:40%"></div></div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <button data-preset class="rounded-lg border border-[var(--line-strong)] px-3 py-2.5 text-sm font-semibold hover:border-[var(--brand-500)] focus-visible:ring-2 aria-pressed:bg-[var(--brand-50)]">Cash</button>
      <!-- Transfer / Wallet identical; pressed state uses aria-pressed + brand wash -->
    </div>
  </div>
  <footer class="flex items-center gap-3 border-t border-[var(--line-subtle)] px-5 py-4">
    <span data-idem-chip class="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]">Safe to retry</span>
    <span class="flex-1"></span>
    <button data-cancel class="rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[var(--surface-sunken)]">Cancel</button>
    <button data-collect class="rounded-lg bg-[var(--brand-700)] px-5 py-2.5 text-sm font-semibold text-[var(--brand-ink)] hover:bg-[var(--brand-600)] disabled:opacity-50">Collect 185.00</button>
  </footer>
</section>
```

**Blind-state rule (sibling surface `OpsBlindDrawerCloseDialog`, same modal language):** count-entry phase shows a BARE numeric input (`actualCountedMinor` ONLY) with expected slots structurally absent from the DOM (verified FT-5). Placeholder is `0.00` as input affordance ONLY with `aria-label="Actual counted cash"` and helper "Count the drawer, then enter. Expected stays hidden until you confirm." — the value `---` / masked indicator is used in shift-summary pre-close slots (null rendered as `—`, never `0`).

**Difference reveal animation (post-`200` only):** reveal panel crossfades in (200 ms, reduced-motion → instant swap): `BALANCED` (emerald panel, check glyph), `SURPLUS` (ops-sky panel, +amount), `DEFICIT` (amber panel, −amount). Each shows the triplet `{expectedCashMinor, actualCountedMinor, differenceMinor}` in mono + `result` word in Display type + next-step guidance ("Shift can now close" / "Review petty + reversals" / "Escalate to doctor"). Reveal data comes ONLY from the persisted response — never computed client-side.

**States:** fee-raise free; fee-lower arms reason + floor meter (breach → CTA disabled + "Requires doctor" card + route to complimentary/write-off); empty reason blocks submit (nonBlank, P-06); `403 FLOOR_VIOLATION` maps to same breach card + audit notice; `409 already invoiced` pivots sheet to pay-down mode (preserves amounts, swaps CTA to "Pay down"); `SHIFT_LOCKED` shows "Drawer busy — Retry (same key held)" reusing key.

**Accessibility:** amount display `aria-live=polite` (announces formatted totals, never raw minor integers); floor meter `role=progressbar`; presets `aria-pressed`; destructive-adjacent confirms (write-off path) dual-tap.

**Guardrails:** append-only (no "edit invoice"); discount fixed at creation; preset labels UI/print-only (wire `CASH|OTHER`); outbox PENDING chip ("Safe to retry" vs "Fresh intent needed" on `REUSE`).

### 3.4 Mental Status Examination (MSE) Selector Matrix (`DoctorMseChipPanel`)

**Purpose + trace:** D-04 rapid MSE; D-05/D-07 feed; C-10 explicitness machine; `422 MSE_REQUIRED` per-selector mapping; FT-4 guard.

**Anatomy:** four single-select chip rows — Appearance / Behavior / Speech Coherence / Mood & Affect — each required, each including a prominent distinct `NOT_PERFORMED` chip. Row header = `Label` + required asterisk + state icon (empty = hollow circle amber; satisfied = check emerald).

```html
<!-- CONTRACT PATTERN — one row shown; all four identical structure -->
<fieldset data-mse-row="appearance" class="rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-3">
  <legend class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-start text-[var(--ink-secondary)]">
    Appearance <span aria-hidden="true" class="text-[var(--alert-emergency)]">*</span>
    <span data-row-state class="rounded-full px-1.5 py-px text-[11px] font-bold uppercase tracking-[0.06em]">Missing</span>
  </legend>
  <div class="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Appearance">
    <button role="radio" aria-checked="false" data-chip
      class="rounded-full border border-[var(--line-strong)] bg-[var(--surface-surface)] px-3.5 py-2 text-sm font-medium text-[var(--ink-primary)]
             hover:border-[var(--cockpit-ink)] hover:bg-[var(--cockpit-wash)] focus-visible:ring-2
             aria-checked:bg-[var(--cockpit-ink)] aria-checked:text-white aria-checked:border-transparent">Well-groomed</button>
    <!-- … clinical values … -->
    <button role="radio" data-chip-not-performed
      class="rounded-full border-2 border-dashed border-[var(--line-strong)] bg-transparent px-3.5 py-2 text-sm font-bold text-[var(--ink-secondary)]
             hover:border-[var(--ink-secondary)] focus-visible:ring-2
             aria-checked:bg-[var(--ink-secondary)] aria-checked:text-white">Not performed</button>
  </div>
  <p data-row-error class="mt-1.5 hidden text-[13px] text-[var(--alert-emergency)] text-start">Select a finding or “Not performed”.</p>
</fieldset>
```

**`NOT_PERFORMED` distinction (load-bearing):** dashed 2 px ring + uppercase-adjacent bold treatment + trailing position (inline-end) in every row; selected state fills neutral slate (NOT emerald/cockpit) so "not performed" never reads as a positive finding. Server `422 MSE_REQUIRED` `details[]` map per-row: `missing (null)` → amber "Missing — select or mark Not performed" + focus first missing row; explicit `NOT_PERFORMED` accepted silently.

**States:** default (no chip selected, row-state "Missing" amber); hover (cockpit wash); focus (ring); active/selected (filled cockpit ink + white text; `NOT_PERFORMED` selected = filled slate); disabled (SIGNED encounter → locked "signed — addendum only"); loading N/A (instant local). One-thumb ergonomics: ≥ 44 px chip height on touch, `gap-2` wrap, no horizontal scroll.

**Micro-interaction:** selection pops (120 ms scale 1→1.04→1; reduced-motion → instant); row-state flips Missing→Recorded with check fade; submit with missing rows scrolls to first missing + shakes once (240 ms, reduced-motion → focus only).

**Accessibility:** `radiogroup` + arrow-key navigation per row; `aria-checked`; required announced; error `aria-describedby`; touch targets ≥ 44 px; never default any selector (C-10).

**Guardrails:** guards enumerate `'NOT_PERFORMED'` literally (FT-4); MSE never persists to disk (memory only, C-18); no copy-to-intercom affordance (ZK-5).

### 3.5 AI Scribe Audio Studio Widget (`DoctorScribeStudio` in `DoctorConsultRoom`)

**Purpose + trace:** D-03 audio ingest; D-05 three-pass scribe (ambient → dictation → commit); C-02 waveform; C-03 60 s cap; C-13 consent/retention surfacing; GAP-06/08 tolerant machine.

**Anatomy (three zones):**

```
┌ Cycle switch [Cycle 1 Consultation | Cycle 2 Doctor 30-sec Dictation] + consent chip + retention countdown ┐
│ Waveform canvas (sunken well) + transport [● Record / ⏸ Pause / ■ Stop] + duration mono + cap countdown   │
│ Pass tracker: Session → Transcribe → Draft → Review → Sign-off (stepper)                                   │
│ Side-by-side review: [Dialogue analysis | SOAP synthesis w/ diff highlights] + [1-click Atomic Commit]     │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Normative patterns:

```html
<!-- CONTRACT PATTERN -->
<section data-scribe-studio class="rounded-2xl border border-[var(--cockpit-line)] bg-[var(--surface-card)]">
  <header class="flex flex-wrap items-center gap-2 border-b border-[var(--line-subtle)] px-4 py-3 text-start">
    <div role="tablist" aria-label="Scribe cycle" class="flex rounded-full bg-[var(--surface-sunken)] p-1">
      <button role="tab" aria-selected="true" data-cycle="ambient"
        class="rounded-full px-3.5 py-1.5 text-sm font-semibold aria-selected:bg-[var(--surface-surface)] aria-selected:shadow">Cycle 1 · Consultation</button>
      <button role="tab" aria-selected="false" data-cycle="dictation"
        class="rounded-full px-3.5 py-1.5 text-sm font-semibold text-[var(--ink-secondary)]">Cycle 2 · Doctor dictation</button>
    </div>
    <span data-consent-chip class="ms-auto rounded-full bg-[var(--status-ok-bg)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--status-ok)]">Consent granted</span>
    <span data-retention class="font-mono text-[13px] tabular-nums text-[var(--ink-secondary)]">Audio kept 27d</span>
  </header>
  <div data-waveform-well class="m-4 rounded-xl bg-[var(--surface-sunken)] px-4 py-3">
    <canvas data-waveform aria-hidden="true" class="h-16 w-full"></canvas>
    <div class="mt-2 flex items-center gap-2">
      <button data-rec class="size-11 rounded-full bg-[var(--alert-emergency-solid)] text-white hover:brightness-110 focus-visible:ring-2" aria-label="Record">●</button>
      <button data-pause class="rounded-lg border px-3 py-2 text-sm font-semibold" aria-label="Pause">Pause</button>
      <button data-stop class="rounded-lg border px-3 py-2 text-sm font-semibold" aria-label="Stop">Stop</button>
      <span data-duration class="ms-auto font-mono text-[15px] font-semibold tabular-nums">00:42</span>
      <span data-cap class="font-mono text-[13px] tabular-nums text-[var(--alert-debt)]">18s left</span>
    </div>
  </div>
  <div data-review-grid class="grid gap-3 px-4 pb-4 md:grid-cols-2">
    <article data-analysis class="rounded-xl border border-[var(--line-subtle)] p-4">
      <h4 class="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--ink-secondary)] text-start">Dialogue analysis</h4>
      <!-- chief complaint / symptoms / mood-affect / suggestions (AI violet chips) -->
    </article>
    <article data-soap-draft class="rounded-xl border border-[var(--cockpit-line)] bg-[var(--cockpit-wash)] p-4">
      <h4 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-start">SOAP synthesis <span data-ai-badge class="rounded-full bg-[var(--scribe-ai)] px-1.5 py-px text-[10px] font-bold uppercase text-white">AI</span></h4>
      <p data-diff-add class="mt-2 border-s-2 border-[var(--scribe-ai)] bg-[var(--scribe-ai-bg)] ps-2 text-sm leading-[1.65]">Added synthesis…</p>
      <p data-diff-del class="mt-1 text-sm text-[var(--ink-secondary)] line-through">Superseded phrasing…</p>
    </article>
  </div>
  <footer class="flex flex-wrap items-center gap-3 border-t border-[var(--line-subtle)] px-4 py-3">
    <span data-draft-version class="font-mono text-[13px] tabular-nums text-[var(--ink-secondary)]">Draft v3</span>
    <span class="flex-1"></span>
    <button data-commit class="rounded-xl bg-[var(--cockpit-ink)] px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 focus-visible:ring-2 disabled:opacity-50">Commit as Encounter (source: SCRIBE)</button>
  </footer>
</section>
```

**Dual-state recorder:** Cycle 1 (AMBIENT_LIVE, consent-gated, no cap UI) vs Cycle 2 (DICTATION_60S, 60 s hard cap with warn at ~55 s + auto-stop assist; server `422` still handled). Transport states: idle → recording (crimson dot + elapsed mono + live waveform from `AnalyserNode`) → paused (frozen bars + Resume) → stopped (upload chunked, 120 s timeout). Session states (`UPLOADED/TRANSCRIBING/TRANSCRIBED/FAILED/WITHDRAWN/PURGED`) render as stepper + lock screens (withdrawn/purged lock transcribe/upload/draft with "Start new session" recovery — never an error toast).

**Waveform:** local canvas metering (bars, cockpit indigo; recording dot crimson); pause freezes; stop collapses to duration summary. Reduced-motion → static level bar. Bytes live in bounded `MediaRecorder` buffer only; never retained post-close/purge (C-02).

**Side-by-side review:** dialogue analysis (left, neutral) vs SOAP synthesis (right, cockpit wash + AI badge); diff highlights: additions = `scribe-ai-bg` + inline-start AI ring; deletions = strikethrough + faint (never red-text-only + labeled "Removed"); manual corrections edit inline (draft → EDITED, version n+1, superseded retained). **1-click atomic commit** creates `Encounter` (source `SCRIBE`) + linked meds; button disabled until MSE explicit + consent granted + draft non-empty, with reason tooltips.

**Accessibility:** transport buttons labeled + `aria-pressed` on record; duration `aria-live=off` (polite summary on stop only, avoids chatter); waveform `aria-hidden` with textual "Recording, 42 seconds" live region; stepper `aria-current=step`.

**Guardrails:** no upload without consent (C-02); WITHDRAWN/PURGED locks are first-class states (C-13); multi-session binding capped at 1 until GAP-08 (length > 1 blocked with notice, never truncated); audio never in outbox/logs/reports.

### 3.6 Encrypted Therapy Vault Component (`DoctorVaultPage`)

**Purpose + trace:** D-09 vault; ZK-6 ephemerality; C-14/C-15 hygiene; `vaultGuard`; GAP-05 (no shred endpoint — no fake affordance).

**Three visual treatments (never mixed):**

1. **Locked/obscured (default):** ciphertext rows as sealed envelopes — `▪▪▪▪` glyphs + `keyId` label + `createdAt` + "Locked — authenticate to view" CTA. Blur is NOT the mechanism (blur implies reversible CSS); locked rows render NO plaintext at any layer (separate `ClosedVault` type, no plaintext field).
2. **Doctor-authenticated in-memory viewer:** single-note reading pane (`Body-L`, `max-w-[68ch]`, `leading-[1.7]`), amber `VAULT_ACCESS` notice bar ("Every read is logged — id + timestamp only"), auto-scrub countdown ("Locks in 4:32"), one-click Lock, no copy affordance by default (copy requires explicit second confirm + audit note).
3. **Shred confirmation (pending-ratification):** Phase 1 ships NO shred button (GAP-05). The surface shows "Retention: shred unavailable in Phase 1 — notes are retained under current policy" + tombstone PREVIEW pattern (below) as design-ready, disabled with "Awaiting server support" tooltip. When ratified, the modal below activates verbatim:

```html
<!-- CONTRACT PATTERN — locked row -->
<li data-vault-locked class="flex items-center gap-3 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-3">
  <span aria-hidden="true" class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-sunken)]">🔒</span>
  <div class="min-w-0 flex-1 text-start">
    <p class="font-mono text-[13px] tabular-nums text-[var(--ink-secondary)]">note_8f3a · key k_2026_04 · 12 Mar</p>
    <p class="text-sm text-[var(--ink-faint)]" aria-label="Content hidden">▪▪▪▪ ▪▪▪▪ ▪▪▪▪</p>
  </div>
  <button data-unseal class="rounded-lg border border-[var(--line-strong)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-sunken)] focus-visible:ring-2">View</button>
</li>

<!-- CONTRACT PATTERN — high-friction shred modal (activates post-GAP-05) -->
<div role="alertdialog" aria-modal="true" aria-label="Shred therapy note" data-shred-modal
  class="rounded-2xl border-2 border-[var(--alert-emergency-line)] bg-[var(--surface-overlay)] shadow-[var(--shadow-modal)]">
  <div class="border-b border-[var(--line-subtle)] bg-[var(--alert-emergency-bg)] px-5 py-4 text-start">
    <h3 class="text-base font-bold text-[var(--alert-emergency)]">Shred this note? Irrevocable.</h3>
    <p class="mt-0.5 text-[13px] text-[var(--alert-emergency)]">The ciphertext is destroyed. Only an audit tombstone (id + timestamp) remains.</p>
  </div>
  <div data-tombstone-preview class="mx-5 mt-4 rounded-xl bg-[var(--surface-sunken)] px-4 py-3 font-mono text-[13px] tabular-nums text-[var(--ink-secondary)] text-start">
    tombstone { note: note_8f3a · shreddedAt: 2026-… · actor: dr_… }
  </div>
  <div class="flex flex-wrap items-center gap-2 px-5 py-4">
    <input data-shred-confirm placeholder='Type SHRED to confirm' aria-label="Type SHRED to confirm"
      class="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-surface)] px-3 py-2.5 font-mono text-sm" />
    <button data-cancel class="rounded-lg px-4 py-2.5 text-sm font-semibold">Keep note</button>
    <button data-shred disabled class="rounded-lg bg-[var(--alert-emergency-solid)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Shred forever</button>
  </div>
</div>
```

**States:** locked (envelopes); unsealed (reading pane + access notice + scrub timer); scrubbed (auto-return to locked + toast "Vault locked — memory scrubbed"); shred-armed (typed `SHRED` enables destructive CTA; dual control: type + press). Loading: skeleton envelopes (no shimmer of real lengths — fixed 3-line masks so ciphertext length doesn't leak).

**Micro-interaction:** unseal fades pane in 160 ms; lock/scrub snaps shut instantly (no linger); shred requires typed confirmation (no one-click); tombstone preview renders BEFORE confirm so irreversibility is concrete.

**Accessibility:** locked rows expose only metadata to AT (`aria-label="Sealed note, created 12 March"`); viewer `aria-live` announces lock/scrub; shred dialog focus-traps with destructive CTA last in tab order; Esc = Keep note (safe default).

**Guardrails:** plaintext ONLY in `VaultHolder` memory map; scrub on lock/logout/role-switch/tab-hide/route-exit/idle (C-15/FT-8 hygiene test scans storage for `vault|soap|scribe|mse`); reads log id+timestamp only; NO shred affordance until GAP-05 ratified (placeholder copy, not a fake button); no "send to desk" from vault (ZK-5).

### 3.7 Floating In-Clinic Intercom Drawer / Mini-Dock (`OpsIntercomDock` + `DoctorDirectivesWidget` listener)

**Purpose + trace:** S-14 desk dock; D-13 directives widget; type-ownership; C-23 effect receipts; ZK-5 text discipline; silent-by-default.

**Mini-dock (docked, collapsed):** `fixed bottom-4 inset-inline-end-4 z-40`, 56 px circular/rounded trigger with unread badge (crimson-solid count, mono, capped `9+`), subtle pulse on new directive (1600 ms, reduced-motion static). Badge is `aria-live=polite` ("2 unread intercom messages").

**Drawer (expanded):** `w-[380px] max-w-[calc(100vw-2rem)]`, `inset-inline-end` docked (mirrors RTL), three zones: fast-action pills → message feed → composer.

```html
<!-- CONTRACT PATTERN -->
<aside data-intercom-drawer
  class="fixed bottom-4 inset-inline-end-4 z-40 flex max-h-[70vh] w-[380px] max-w-[calc(100vw-2rem)]
         flex-col overflow-hidden rounded-2xl border border-[var(--line-subtle)]
         bg-[var(--surface-elevated)] shadow-[var(--shadow-elevated)]">
  <header class="flex items-center gap-2 border-b border-[var(--line-subtle)] px-4 py-3 text-start">
    <h3 class="flex-1 text-sm font-bold text-[var(--ink-primary)]">Intercom</h3>
    <span data-unread class="rounded-full bg-[var(--alert-emergency-solid)] px-1.5 py-px font-mono text-[11px] font-bold text-white tabular-nums">2</span>
    <button data-collapse aria-label="Collapse intercom" class="rounded-md p-1.5 hover:bg-[var(--surface-sunken)]">—</button>
  </header>
  <div data-pills class="flex flex-wrap gap-1.5 border-b border-[var(--line-subtle)] px-3 py-2.5">
    <button data-directive="DOCTOR_NEXT" class="rounded-full bg-[var(--cockpit-ink)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white">Doctor · Next</button>
    <button data-directive="DOCTOR_COMPLIMENTARY" class="rounded-full border border-[var(--cockpit-line)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em]">Complimentary</button>
    <button data-directive="SEC_DISRUPTION" class="rounded-full border border-[var(--line-strong)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em]">Disturbance</button>
    <!-- SEC_PHARMACY_LAB identical; CUSTOM_TEXT via composer only -->
  </div>
  <ol data-feed class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
    <li data-directive-receipt class="rounded-xl border border-[var(--cockpit-line)] bg-[var(--cockpit-wash)] px-3 py-2 text-start">
      <p class="text-[13px] font-semibold">Doctor → Complimentary applied</p>
      <p class="font-mono text-[12px] tabular-nums text-[var(--ink-secondary)]">invoice inv_91 · v43 · 12:41</p>
    </li>
  </ol>
  <footer class="border-t border-[var(--line-subtle)] px-3 py-2.5">
    <p data-hint class="px-1 pb-1.5 text-[12px] text-[var(--ink-faint)] text-start">Operational only — never type diagnoses, drug names, or findings.</p>
    <div class="flex items-center gap-2">
      <input data-composer placeholder="Message the desk…" aria-label="Intercom message"
        class="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-surface)] px-3 py-2 text-sm" />
      <button data-send class="rounded-lg bg-[var(--brand-700)] px-3.5 py-2 text-sm font-semibold text-[var(--brand-ink)]">Send</button>
    </div>
  </footer>
</aside>
```

**Fast-action directive pills:** role-derived (forged types impossible — type-ownership, not user-selected). Doctor pills (`DOCTOR_NEXT`, `DOCTOR_COMPLIMENTARY` + key, `DOCTOR_FOLLOWUP` → task) execute real mutations; desk pills (`SEC_DISRUPTION`, `SEC_PHARMACY_LAB`) send operational notices; `CUSTOM_TEXT` only via composer (capped, hint-visible). Every directive renders its **effect receipt** (C-23): invoice id / task id / new `queueVersion` + timestamp — text alone is never confirmation.

**States:** collapsed (trigger + badge); open (drawer); sending (composer disabled + spinner); offline-queued ("will send" chip, gap-filled on LIVE); history paginated (`limit&cursor`, overflow "+12 more"). Silent by default (no sound; badge + pulse only).

**Accessibility:** drawer `role=complementary aria-label=Intercom`; Esc collapses (focus returns to trigger); pills keyboard-focusable in row order; feed `aria-live=polite` for directives, `off` for chatty notices (avoids SR flood); composer labeled + length counter.

**Guardrails:** no clinical pre-fill into composer (ZK-5); no "send to desk" buttons on clinical surfaces; `DOCTOR_COMPLIMENTARY` carries idempotency key over REST and WS alike.

### 3.8 Medication Titration & Safety Card (`DoctorMedicationTracker`)

**Purpose + trace:** D-10 tracker; D-11 titration saga (two-step, NOT atomic — copy MUST say so); D-12/C-22 overlap advisories (advisory-only, never blocking); cessation-reason gate (P-06).

**Anatomy:** Active list (top, full-ink cards with dosage pills) → Overlap advisory strip (conditional, amber, labeled advisory) → Discontinued list (bottom, muted strikethrough + reason chips).

```html
<!-- CONTRACT PATTERN -->
<section data-meds class="space-y-3">
  <h3 class="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--ink-secondary)] text-start">Active · 2</h3>
  <article data-med-active class="rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-3">
    <div class="flex flex-wrap items-center gap-2 text-start">
      <p class="flex-1 text-sm font-bold text-[var(--ink-primary)]">Sertraline</p>
      <span data-dosage class="rounded-full bg-[var(--cockpit-wash)] px-2.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-[var(--cockpit-ink)]">50 mg · daily</span>
      <span data-started class="font-mono text-[12px] tabular-nums text-[var(--ink-secondary)]">since 02 Feb</span>
    </div>
    <div class="mt-2.5 flex flex-wrap gap-2">
      <button data-titrate class="rounded-lg bg-[var(--cockpit-ink)] px-3 py-1.5 text-[13px] font-bold text-white hover:brightness-110 focus-visible:ring-2">Titrate…</button>
      <button data-discontinue class="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--surface-sunken)] focus-visible:ring-2">Discontinue…</button>
    </div>
  </article>
  <div data-overlap role="note" class="flex items-start gap-2 rounded-xl border border-[var(--alert-debt-line)] bg-[var(--alert-debt-bg)] px-3.5 py-2.5 text-start">
    <span aria-hidden="true">⚠</span>
    <p class="text-[13px] text-[var(--alert-debt)]"><strong>Advisory — not a clinical decision.</strong> Overlapping sertraline + escitalopram windows detected. Review before titrating.</p>
  </div>
  <h3 class="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--ink-faint)] text-start">Discontinued · 1</h3>
  <article data-med-disc class="rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-sunken)] px-4 py-3 opacity-80">
    <p class="text-sm font-semibold text-[var(--ink-secondary)] line-through">Fluoxetine 20 mg</p>
    <div class="mt-1.5 flex flex-wrap gap-1.5">
      <span data-reason class="rounded-full bg-[var(--surface-surface)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--ink-secondary)]">Switched — activation</span>
      <span data-stopped class="font-mono text-[12px] tabular-nums text-[var(--ink-faint)]">stopped 18 Jan</span>
    </div>
  </article>
</section>
```

**Titration saga modal (two-step, guarded):** Step 1 "New regimen" (agent + dose + start — creates ACTIVE) → Step 2 "Close old regimen" (cessation reason required + `stoppedAt` server-side). Progress stepper "1 New → 2 Close (two-step, not atomic)". On half-failure: repair screen names exactly which half landed + one-click repair ("Complete the close" / "Void the new row via discontinue"). Copy MUST state "two-step (not atomic)" — claiming atomicity is a defect (§8.3).

**Advisory strip rules (D-12):** client-side date-range/agent overlap badges ONLY; label prefix "Advisory —" mandatory; never blocks Titrate/Discontinue (buttons stay enabled); never dose-advises (no "reduce to X" copy); dismissible per-session with "Dismissed — still visible in history" note.

**States:** active (full ink + dosage pill); pending-saga (row spinner + "Titrating 1/2…" chip); discontinued (muted + strikethrough + reason chip + stopped date); error-half (amber repair card). Discontinue requires reason (`422` no-reason → focus reason); already-discontinued (`400`) converges to list.

**Accessibility:** lists with headings; dosage pills `aria-label="50 milligrams daily"`; advisory `role=note` (not `alert`, avoids false urgency); repair actions focused on open; strikethrough paired with "Discontinued" text (never visual-only).

**Guardrails:** no reactivation affordance (new row instead — history retained); cessation/discontinue reasons non-blank (P-06); no interaction-checking claims (backend performs none — UI must not imply otherwise).

---

## 4. Notification & Error Toast System

### 4.1 Mechanics (extends Step-2 §11.1 + App. C, Step-1 §4.5)

Single `ToastService` (root), fed ONLY by `errorEnvelopeInterceptor` + store intent results. Toasts are **operational-only templates** (DS-03); severity `info | success | warning | error`; queue max 5 + overflow counter ("+2 more"); buffered during WS loss (C-09) with staleness suffix; every error toast carries ≥ 1 action affordance (Retry same-key / Review board / Fresh intent / Report incident / Open supervision).

**Toast anatomy (normative):**

```html
<!-- CONTRACT PATTERN — docked inline-end, mirrors RTL -->
<div data-toast-region aria-live="polite" class="pointer-events-none fixed bottom-4 inset-inline-start-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
  <div role="status" data-toast="warning"
    class="pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--alert-debt-line)]
           bg-[var(--surface-elevated)] px-3.5 py-3 shadow-[var(--shadow-elevated)] text-start">
    <span aria-hidden="true" data-toast-icon class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--alert-debt-bg)]">⚠</span>
    <div class="min-w-0 flex-1">
      <p data-toast-title class="text-sm font-bold text-[var(--ink-primary)]">Queue changed under you</p>
      <p data-toast-body class="mt-0.5 text-[13px] text-[var(--ink-secondary)]">v41 → v42 · Review and retry your reorder.</p>
      <div data-toast-actions class="mt-2 flex flex-wrap gap-2">
        <button data-action class="rounded-lg bg-[var(--brand-700)] px-3 py-1.5 text-[13px] font-semibold text-[var(--brand-ink)]">Review board</button>
      </div>
    </div>
    <button data-dismiss aria-label="Dismiss" class="rounded-md p-1 text-[var(--ink-faint)] hover:bg-[var(--surface-sunken)]">✕</button>
  </div>
</div>
```

Severity skins: `info` = brand line + ops icon; `success` = emerald line + check; `warning` = amber line + ⚠; `error` = crimson line + !. Banners (persistent, top-docked, `role=alert`) are reserved for: crisis active, WS DEGRADED/OFFLINE, blind-reveal results, `INVARIANT_VIOLATION` blockers, WITHDRAWN/PURGED locks. Everything else is a toast (auto-dismiss 6 s success/info, 9 s warning, persistent-until-acted error).

Copy rules: amounts formatted (never raw minor); versions as `v{N}`; incident ids as `ref {id}`; NO clinical content, NO vault plaintext, NO expected-cash values, NO full SOAP (ZK-7). Arabic/RTL: icons stay inline-start, actions wrap, numerals remain LTR mono (`dir=ltr` on amount spans).

### 4.2 Backend failure envelope → clinical guidance (normative catalogue)

Failure envelope `{error:{code,message,details:[{field?,issue,expected?}]}}`. Behavior below EXTENDS Step-2 App. C with exact user-facing copy and visual treatment. Unknown codes → safe generic + incident id, never retry loops.

| Code (HTTP) | Visual | Title / body copy (operational-only) | Actions | Owner surface |
|---|---|---|---|---|
| `DISCOUNT_BELOW_FLOOR` / `FLOOR_VIOLATION` (403) | Warning dialog-inline card (amber) in checkout sheet + focus floor meter | **"Discount exceeds your floor."** "Max allowed {maxAllowed} on a {standard} fee. Collect at floor or hand to the doctor — complimentary / write-off needs doctor approval." | [Collect at floor] [Request doctor] (routes to complimentary/write-off path; no retry, no silent escalation) | `OpsBillingCheckoutSheet` |
| `STALE_QUEUE` (409 + snapshot) | Warning toast + board snap-back (ghost reverts instantly) | **"Queue changed under you (v{old} → v{new})."** "Your reorder/flag was not applied. Review the board and retry." | [Review board] (focuses changed rows) — NEVER auto-retry (C-01) | Board, reorder, emergency |
| `PRECONDITION_REQUIRED` / missing `If-Match` (428) | Info toast + version chip flashes amber | **"Queue version missing — refreshing."** "We couldn't verify the latest queue (v?). Reloading, then you can retry safely." | [Reload queue] (forces `loadSnapshot()`; dispatch blocked until version ≥ 0 — occVersionInterceptor rule) | Board, reorder, emergency |
| `IDEMPOTENCY_KEY_REQUIRED` (422) | Silent (interceptor retries once) → success toast only | — (no user copy on auto-recovery) | None; second failure → hard error + Report | Outbox/interceptor |
| `IDEMPOTENCY_KEY_REUSE` (422) | Error toast (persistent) + idem chip flips to "Fresh intent needed" | **"Receipt key already used for a different amount."** "Start a fresh intent — the old key is retired." | [Start fresh] (mints new UUID, discards key) | All money surfaces |
| `SHIFT_LOCKED` (409) | Info toast + "Drawer busy" chip on sheet | **"Drawer busy — safe to retry."** "Same receipt key held. Retrying…" (auto ×3: 250/750/2000 ms) | [Retry now] (same key) after exhaustion | Checkout/pay/petty/close |
| `INVARIANT_VIOLATION` (409 + `discrepancies[]`) | Blocking dialog (modal) listing `discrepancies[]` + halt close | **"Close blocked — {n} discrepancies."** Per-row `{inv, detail}` + resolve-or-escalate path. | [Resolve queue] [Open supervision] [Force with reason — doctor] (audited) | Close → supervision |
| Reason / `DISCOUNT` 422s | Inline field error (crimson helper + ring) + preserve amounts | **"A reason is required."** Field-focused: discount / reversal / write-off / petty purpose / emergency / undo. | Focus field (auto); submit blocked until non-blank | Checkout/reversal/write-off/petty/emergency/undo |
| `MSE_REQUIRED` (422) | Per-row amber "Missing" + first-missing focus + scroll | **"MSE incomplete — {row} needs a finding."** "Select a finding or mark Not performed." | [Go to {row}] | MSE panel/drafts/sign |
| `CONSENT_REQUIRED` (422) | Consent-capture step (sheet) in studio | **"Consent needed before recording."** "Confirm patient consent to start the session." | [Confirm consent] | Scribe create |
| `WITHDRAWN_GONE` (403) / `GONE` (410) | Full-surface lock (not a toast) | **"Session withdrawn/purged."** "Transcribe and upload are locked. Start a new session to continue." | [Start new session] | Scribe |
| `ILLEGAL_TRANSITION` (400) | Silent converge (log only) | — | None (unreachable by design) | Queue command |
| `ALREADY_REVERSED` (400) / pay-on-PAID / `already invoiced` / `duplicate open entry` (409s) | Info toast + pivot (never error page) | **"Already recorded — showing current state."** + jump link. | [View receipt] [Open pay-down] [Jump to queue] | Receipts/pay/checkout |
| `UNAUTHORIZED` (401) | Transient "Reconnecting…" chip → replay or login | **"Session refreshing…"** / on failure **"Signed out — please sign in."** | [Sign in] (`/login?reason=session`) | Session/guards/WS |
| `FORBIDDEN` (403) incl. deactivated / secretary→clinical | Lockout screen (`/403`) + scrub | **"Account deactivated — contact the doctor."** / **"Not permitted for your role."** Zero clinical fetch. | [Sign in as…] / [Back to desk] | Session/guards |
| `NOT_FOUND` (404) | Info toast + list resync | **"No longer available — list refreshed."** Stale reference removed. | [Dismiss] | All entity views |
| `INTERNAL` (500 + incident id) | Error toast + Report affordance | **"Something went wrong (ref {id})."** "Your work is safe. Report includes the reference only — never clinical content." | [Copy ref] [Report] | Global boundary |

**Banner mechanics (persistent, distinct from toasts):** crisis banner (§3.2, crimson, until unflagged); offline banner (amber, "Offline — showing last confirmed queue v{N} · {serverAt}" + 15 s REST poll note, until LIVE); reveal banner (emerald/amber per result, until dismissed); discrepancy banner doctor-side (non-blocking, "2 discrepancies — review" → supervision). Banners stack max 2 + "+n" overflow; order: crisis > offline > discrepancy > reveal.

---

## 5. Keyboard Navigation & Clinical Velocity

### 5.1 Design intent (C-08 + Step-2 §11.3)

Every high-frequency intent is reachable keyboard-only in ≤ 3 keystrokes. Palette (`Ctrl/Cmd+K`) is role-filtered by the same guard predicates as routing — secretary NEVER resolves doctor commands (no leak via names). All shortcuts listed in the `?` overlay; all destructive/shortcut-dispatched mutations still pass their confirm sheets (shortcuts accelerate NAVIGATION, never bypass justification).

### 5.2 Global shortcuts (both cockpits)

| Keys | Action | Notes |
|---|---|---|
| `Ctrl/Cmd + K` | Rapid patient search / check-in palette | Opens `OpsCheckInDialog` search focused (desk) / chart search (cockpit); debounced multi-field; arrows navigate, Enter checks in / opens chart |
| `?` (Shift+/) | Shortcut overlay | Lists global + scoped shortcuts for current role/route |
| `Esc` | Dismiss topmost modal / drawer / palette | Stack-ordered; focus returns to invoker; vault route Esc = lock first, then dismiss |
| `Ctrl/Cmd + .` | Toggle privacy blur (cockpit) / Toggle dock (desk) | Cockpit: blurs clinical surfaces + toasts + print preview; desk: collapses/expands intercom dock |
| `g then b` | Go to board (`/front-desk/board`) | Doctor MAY (oversight D-01); secretary home |
| `g then s` | Go to day summary | Pre-close null slots absent (never 0) |
| `g then i` | Focus intercom composer | Opens dock if collapsed |

### 5.3 Scoped shortcuts

**Front Desk (board + cashier):**

| Keys | Action | Guard |
|---|---|---|
| `Alt + N` | Call next patient (desk requests; doctor executes — desk shows "Requested" + version echo) | Disabled unless WS LIVE + OPEN shift; announces new `IN_CONSULTATION` via live region |
| `Alt + E` | Flag emergency on focused row | Opens reason-required dialog; focus trapped; Enter confirms, Esc cancels |
| `Alt + C` | Open checkout for focused/selected entry | Sheet focused on amount; quick-amount chips `1/2/3` |
| `Alt + P` | Open petty sheet | Purpose field focused; amount `0` never submits |
| `Alt + B` | Open blind close (gated) | Blocked unless `canAttemptClose()` or doctor force path; actual-count field focused |
| `Enter` (on row) | Open patient balance drawer | — |
| `Space` (on handle) | Lift/drop DnD reorder (keyboard DnD) | Arrows move ghost; Enter drops (dispatches with `If-Match`); Esc cancels |

**Doctor Cockpit (command + consult + scribe):**

| Keys | Action | Guard |
|---|---|---|
| `Alt + N` | Call next (executes `call-next`; `force` requires explicit confirm + audit on single-consult `409`) | Doctor only; palette/keys invisible to secretary |
| `Alt + M` | Focus MSE panel (first missing row) | Arrows move within radiogroup, numbers `1–6` select chip, `0` selects `NOT_PERFORMED` |
| `Alt + R` | Toggle record / pause (scribe studio, consented session only) | Blocked without consent; announces "Recording / Paused" |
| `Alt + S` | Open sign-off review (scribe draft / encounter sign) | Disabled until MSE explicit + draft non-empty |
| `Alt + T` | Open titration for focused medication | Opens saga modal at Step 1 |
| `Alt + V` | Lock vault now (scrub + return to envelopes) | Always available on vault route; confirms scrub with toast |

### 5.4 Focus, palette & velocity rules

1. **Palette behavior:** `Ctrl/Cmd+K` ranks recency + prefix match; commands show scope glyph (Desk/Cockpit) + shortcut hint; doctor commands unresolvable (not merely hidden) in secretary context — fuzzy match over doctor names yields zero rows. Palette entries contain NO clinical content (patient names only with `hasDebtAlert` dot, never diagnoses).
2. **Focus management:** every dialog/sheet/drawer traps focus, labels its heading (`aria-labelledby`), returns focus to invoker on close, and moves focus to first-invalid on submit-block (reason fields, MSE rows, anchor fields). Roving tabindex on board rows and MSE radiogroups; skip-links ("Skip to queue", "Skip to chart") on every route.
3. **Velocity budgets:** check-in ≤ 3 keystrokes after search (Enter → ack-if-needed → Enter); checkout submit ≤ 2 tabs from amount; MSE row ≤ 1 key (`0–6`); call-next ≤ 1 chord (`Alt+N` + confirm only on force). Dirty-guards on all sheets (navigating away with unsaved non-clinical input confirms; clinical drafts warn "unsaved clinical draft will be discarded — never saved to disk").
4. **Announcements:** `aria-live=polite` for queue called/reordered/emergency, directive receipts, reveal results, scrub/lock; `assertive` ONLY for crisis banner appearance and `INVARIANT_VIOLATION` blockers. Duration/countdown regions are `off` during ticking (summary announced on stop/confirm only).
5. **No shortcut bypasses:** shortcuts MUST NOT skip consent, reason capture, floor guidance, typed `SHRED`, blind two-phase order, or force-confirm audit. A shortcut that would bypass a guard instead OPENS the guard's sheet focused at the missing control.

---

## Appendix A — Canonical CSS Token Contract (`styles/themes.css`)

> Normative. Step 4 writes this block verbatim (adjusting ONLY the Tailwind-version mapping layer). Hex is authoritative for implementation; HSL comments authoritative for tonal review. Extends (does not replace) Step-2 §6.1.2 skeleton — old variable names retained as aliases where noted.

```css
/* CONTRACT — styles/themes.css (light = :root, dark = .dark on <html>) */
:root {
  color-scheme: light;
  /* Neutral / base — slate-zinc */
  --surface-canvas: #F4F6F9;            /* hsl(214 28% 96%) */
  --surface-base: #F7F8FA;              /* hsl(220 20% 97%) — Step-2 compat alias */
  --surface-surface: #FFFFFF;           /* hsl(0 0% 100%) */
  --surface-raised: #FFFFFF;            /* Step-2 compat */
  --surface-card: #FFFFFF;
  --surface-sunken: #EDF0F5;            /* hsl(216 24% 94%) */
  --surface-elevated: #FFFFFF;
  --surface-overlay: #FFFFFF;           /* Step-2 compat */
  --surface-scrim: rgb(16 24 40 / 0.48);
  --ink-primary: #16202F;               /* hsl(213 37% 14%) */
  --ink-secondary: #55677E;             /* hsl(212 19% 41%) */
  --ink-faint: #8595AB;                 /* hsl(213 17% 60%) — non-body only */
  --ink-inverse: #FFFFFF;
  --brand-ink: #FFFFFF;
  --line-subtle: #E2E8F1;               /* hsl(214 28% 91%) */
  --line-strong: #C4CFDE;               /* hsl(213 24% 79%) */
  --line-focus: #2F6FED;
  --focus-ring: #2F6FED;                /* Step-2 compat */
  /* Brand — medical slate */
  --brand-50: #EEF4FE; --brand-100: #DCE7FD; --brand-200: #B9CFFB;
  --brand-500: #2F6FED; --brand-600: #245BDB; --brand-700: #1D4BB8;
  /* Cockpit + scribe — indigo/violet */
  --cockpit-wash: #EEF0FE;              /* hsl(237 86% 94%) */
  --cockpit-ink: #2E33B8;               /* hsl(239 60% 45%) */
  --cockpit-line: #C9CDF8;              /* hsl(236 74% 88%) */
  --scribe-ai: #6D28D9;                 /* hsl(262 83% 50%) */
  --scribe-ai-bg: #F1EAFE;              /* hsl(264 89% 95%) */
  --scribe-diff-add: #DEF7EC; --scribe-diff-del: #FDE8E8;
  /* Operational — sky/cerulean */
  --ops-info: #0369A1;                  /* hsl(201 96% 32%) */
  --ops-info-bg: #E0F2FE;               /* hsl(199 95% 92%) */
  --ops-live: #0284C7;                  /* hsl(201 90% 40%) */
  --ops-stale: #92400E;
  /* Status & safety */
  --status-ok: #047857; --status-ok-bg: #D1FAE5; --status-ok-line: #6EE7B7;
  --status-wait: #8A6D00; --status-active: #047857; --status-done: #55677E; --status-skip: #8595AB;
  --alert-debt: #92400E; --alert-debt-bg: #FEF3C7; --alert-debt-line: #FCD34D;
  --alert-emergency: #B91C1C; --alert-emergency-bg: #FEE2E2;
  --alert-emergency-line: #FCA5A5; --alert-emergency-solid: #C81E1E;
  --alert-ok: #047857;                  /* Step-2 compat alias of status-ok */
  --alert-debt-compat: #92400E;
  --accent-calm: #1D4BB8; --accent-calm-ink: #FFFFFF;  /* Step-2 compat → brand-700 */
  /* Shape / motion */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;
  --shadow-card: 0 1px 2px rgb(16 24 40 / 0.06);
  --shadow-elevated: 0 8px 24px rgb(16 24 40 / 0.14);
  --shadow-modal: 0 24px 64px rgb(16 24 40 / 0.24);
  --font-sans: "Inter", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
}
.dark {
  color-scheme: dark;
  --surface-canvas: #0F141D;            /* hsl(214 32% 9%) */
  --surface-base: #11161F;
  --surface-surface: #1A2230;           /* hsl(214 30% 15%) */
  --surface-raised: #1A2230;
  --surface-card: #1E2736;              /* hsl(214 29% 17%) */
  --surface-sunken: #0C1119;            /* hsl(216 33% 8%) */
  --surface-elevated: #232E42;          /* hsl(215 32% 20%) */
  --surface-overlay: #232E42;
  --surface-scrim: rgb(2 6 14 / 0.66);
  --ink-primary: #EAF0F8; --ink-secondary: #B3BED2; --ink-faint: #7E8CA3;
  --ink-inverse: #0B1220; --brand-ink: #0B1220;
  --line-subtle: #2A3549; --line-strong: #3D4C66;
  --line-focus: #5B93FF; --focus-ring: #5B93FF;
  --brand-50: #131E33; --brand-100: #1A2A4A; --brand-200: #24406E;
  --brand-500: #5B93FF; --brand-600: #7AA8FF; --brand-700: #A4C2FF;
  --cockpit-wash: #1B1E3A; --cockpit-ink: #B9BEFF; --cockpit-line: #3A3F6B;
  --scribe-ai: #A78BFA; --scribe-ai-bg: #2A2145;
  --scribe-diff-add: #12362B; --scribe-diff-del: #3A1E24;
  --ops-info: #7DD3FC; --ops-info-bg: #0C2A3D; --ops-live: #38BDF8; --ops-stale: #FBBF24;
  --status-ok: #34D399; --status-ok-bg: #0B2E24; --status-ok-line: #1B4D3E;
  --status-wait: #FBBF24; --status-active: #34D399; --status-done: #B3BED2; --status-skip: #7E8CA3;
  --alert-debt: #FBBF24; --alert-debt-bg: #33230A; --alert-debt-line: #6B4E12;
  --alert-emergency: #FCA5A5; --alert-emergency-bg: #3B1215;
  --alert-emergency-line: #7F1D1D; --alert-emergency-solid: #EF4444;
  --alert-ok: #34D399; --alert-debt-compat: #FBBF24;
  --accent-calm: #5B93FF; --accent-calm-ink: #0B1220;
}
```

Tailwind mapping (Step 4 records engine version here): `bg-canvas/surface/card/sunken/elevated/overlay → var(--surface-*)`; `text-primary/secondary/faint/inverse → var(--ink-*)`; `border-subtle/strong → var(--line-*)`; `bg-brand/*, text-cockpit, bg-ops-*, text-ok/debt/emergency/* → respective vars`. Direct hex utilities banned outside this file (stylelint `color-no-hex`).

---

## Appendix B — Logical-Property Compliance Contract

> Normative, extends Step-2 §6.2. CI-failing. Every class string in §3 already conforms; this appendix is the audit rule.

**BANNED (templates, SCSS, inline styles) — any occurrence fails `no-physical-classes` + stylelint `property-disallowed-list`:**

```
pl-*, pr-*, ml-*, mr-*, left-*, right-* (positional), text-left, text-right,
border-l-*, border-r-*, rounded-l-*, rounded-r-*,
float-left, float-right, clear-left, clear-right,
CSS: padding-left, padding-right, margin-left, margin-right, left, right,
     text-align: left, text-align: right, border-left, border-right,
     border-top-left-radius, border-top-right-radius, border-bottom-left-radius, border-bottom-right-radius
```

**REQUIRED equivalents:**

```
ps-*, pe-*, ms-*, me-*, start-*, end-*, text-start, text-end,
border-s-*, border-e-*, rounded-s-*, rounded-e-*,
space-x-* → space-x-reverse-independent gap-* (prefer gap),
divide-x-* → border-s on children,
CSS: padding-inline-start/end, margin-inline-start/end, inset-inline-start/end, inset-block-start/end,
     text-align: start/end, border-inline-start/end, border-start-start-radius et al.
```

Rules:

1. Drawer/dock/toast anchoring uses `inset-inline-end` (never `right`); banner icons use `ms/me` gaps; amount numerals use `text-end` (mirrors correctly — numerals keep `dir=ltr` internally).
2. Flex/grid ordering MUST NOT assume LTR — name panels `inline-start/end`, never "left panel". `flex-row` is direction-agnostic and permitted; `flex-row-reverse` for visual reorder is FORBIDDEN (reorder DOM instead so AT order matches visual order in both directions).
3. Icons that must not mirror (clock hands, waveform, dosage glyphs) carry `/* rtl-waiver: <reason> — approved <date> */` + `dir=ltr` isolation. Everything else mirrors.
4. CI runs `rtl` smoke (`dir=rtl` on board + checkout + dock + scribe review grid) asserting zero horizontal overflow and start/end mirroring.
5. `space-x-*` is discouraged (physical-biased in older Tailwind); prefer `gap-*`. Where `space-x` appears it MUST pair with `space-x-reverse` + RTL test evidence — otherwise defect.

---

## Appendix C — Motion, Elevation, Radius & Iconography

- **Motion budget:** state confirmations 120–200 ms `ease-out` (hover 100 ms, select pop 120 ms, modal rise 160 ms, banner slide 180 ms, reveal 200 ms); live pulse 1600 ms; `queue.called` flash 1200 ms. NOTHING ambient/loops except recording dot + emergency pulse (both static under `prefers-reduced-motion`).
- **Elevation:** card → modal ladder `shadow-card < elevated < modal` (§2.3); dark mode relies on rings + 1-step luminance lift, not deeper shadows.
- **Radius:** chips `rounded-full`; inputs/buttons `rounded-lg`; cards `rounded-xl`; sheets/modals `rounded-2xl`; drawer inline-start corners square when docked (`rounded-s-none` pattern) — logical, mirrors RTL.
- **Iconography:** single stroke set (1.75 px, round caps), 16/20 px grid; status icons fixed: waiting = clock, in-consult = waveform, completed = check, skipped = dash-circle, emergency = pulse-dot + triangle, debt = coin-alert, paid = check-seal, AI = sparkles + `AI` text, lock = padlock. Icons NEVER carry meaning alone (always + label). Emoji in chrome is forbidden except the vault padlock placeholder (to be replaced by stroke icon in Step 4) — no emoji in committed UI.
- **Privacy blur:** `.privacy-blur { filter: blur(12px); }` on clinical content + toasts + print preview; toggled from root signal (`Ctrl/Cmd+.`); blur is a procedural aid (T-1 residual), never a secrecy mechanism — real secrecy is ZK-1…ZK-6 data-flow absence.
- **Print:** receipts (operational) printable in light tokens; clinical surfaces `@media print { body.clinical { display: none } }` + receipts-only allowlist.

---

## Appendix D — Traceability (Step-1 Features → Design Tokens/Components)

| Feature(s) | Design binding in this playbook |
|---|---|
| S-01/S-02 check-in + registration | §3.2 modal language; §2 Mono-Counter debt numerals; §4 duplicate/advisory debt toasts (informational, non-blocking); §5 `Ctrl/Cmd+K` palette |
| S-03 crisis intake | §3.2 banner + modal; §1.6 crimson budget; §5 `Alt+E` |
| S-04/S-05/S-06/S-07 queue | §3.1 card; §1.5 ops tokens; §2 Mono-Counter waits; §4 STALE/PRECONDITION rows; §5 `Alt+N`, keyboard DnD |
| S-08…S-11 fee/floor/methods | §3.3 checkout sheet; §1.6 emerald/amber money meaning; §2 Mono-Ledger; §4 FLOOR row; §5 `Alt+C` + chips `1/2/3` |
| S-12 debt oldest-first | §3.3 remaining-to-allocate meter; emerald/amber ledger tokens; §4 pay-pivot rows |
| S-13 receipts archive | §2 Mono-Ledger receipt totals; print allowlist (App. C); GAP-03 suppression note carried |
| S-14 intercom dock | §3.7 dock/drawer + pills + receipts; §1.5 ops + §1.4 cockpit accents on receipts; §5 `g then i` |
| S-15 petty | §3.3 sheet language (purpose-required pattern); §4 reason-422 row; §5 `Alt+P` |
| S-16/S-17 blind close + summary | §3.3 blind phases + reveal animation; §1 Display result word; §2 tabular numerals; App. A null-vs-0 discipline; §5 `Alt+B` |
| S-18 ZK isolation | DS-03 + §3 banners/modals hint copy + App. B; no clinical token/component reachable desk-side |
| D-01 oversight / D-02 command / D-13 widget | §3.1 read-only states + §3.7 directive pills + receipts; §4 discrepancy/undo rows; §5 `Alt+N` doctor path |
| D-03 audio / D-05 scribe | §3.5 studio; §1.4 indigo/violet provenance; §2 Mono-Counter durations; §4 consent/withdrawn rows; §5 `Alt+R/S` |
| D-04 MSE | §3.4 matrix + NOT_PERFORMED; §4 MSE_REQUIRED row; §5 `Alt+M` + `0–6` |
| D-06/D-07/D-08 chart/manual/addenda | §2 Body-L prose + 72 ch measure; violet-NEVER-human rule; §4 pivot rows |
| D-09 vault | §3.6 locked/viewer/shred; §2 calm prose; §5 `Alt+V` + Esc-locks-first |
| D-10/D-11/D-12 meds | §3.8 card + saga + advisories; §5 `Alt+T` |
| C-01…C-24 | Each capability's visual contract embedded in §3 (§3.1 C-01/C-09/C-20; §3.3 C-05/C-06/C-07/C-11/C-12; §3.4 C-10; §3.5 C-02/C-03/C-13; §3.6 C-14/C-15; §3.7 C-23; §4 C-16; §5 C-08; App. C C-14/C-19) |
| P-01…P-12, ZK-1…ZK-7, INV-1…INV-10, GAP-01…GAP-11 | DS-01…DS-06 + per-component Guardrails rows; GAP-05 shred placeholder, GAP-03 archive suppression, GAP-01 no-If-Match, GAP-08 single-session cap carried verbatim |

Deferred F-01…F-10 / excluded X-01/X-02: NO bindings by design (§5.3 gate). No comp, token, copy string, or empty state in this playbook implies them.

---

## Appendix E — Step-4 Entry Criteria

**SPEC-DS-E.1 — Gates (all MUST hold before Step 4 writes app code):** (1) this playbook approved; (2) Angular/TS/Tailwind LTS versions pinned as amendment to Step-2 §1.1 + App. A mapping note here; (3) `themes.css` (App. A) + `typography.css` (§2.1) + `print.css` committed; (4) `no-physical-classes` + stylelint physical-property ban + contrast-sweep + RTL smoke committed red-then-green; (5) icon stroke set + `.privacy-blur` utility committed; (6) toast/banner templates (§4.1) + shortcut overlay (`?`) shells committed with role-filtered command registry; (7) §3.1–§3.8 built as presentational `ui-*` shells (model-free, logical-only) BEFORE store wiring, in Step-2 §16.2 build order.

**SPEC-DS-E.2 — Amendment rule:** any new token, component variant, shortcut, or toast template requires a playbook amendment (token Hex+HSL + contrast pair + logical class string + traceability row). Ad-hoc hex, physical utilities, or unlisted shortcuts in Step-4 code are defects regardless of visual merit.

---

*End of Step 3 playbook. Next: Step 4 component implementation per §§1–5 and Appendices A–C, bound by the normative token contract, logical-property mandate, and FT-1…FT-8 gates. No Step-4 code is authorized outside this playbook's palettes, type scale, component anatomies, toast catalogue, and keyboard map.*
