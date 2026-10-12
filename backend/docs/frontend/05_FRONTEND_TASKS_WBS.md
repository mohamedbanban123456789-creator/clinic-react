# Frontend Tasks Work Breakdown Structure (WBS) — Psychiatric Practice Management System & Clinical AI Assistant

> **Document:** `docs/frontend/05_FRONTEND_TASKS_WBS.md`
> **Phase:** Frontend Engineering Initiative — **Step 5: Frontend Tasks Work Breakdown Structure (Final Documentation Step)**
> **Status:** NORMATIVE FOR STEP 6+ (all implementation, sequencing, and acceptance must conform; deviations require a WBS amendment)
> **Predecessors (approved, binding):**
> | # | Artifact | Authority for this WBS |
> |---|----------|------------------------|
> | 1 | `docs/frontend/01_DOMAIN_FEATURE_SYNTHESIS.md` — APPROVED | 43-feature census (S-01…S-18, D-01…D-13, F-01…F-10, X-01/X-02), visit spine, ZK-1…ZK-7, P-01…P-12, C-01…C-24, GAP-01…GAP-11, INV-1…INV-10 |
> | 2 | `docs/frontend/02_FRONTEND_ARCH_SPEC.md` — NORMATIVE | Angular 19/20 LTS standalone+OnPush+zoneless-ready, 13 signal stores, 5-interceptor chain, SocketService + version gate, route tree `/front-desk/*` + `/cockpit/*`, logical-properties mandate, FT-1…FT-8 |
> | 3 | `docs/frontend/03_CLINICAL_DESIGN_SYSTEM.md` — NORMATIVE | Token contract `styles/themes.css`, component anatomies (§3.1…§3.6+), toast catalogue, keyboard map, DS-01…DS-06 |
> | 4 | `docs/frontend/04_FRONTEND_API_INTEGRATION_MAP.md` — NORMATIVE | Exhaustive endpoint matrices A–H, OCC/financial protocols, error catalogue, Amendments Q-OCC-1 / E-OCC-1 / S-DUAL-1 / V-SHRED-1, reconciliations E-1…E-4 |
> **Operating constraint:** NO application scaffolding (`ng new`) and NO production source code (`.ts`/`.html`/`.scss` in app directories) is produced in this step. This document is backlog specification only. All TypeScript/HTML/class strings below are file/contract targets for Step 6, not implementation.
> **Mirror:** this file is mirrored verbatim to `D:\Clinic-front\docs\frontend\05_FRONTEND_TASKS_WBS.md`. The `D:\Clinic` copy is the record of authority; divergence resolves in favor of `D:\Clinic`.
> **Conformance language:** MUST / MUST NOT = blocking; SHOULD = strong default with recorded justification.

---

## Table of Contents

- [0. How to Execute This WBS](#0-how-to-execute-this-wbs)
- [Sprint 0: Foundation, Tooling, Tokens & Layout Shells (FE-001…FE-004)](#sprint-0-foundation-tooling-tokens--layout-shells-fe-001fe-004)
- [Sprint 1: Identity, Authentication & Role Isolation (FE-101…FE-104)](#sprint-1-identity-authentication--role-isolation-fe-101fe-104)
- [Sprint 2: Front Desk Live Smart Queue & Triage (FE-201…FE-205)](#sprint-2-front-desk-live-smart-queue--triage-fe-201fe-205)
- [Sprint 3: Cashier Desk, Invoicing, Debt & Blind Shift Close (FE-301…FE-306)](#sprint-3-cashier-desk-invoicing-debt--blind-shift-close-fe-301fe-306)
- [Sprint 4: Doctor Clinical Cockpit, Manual SOAP & Titration (FE-401…FE-405)](#sprint-4-doctor-clinical-cockpit-manual-soap--titration-fe-401fe-405)
- [Sprint 5: Encrypted Therapy Vault (FE-501…FE-503)](#sprint-5-encrypted-therapy-vault-fe-501fe-503)
- [Sprint 6: Multimodal AI Scribe Studio (FE-601…FE-605)](#sprint-6-multimodal-ai-scribe-studio-fe-601fe-605)
- [Sprint 7: Supervision, Invariants, Intercom & Hardening (FE-701…FE-705)](#sprint-7-supervision-invariants-intercom--hardening-fe-701fe-705)
- [Appendix A — Master Traceability (S/D → Endpoints → FE tickets → FT gates)](#appendix-a--master-traceability-sd--endpoints--fe-tickets--ft-gates)
- [Appendix B — Canonical File Manifest (Step 6 creation order)](#appendix-b--canonical-file-manifest-step-6-creation-order)
- [Appendix C — Sprint Gate Command Reference (copy-paste)](#appendix-c--sprint-gate-command-reference-copy-paste)
- [Appendix D — Definition of Done & Staging Sign-off (FE-705 checklist)](#appendix-d--definition-of-done--staging-sign-off-fe-705-checklist)

---

## 0. How to Execute This WBS

### 0.1 Ticket template (every ticket below follows it)

Each ticket defines: **(1) ID & Title · (2) Clinical Objective & Persona Context · (3) Exact Files to Create/Modify · (4) Prerequisites & Dependencies · (5) Technical Acceptance Criteria** (exact behavior, UI states, OCC handling, zero-knowledge bounds) **· (6) Ticket gate slice** (subset of the Sprint Quality Gate). A ticket is DONE only when its acceptance criteria + gate slice pass. A sprint is DONE only when all its tickets are DONE **and** the Sprint Quality Gate block at the end of the sprint section passes end-to-end.

### 0.2 Global engineering invariants (apply to every ticket)

1. **Stack pin (SPEC-1.1):** Angular 19 LTS or 20 LTS (single major, recorded in FE-001), TypeScript strict family + `strictTemplates`, standalone-only, `OnPush` + `input()` signals, zoneless-ready (no `tick()`/`detectChanges()` in product code).
2. **Wire precedence:** `04` map + backend code reality win over this WBS on wire shape. Binding corrections already folded in:
   - **Q-OCC-1 (queue):** version travels in request BODY as `lastSeenQueueVersion: number`. `If-Match` on ANY `/queue/*` route is FORBIDDEN. Reorder + emergency additionally REQUIRE `Idempotency-Key`.
   - **E-OCC-1 (encounters):** `PATCH /ehr/encounters/:id` REQUIRES header `If-Match: <rowVersion>`; `428` missing / `409 STALE_ROW_VERSION`. `POST …/sign` carries `rowVersion` in BODY (`{finalSoap?, rowVersion}`) — there is NO `finalContentHash` field in the contract; FE-404 implements `rowVersion`, not a hash.
   - **S-DUAL-1 (scribe) — RETIRED (Decision 4):** Gen-2 (`sessions` full-shape create, `cycle-1-consultation`, `cycle-2-doctor-decision`, `commit`, `purge-audio`, `withdraw-consent`) is the canonical and ONLY workflow; the Gen-1 endpoints never existed server-side and all client fallbacks were removed.
   - **V-SHRED-1 (vault):** shred EXISTS as `POST /ehr/vault/notes/:id/shred` (tombstone, idempotent re-shred) — FE-503 implements the Step-3 §3.6 typed-`SHRED` pattern verbatim.
   - **E-1…E-4 (billing):** write-off REQUIRES `Idempotency-Key`; audit action canonically `WRITE_OFF`; `WRITTEN_OFF` is sticky terminal (`400 INVOICE_ALREADY_WRITTEN_OFF` on re-pay/re-checkout); balance uses canonical `toSecretPatientBalanceDto` for BOTH roles and complimentary auto-syncs to zero due; `POST /patients/:id/settle` convenience wrapper exists (single-key oldest-first) alongside the per-invoice `pay` loop.
3. **Zero-knowledge (ZK-1…ZK-7):** `Ops*` vs `Clinical*` type families disjoint; `ClinicalApi` + clinical stores cockpit-scoped only; no clinical route/API/model/import reachable from `features/front-desk/**`; no clinical pre-fill into composers; vault plaintext ephemeral in-memory only; titles/toasts/prints clinical-free.
4. **Money (P-10/C-11):** minor-unit integers end-to-end (`Minor` branded type), `Intl.NumberFormat` from `GET /settings` at view edge only, zero float arithmetic. Append-only money UI (no edit-invoice affordance anywhere).
5. **Blindness (P-04/C-12):** close/summary state types contain NO expected-value field pre-reveal; pre-close `result/differenceMinor` render absent (`—`), never `0`; client MUST NOT compute the drawer projection.
6. **Idempotency (C-05):** mint UUIDv4 at user-intent time, persist in `OutboxStore` (`clinic.outbox.v1`) before dispatch, reuse ORIGINAL key on retry/replay, `Idempotent-Replayed: true` = success, `422 IDEMPOTENCY_KEY_REUSE` = terminal hard-stop (fresh intent + new key).
7. **Logic-only CSS (DS-01):** 100% logical properties (`ps/pe/ms/me/start/end/text-start/text-end/border-s/e/rounded-s/e/inset-inline-*`); physical direction tokens/classes/properties banned and CI-failing; `dir=rtl` smoke required from Sprint 0 onward.
8. **Error catalogue:** UI keys off `{error.code + httpStatus}`, never message text; per-code behavior per `02` App. C / `04` §4.

### 0.3 Dependency DAG (sprint order is load-bearing)

```
FE-001 (scaffold) → FE-002 (tokens/css) → FE-003 (interceptors/outbox) → FE-004 (shells/guards skeleton)
 → S1 (FE-101→104: session + guards + login) → S2 (FE-201→205: socket/queue/intake/crisis/board/DnD)
 → S3 (FE-301→306: shift/billing/checkout/pay/debt/petty/blind-close)
 → S4 (FE-401→405: consult queue/MSE/SOAP/sign/meds) → S5 (FE-501→503: vault)
 → S6 (FE-601→605: scribe) → S7 (FE-701→705: intercom/supervision/invariants/audit/hardening)
```

Cross-cutting: `SettingsStore` (FE-001/101) feeds fee/floor/wait/currency everywhere; `OutboxStore` (FE-003) required before ANY money ticket; `QueueStore` (FE-201) required before S3/S4 queue-dependent tickets; `ConsultationStore` (FE-401) required before S5/S6 clinical tickets. No sprint may start until the prior sprint gate is green.

### 0.4 Ticket sizing & sequencing rule

Sprint backlog is strictly sequential within the sprint (FE-201 before FE-204, etc.) unless a ticket explicitly lists "parallelizable after <ID>". Review order = ticket numeric order. Rework from a gate failure re-enters at the failed ticket, not at sprint head.

---

## Sprint 0: Foundation, Tooling, Tokens & Layout Shells (FE-001…FE-004)

**Sprint goal:** bootable shell that compiles, routes, themes, intercepts, and code-splits — with zero clinical content. **Entry:** Steps 1–4 approved (this WBS). **Exit:** `ng build` green, both shells render empty states, interceptor chain unit-tested, bundle audit proves no clinical strings in `front-desk` chunk, RTL smoke passes.

### FE-001 — Angular 19/20 LTS project scaffold (100% Standalone, OnPush default, strict TS, zero-NgModule, zoneless-ready)

- **Clinical objective & persona context:** Establishes the sterile operating theatre for both personas. No clinical behavior; guarantees every later ticket inherits fail-closed typing, deterministic change detection (12-hour shift endurance, no ghost renders), and a single-major upgrade path. Personas affected: build/CI + both cockpits (foundational).
- **Exact files to create/modify:**
  - Create: `package.json` (pin `angular@x.y.z`, `typescript@x.y.z`, `socket.io-client@4`, engines `node>=20`), `angular.json` (budgets per §12), `tsconfig.json` + `tsconfig.app.json` + `tsconfig.spec.json` (verbatim Step-2 §1.4 base), `src/main.ts` (bootstrapApplication only), `src/app/app.component.ts/html/scss` + `app.component.spec.ts`, `src/app/app.routes.ts`, `src/environments/environment.ts` + `environment.prod.ts` (host override only, no secrets), `.eslintrc`/`eslint.config.js` (angular-eslint + `prefer-on-push:error`, `no-ngmodule`, `no-rxjs-outside-boundary`, `no-restricted-imports` skeleton), `.stylelintrc.json` (property-disallowed-list skeleton), `README-FRONTEND.md` (record resolved versions per SPEC-1.1).
  - Modify: none (greenfield).
- **Prerequisites & dependencies:** None (sprint head). Blocks every other ticket.
- **Technical acceptance criteria:**
  1. `bootstrapApplication(AppComponent, {providers:[provideRouter(APP_ROUTES), provideHttpClient(), provideAnimationsAsync()]})` only; zero `NgModule`, zero `BrowserModule`/`HttpClientModule`/`RouterModule.forRoot` — grep for `@NgModule|forRoot|forChild|HttpClientModule` returns zero hits in `src/`.
  2. Every scaffolded component sets `standalone:true` + `ChangeDetectionStrategy.OnPush`;_inputs use `input()` signal form; `strict:true` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `strictTemplates` all ON; `no-explicit-any:error` passes on scaffold.
  3. Zoneless-readiness: no `ApplicationRef.tick()`/`detectChanges()` in product code; state changes flow via signals; `provideZonelessChangeDetection()` flagged plan recorded in `README-FRONTEND.md` (ship MAY remain zoneful).
  4. `APP_ROUTES` skeleton exposes `/login`, `/front-desk` (lazy), `/cockpit` (lazy), `/403`, `/404`, `**→/404` with `canMatch` guard placeholders (full guards in FE-103/FE-004).
  5. Zero-knowledge bound: scaffold contains zero `Clinical*` models, zero `/ehr/|/scribe/|/vault/|/supervision/` strings outside comments referencing this WBS.
- **Ticket gate slice:** `tsc --noEmit` clean; `eslint src --max-warnings=0` clean; `ng build` succeeds (budgets warn-only at this stage).

### FE-002 — Tailwind CSS & Clinical Design System setup (light/dark semantic tokens, 100% logical properties, stylelint ban on physical directions)

- **Clinical objective & persona context:** Gives Desk (velocity/high-density) and Cockpit (calm endurance, night-consult dark mode) their shared legibility substrate. Secretary gets tabular numerals + scanning density; Doctor gets prose measure + indigo/violet authority separation. Contrast failures here injure 8–12 h shift safety.
- **Exact files to create/modify:**
  - Create: `src/styles/themes.css` (verbatim Step-3 App. A token contract: neutrals, brand 50–700, cockpit/scribe violet, ops sky, status emerald/amber/crimson triplets, both modes), `src/styles/typography.css` (font stacks, tabular-nums, type scale Display→Micro-Badge), `src/styles/logical-utilities.css` (start/end helpers), `src/styles/print.css` (receipts printable, `.clinical` print-disabled), `tailwind.config.js` or CSS-first `@theme` block (map utilities → variables, per Step-2 §6.1.3), `src/styles/smoke-rtl.html` (manual RTL fixture for FE-002 verification).
  - Modify: `angular.json` (styles array order: themes→typography→logical→print), `src/index.html` (`<html dir="ltr">`, `class="dark"` toggle hook, `font-display:swap`).
- **Prerequisites & dependencies:** Requires FE-001 (build + lint harness). Blocks FE-004 (shells consume tokens) and all §3 anatomies.
- **Technical acceptance criteria:**
  1. All color surfaces reference `var(--*)`; grep for `bg-[#|text-red-|bg-red-500|text-emerald-` outside `themes.css` returns zero hits; dark mode toggles via `<html class="dark">` + `localStorage clinic.theme`, default follows `prefers-color-scheme`.
  2. Logical-only: banned tokens `pl-* pr-* ml-* mr-* left-* right-* text-left text-right border-l-* border-r-* rounded-l-* rounded-r-* float-left/right` absent from all markup/styles; required equivalents `ps-* pe-* ms-* me-* start-* end-* text-start/end border-s/e rounded-s/e inset-inline-*` used in smoke fixture; stylelint `property-disallowed-list: [padding-left, padding-right, margin-left, margin-right, left, right, border-left, border-right, text-align:left/right literal]` fails on violation; `/* rtl-waiver */` mechanism documented, zero waivers granted in Sprint 0.
  3. Typography: `--font-sans` (Inter + fallbacks) + `--font-mono` (ledger/counters) with `tabular-nums lining-nums`; `Body-L` capped `max-w-[72ch]`; `[dir=rtl]` zeroes letterspacing at Label/Micro-Badge.
  4. Contrast: light+dark pairs from Step-3 §1.7 hold (body ≥7:1 primary, ≥4.5:1 secondary; focus ring ≥3:1); print stylesheet hides `.clinical`.
  5. Zero-knowledge bound: tokens carry no clinical semantics; violet utilities documented AI-only (lint comment), desk smoke fixture contains zero violet classes.
- **Ticket gate slice:** `stylelint "src/**/*.{css,scss}"` clean; `eslint` template `no-physical-classes` clean; `dir=rtl` smoke shows zero horizontal overflow on fixture.

### FE-003 — Foundation HTTP interceptor chain (auth, occVersion, idempotency, refreshToken, errorEnvelope) & Outbox protocol

- **Clinical objective & persona context:** The money-safety and concurrency substrate. Prevents double-charge on flaky clinic Wi-Fi (cashier collects once even if tapped twice), prevents queue overwrites when two terminals drag simultaneously, and guarantees deactivated sessions lock out instantly (C-24). Serves both personas; invisible when healthy, decisive when degraded.
- **Exact files to create/modify:**
  - Create: `src/app/core/net/ops-api.ts` (typed promise facade: auth/settings/queue/billing/shifts/receipts/intercom/followups/audit-secretary-subset), `src/app/core/net/clinical-api.ts` (cockpit-scoped: EHR/meds/vault/scribe — provided in cockpit routes, NOT root), `src/app/core/net/interceptors/auth.interceptor.ts`, `occ-version.interceptor.ts`, `idempotency.interceptor.ts`, `refresh-token.interceptor.ts`, `error-envelope.interceptor.ts`, `src/app/core/net/http-timeout.ts` (15 s default, 120 s audio), `src/app/core/net/idempotency-keys.ts` (UUIDv4 + canonical payload hash), `src/app/core/state/ops/outbox.store.ts` (`OutboxStore`, persisted `clinic.outbox.v1`), `src/app/core/errors/app-error.ts` + `error-catalogue.ts` + `toast.service.ts` (allowlisted copy, clinical-free), `src/app/core/utils/uuid.ts` + `payload-hash.ts` + `money.ts` + `time.ts`, plus co-located `*.spec.ts` for each interceptor + outbox.
  - Modify: `src/main.ts` (`provideHttpClient(withInterceptors([auth, occVersion, idempotency, refreshToken, errorEnvelope]))` in EXACT normative order).
- **Prerequisites & dependencies:** Requires FE-001. Blocks every ticket that dispatches HTTP (i.e., all of S1–S7). Parallelizable with FE-002.
- **Technical acceptance criteria:**
  1. Chain order is exactly `auth → occVersion → idempotency → refreshToken → errorEnvelope`; registration-order test asserts it.
  2. `authInterceptor`: attaches `Authorization: Bearer` from in-memory `AuthStore` (never localStorage) to `/api/v1/*` except `POST /auth/login`, `POST /auth/refresh`, `GET /health`; missing token short-circuits to logout redirect without dispatch.
  3. `occVersionInterceptor` (Q-OCC-1 CORRECTED): for `POST /queue/reorder` + `POST /queue/:id/emergency` reads `QueueStore.queueVersion()` and injects BODY `lastSeenQueueVersion`; asserts body/header parity rule as BODY-only (MUST NOT send `If-Match` on queue routes — interceptor test asserts header absence); if version `-1`, blocks dispatch and forces `loadSnapshot()` first. For `PATCH /ehr/encounters/:id` (E-OCC-1) attaches `If-Match: <rowVersion>` from `ConsultationStore` (doctor scope only); missing version → block with `428`-avoidance error guiding reload.
  4. `idempotencyInterceptor`: route table per `04` App. A (checkout, pay, reverse, write-off, petty, close, check-in, `DOCTOR_COMPLIMENTARY` incl. WS payload key); reuses caller-supplied key (outbox resume), else mints UUIDv4 + `OutboxStore.mint()`; never reuses a key across differing payload hashes; on `422 IDEMPOTENCY_KEY_REQUIRED` retries ONCE with fresh key; replayed `200 + Idempotent-Replayed: true` surfaced as success with `replayed:true`.
  5. `refreshTokenInterceptor`: single-flight 401 recovery (`POST /auth/refresh`, cookie, excluded from auth Bearer), replays queued with ORIGINAL keys; family failure → fail-closed logout + WS disconnect + `/login?reason=session`; `403 deactivated` → immediate lockout incl. `VaultHolder.scrub` signal hook.
  6. `errorEnvelopeInterceptor`: normalizes `{error:{code,message,details}}` → typed `AppError`; per-code dispatch per `02` App. C (field errors, blocking dialogs, silent converge, escalation); unknown codes → generic + incident id; toast copy never includes clinical/vault/expected-cash/SOAP text; MUST NOT retry terminal codes (`REUSE`, `FLOOR_VIOLATION`, `GONE`).
  7. `OutboxStore`: `{key, route, payloadHash, entityId, shiftId, createdAt, state}` persisted BEFORE dispatch; terminal `2xx` removes; `REUSE` marks terminal + hard-stop; PENDING survives logout and offers Resume/Discard after re-login (same actor+shift scope check); holds Ops payloads ONLY (clinical payload entry is a defect, asserted by test).
  8. Zero-knowledge bound: `OpsApi` contains zero `/ehr/|/scribe/|/vault/|/supervision/` path literals (bundle-audit test seed); `ClinicalApi` is NOT `providedIn:root`.
- **Ticket gate slice:** interceptor + outbox unit suites green (auth skip-list, OCC body injection + header absence, mint/reuse/replay/REUSE, single-flight refresh, envelope mapping); `tsc --noEmit` clean.

### FE-004 — Application Layout Shells: Desk Shell (Secretary) vs Cockpit Shell (Doctor) with zero-knowledge code-splitting

- **Clinical objective & persona context:** Gives each persona a home that cannot see the other's plane: Secretary gets high-density lanes + persistent dock + big money targets; Doctor gets centered calm column + indigo wash (consult route only) + privacy blur. Deep-linking a cockpit URL as secretary MUST land on 403 with zero clinical fetch — this ticket proves the split before any feature lands.
- **Exact files to create/modify:**
  - Create: `src/app/app.routes.ts` (final top-level: `/login` public; `/front-desk` lazy + `canMatch:[authGuard,secretaryGuard]`; `/cockpit` lazy + `canMatch:[authGuard,doctorGuard]` + cockpit providers `[ClinicalApi, ConsultationStore, ScribeStore, MedicationStore, VaultHolder, SupervisionStore]`; `/403`; `/404`; `**`), `src/app/features/front-desk/front-desk.routes.ts` (`/`, `/board`, `/receipts`, `/day-summary`, `/followups` skeletons) + `desk-shell.component.*` + `ops-home-placeholder.component.*`, `src/app/features/cockpit/cockpit.routes.ts` (`/`, `/consult/:entryId`, `/chart/:patientId`, `/meds/:patientId`, `/vault/:patientId`, `/admin/users`, `/supervision/*` skeletons) + `cockpit-shell.component.*` + `command-deck-placeholder.component.*`, `src/app/shared/ui/ui-shell-skeleton.component.*` (model-free shimmer), `src/app/core/guards/auth.guard.ts` + `role.guard.ts` (doctor/secretary) + `shift.guard.ts` (modal-gate skeleton) + `vault.guard.ts` (notice-ack skeleton), plus `*.spec.ts` (guard order, DI scoping, deep-link).
  - Modify: `angular.json` (named chunks `front-desk`, `cockpit`; budgets: initial ≤250 kB gz, front-desk ≤350 kB, cockpit ≤600 kB, >10% growth fail), `src/app/app.component.ts/html` (router-outlet + toast host + link-state badge slot).
- **Prerequisites & dependencies:** Requires FE-001, FE-002 (tokens), FE-003 (facade scopes + guard auth source). Blocks ALL S1–S7 feature tickets.
- **Technical acceptance criteria:**
  1. Two-subtree segregation: every branch `loadChildren`/`loadComponent`; eager cross-branch import fails `eslint-plugin-boundaries` + `no-clinical-in-desk`; shared `ui-*` imports zero stores/APIs/models (model-free test).
  2. Guards execute pre-chunk via `canMatch:[authGuard, roleGuard]` then `canActivate:[shiftGuard]`; doctor MAY enter `/front-desk/*` (oversight D-01), secretary→`/cockpit/*` redirects `/403?reason=role` with zero partial render/skeleton leaking field names; network-audit test asserts zero `/ehr/*|/scribe/*|/supervision/*` requests fire on secretary deep-link to cockpit.
  3. DI scoping: `ClinicalApi` + 5 clinical stores resolve in cockpit context and THROW in front-desk context (`TestBed` DI test); `OpsApi` + 8 ops stores resolve everywhere.
  4. Shells: Desk = sticky board header, lane grid, `inset-inline-end` dock slot, ≥40 px money targets; Cockpit = `max-w-[880px]` calm column, `cockpit-wash` ONLY on consult route, one-click `.privacy-blur` toggle + idle-lock hook point; both shells logical-only markup, `text-start/end`, `ps/pe`, drawer/dock mirror in RTL.
  5. Bundle audit: `dist/front-desk-*.js` contains zero `/ehr/|/scribe/|/vault/|/supervision/` + zero `VaultHolder|ScribeStore` identifiers (CI seed test in this ticket, hardened in FE-705).
- **Ticket gate slice:** guard + DI + bundle-audit specs green; RTL smoke (board skeleton + drawer) shows mirrored dock placement, zero overflow.

**Sprint 0 Quality Gate (terminal, ALL must pass):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual: open dist preview, toggle .dark, set dir=rtl on shells — zero overflow, dock mirrors, no console errors
```

---

## Sprint 1: Identity, Authentication & Role Isolation (FE-101…FE-104)

**Sprint goal:** fail-closed identity — login, session restore, role routing, password hygiene, deactivation lockout. **Entry:** Sprint 0 gate green. **Exit:** secretary and doctor each land on their home with correct guard behavior; expired/deactivated sessions cannot reach any protected chunk.

### FE-101 — AuthStore implementation (signal-based auth state, token lifecycle, user profile)

- **Clinical objective & persona context:** Single source of session truth for both personas. Access JWT (~15 min) lives in memory only (never localStorage); refresh rides httpOnly cookie. A stolen-device or deactivated-account scenario MUST lock out in one transition, scrubbing vault (ZK-6) and tearing down WS.
- **Exact files to create/modify:**
  - Create: `src/app/core/state/ops/auth.store.ts` + `auth.store.spec.ts`, `src/app/core/state/ops/settings.store.ts` + `settings.store.spec.ts` (`GET /settings` SecretSafe: fee/currency/wait/floor/retention + `floorMeterFor()` + `currencyFormatter()`).
  - Modify: `src/app/core/net/ops-api.ts` (`login/refresh/logout/me/change-password` methods), `src/app/core/realtime/socket.service.ts` (auth hook stub — full impl FE-201; here: `disconnect()` on logout + token re-announce signature).
- **Prerequisites & dependencies:** Requires FE-003 (interceptors), FE-004 (guard consumption signatures). Blocks FE-102/103/104.
- **Technical acceptance criteria:**
  1. `AuthStore`: `session: ANONYMOUS|AUTHENTICATED`, `me: CurrentUser|null` (from `GET /auth/me` ONLY, never client storage), computed `role()/isDoctor()/isSecretary()/isAuthenticated()`; intents `restore()/login()/logout(failClosed)/handleDeactivated()`; proactive refresh at 80% lifetime + reactive single-flight (delegated to interceptor; store owns timer + `lastRefreshAt`).
  2. Token hygiene: access JWT in-memory signal only; refresh via `POST /auth/refresh` cookie (`withCredentials`); concurrent-401 single-flight 10 s timeout then fail-closed; deactivation → clear ALL stores incl. `VaultHolder.scrub('deactivated')` hook, WS disconnect, `/login?reason=session|deactivated` + "Account deactivated — contact the doctor" toast; no authenticated retry afterward (C-24).
  3. `SettingsStore.load()` works for BOTH roles pre-shift; `floorMeterFor(fee)` + `currencyFormatter()` pure computed; money stays `Minor` integers.
  4. Zero-knowledge bound: `AuthStore`/`SettingsStore` hold zero clinical fields; `me` contains id/name/role only.
- **Ticket gate slice:** `auth.store.spec` (login/restore/logout/deactivation/refresh-timer) + `settings.store.spec` green; `tsc --noEmit` clean.

### FE-102 — Login View with credentials validation, error banner, and autofocus

- **Clinical objective & persona context:** Shift-start gate for both personas (shared terminal, fast handoff). Must be fast, keyboard-complete, and leak nothing about which identifier exists (no user-enumeration oracle).
- **Exact files to create/modify:**
  - Create: `src/app/features/auth/login.component.ts/html/scss/spec.ts` (public chunk), `src/app/shared/forms/login.form.ts` (typed `FormGroup`, nonBlank + strength-hint validators), `src/app/shared/i18n/auth.copy.ts` (allowlisted error copy).
  - Modify: `src/app/app.routes.ts` (`/login` → `loadComponent`, `returnUrl` query passthrough; authenticated already → role-home redirect preserving outbox PENDING).
- **Prerequisites & dependencies:** Requires FE-101. Blocks FE-103 (guard redirect target must exist).
- **Technical acceptance criteria:**
  1. Typed reactive form (`identifier`, `password`); empty/blank blocked client-side; server `401` → generic "Invalid credentials" banner (identical for bad-identifier vs bad-password); `403 deactivated` → lockout screen path (no retry); `422` → inline `newPassword`-style field errors where applicable; `500+incidentId` → generic + incident id + Report affordance.
  2. UX: autofocus identifier on mount; Enter submits; `returnUrl` replayed after success; duplicate-submit ignored (in-flight disables CTA, no double `POST /auth/login`); document title generic ("Clinic — Sign in", never clinical).
  3. Zero-knowledge bound: login bundle contains zero Ops/Clinical models beyond `identifier/password` strings.
- **Ticket gate slice:** login spec (validation matrix, autofocus, double-submit, 401/403/422/500 mapping) green; eslint OnPush/input rules clean.

### FE-103 — Role-based Route Guards (AuthGuard, DoctorGuard, SecretaryGuard) with fail-closed redirects

- **Clinical objective & persona context:** The legal bulkhead. Secretary MUST have no registered URL returning clinical data — not even hidden. Doctor retains oversight entry to Desk. Every unauthorized navigation fails CLOSED (403, no fetch, no skeleton leak).
- **Exact files to create/modify:**
  - Create: `src/app/core/guards/auth.guard.ts` + `role.guard.ts` + `guards.spec.ts` (functional `CanActivateFn`/`CanMatchFn`, cold-boot `GET /auth/me` restore path), `src/app/features/auth/forbidden.component.*` (`/403?reason=role|vault`), `not-found.component.*` (`/404`).
  - Modify: `src/app/app.routes.ts` + `front-desk.routes.ts` + `cockpit.routes.ts` (wire `canMatch:[authGuard, roleGuard]` + `canActivate:[shiftGuard]` where applicable; cockpit providers already in FE-004).
- **Prerequisites & dependencies:** Requires FE-101, FE-102. Blocks every S2+ feature route.
- **Technical acceptance criteria:**
  1. `authGuard`: valid session required else `/login?returnUrl=<encoded>` preserving outbox PENDING; cold boot performs single `GET /auth/me` restore, no other authenticated fetch.
  2. `doctorGuard`/`secretaryGuard` resolve `me.role` from `AuthStore` (server-resolved); secretary→cockpit = `/403?reason=role` with zero clinical fetch (network-audit spec asserts no `/ehr|/scribe|/supervision` dispatch); doctor→front-desk allowed; guards pure (no WS/HTTP except the one restore).
  3. `shiftGuard` skeleton wired (cashier routes gate on OPEN shift; full behavior FE-301): no OPEN shift → `OpsShiftOpenDialog` modal gates mutations (route stays); CLOSED → read-only + disabled mutation controls (INV-9).
  4. `vaultGuard` skeleton wired (extends doctorGuard + notice-ack; full behavior FE-501).
- **Ticket gate slice:** guard specs (matrix: anon→login, secretary→cockpit 403 + zero-fetch, doctor→desk allowed, cold-boot restore single-call) green.

### FE-104 — Password rotation modal & force-logout handling via WebSocket notification

- **Clinical objective & persona context:** Shared-terminal hygiene: scheduled rotation + admin-deactivation propagate instantly so an ex-staff session cannot collect cash or read charts. Applies to both personas; doctor deactivating self requires typed confirm.
- **Exact files to create/modify:**
  - Create: `src/app/features/auth/change-password-sheet.component.ts/html/scss/spec.ts` (`POST /auth/change-password` + re-auth confirm), `src/app/core/state/ops/session-events.ts` (deactivation/force-logout event → `AuthStore.handleDeactivated()` + WS teardown).
  - Modify: `src/app/core/net/ops-api.ts` (change-password typed method), `src/app/core/state/ops/auth.store.ts` (rotation → session rotate, keep outbox PENDING money intents), desk/cockpit shells (settings entry point opening the sheet).
- **Prerequisites & dependencies:** Requires FE-101–FE-103, FE-201 socket skeleton (subscribe to use; this ticket only consumes the disconnect/notify contract — full SocketService lands in FE-201, so FE-104 implements the store side behind an interface to avoid ordering deadlock).
- **Technical acceptance criteria:**
  1. Rotation: `oldPassword` + `newPassword` (Zod strength rules mirrored), `422` → inline field error; success rotates session without dropping outbox PENDING; toast "Password updated".
  2. Force-logout: on `403 deactivated` (any call) or WS `connect_error(403)`/deactivation frame → immediate lockout: scrub vault, clear clinical stores, disconnect WS, redirect login, toast; no retry of authenticated calls.
  3. Self-deactivation (doctor admin path, FE-701 surface reuse): typed confirm + immediate own-session lockout if own id.
- **Ticket gate slice:** change-password + force-logout specs green; `tsc --noEmit` clean.

**Sprint 1 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx ng test --watch=false --browsers=ChromeHeadless --include="**/auth.*spec.ts" --include="**/guards*spec.ts" --include="**/settings*spec.ts"
npx ng build --configuration production
# + manual: login as each role → correct home; paste /cockpit/* URL as secretary → /403 with zero clinical network calls (DevTools)
```

---

## Sprint 2: Front Desk Live Smart Queue & Triage (FE-201…FE-205)

**Sprint goal:** the single shared source of truth — live board both cockpits render, with OCC-correct mutation. **Entry:** S1 gate green + backend BE queue routes available (per `BACKEND_TASKS_WBS` order). **Exit:** two browsers (desk + doctor) converge on every queue mutation in <1 s; stale drag recovers with snap-back + toast, never divergence.

### FE-201 — SocketService singleton & QueueStore implementation (consuming queue.snapshot ops shape)

- **Clinical objective & persona context:** Real-time waiting-room truth for Desk (flow) and Doctor (command). Replaces shouting across the corridor: check-in appears on doctor deck instantly; call-next appears on desk board instantly. Degrades to snapshots, never invention (P-09).
- **Exact files to create/modify:**
  - Create: `src/app/core/realtime/socket.service.ts` + `socket.service.spec.ts` (singleton, `socket.io-client@4`, `websocket` primary + polling fallback, `auth:{token}`, rooms `clinic:queue` + `clinic:intercom` both roles, `supervision.discrepancy` doctor-only, heartbeat 25 s/10 s timeout, backoff 0.5→1→2→5→15 s + jitter, `linkState: DISCONNECTED|CONNECTING|LIVE|DEGRADED|RECONNECTING`), `src/app/core/realtime/queue-ingest.ts` + `frame-guards.ts` (Zod per-frame, R-2 boundary), `src/app/core/rx-boundary/ws-bridge.ts`, `src/app/core/state/ops/queue.store.ts` + `queue.store.spec.ts`, `src/app/core/state/ops/followup.store.ts` (skeleton for D-13 loop; full board FE-701).
  - Modify: `src/app/core/net/ops-api.ts` (`GET /queue`, `GET /queue/wait-times`, queue mutations per `04` §1.3), `src/app/app.component.*` (link-state badge consuming `linkState`).
- **Prerequisites & dependencies:** Requires S0 + FE-101 (auth token source). Blocks FE-202–FE-205, S3/S4 queue-dependent tickets, FE-701 intercom (shares socket).
- **Technical acceptance criteria:**
  1. **Wire correction applied:** initial bootstrap = `GET /queue` (SecretSafe) + `queue.subscribe {shiftId}` → immediate `queue.updated` snapshot (`{queueVersion, shiftId, avgConsultDurationMin, serverAt, entries[]}`). Charter term "`queue.snapshot`" maps to `queue.updated` — no other frame mutates order. `entries[]` order = render order; `position`/`estimatedWaitMin` rendered verbatim, never recomputed (P-09/C-20).
  2. Frame routing: `queue.updated` → full replace; `queue.called/reordered/emergency/undoComplete` → version-gate then targeted patch or resync; `billing.invoiceUpdated` → `BillingStore` totals patch (stub hook; full store FE-301); `intercom.received` → `IntercomStore` append (stub hook); `supervision.discrepancy` → doctor-only channel (handler lives in cockpit chunk ONLY — bundle test asserts absence from front-desk chunk).
  3. Version gate (normative): `frame.queueVersion <= cur` → drop-stale; `=== cur+1` → apply; jump → `GET /queue` resync, never delta across a jump. Reconnect replays Bearer + subscribe + snapshot + intercom gap-fill; convergence <1 s broadband.
  4. Degradation: DEGRADED/RECONNECTING → amber "Offline — showing last confirmed queue v{N} · {serverAt}" + DnD disabled (reorder requires LIVE) + 15 s REST poll; never extrapolate positions/balances (C-09). Queue mutations travel REST ONLY (no WS mutation path).
  5. Zero-knowledge bound: frames are SecretSafe identical for both roles; doctor supervision room is additive only; no clinical keys in any queue frame (allowlist snapshot test).
- **Ticket gate slice:** socket lifecycle + version-gate + resync specs green (stale-drop, contiguous-apply, jump-resync, reconnect handshake, degraded badge contract).

### FE-202 — Patient Rapid Intake & Search component (Ctrl+K, phone/national ID/name lookup)

- **Clinical objective & persona context:** Secretary sub-second check-in for returning patients (S-01) + rapid registration entry (S-02) + duplicate-candidate discipline. Debt alert surfaces here (totals + `hasDebtAlert` only, never visit linkage).
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-checkin-dialog.component.ts/html/scss/spec.ts`, `src/app/features/front-desk/ops-patient-registration-wizard.component.ts/html/scss/spec.ts` (stepped core-identity capture), `src/app/core/rx-boundary/search-stream.ts` (R-1: `debounceTime 250–350 ms`, `distinctUntilChanged`, `switchMap`, `takeUntilDestroyed` → `toSignal`), `src/app/shared/forms/patient-identity.form.ts` (typed validators incl. `adminNotes ≤500` counter).
  - Modify: `src/app/core/net/ops-api.ts` (`GET /patients/search`, `POST /patients`, `GET /patients/:id`, `PATCH /patients/:id`), `src/app/core/state/ops/queue.store.ts` (`checkIn()` intent incl. debt-ack retry).
- **Prerequisites & dependencies:** Requires FE-201 (QueueStore), FE-101 (settings for nothing yet — fee not needed here). Blocks FE-203 (crisis reuses search lite), FE-204 (board check-in entry point).
- **Technical acceptance criteria:**
  1. Search: `Ctrl+K` focuses dialog; debounced multi-field (`phone/nationalId/name`) via `GET /patients/search`; rows show `fullName/phone/nationalId/lastVisitAt(hasDebtAlert + outstandingBalanceMinor)`; keyboard navigation + Enter check-in; empty query emits `[]` without HTTP; no auto-merge (server `409 candidate` owns identity).
  2. Check-in: `POST /queue/check-in` with pre-minted `Idempotency-Key`; two-step debt flow is NOT an error — `200 {advisory debtAlert, debtAlert}` pivots dialog to ack step, retry with `acknowledged:true` + SAME key; `409 duplicate open entry` → existing entry + "jump to queue"; `409 SHIFT_LOCKED` → bounded same-key retry (250/750/2000 ms).
  3. Registration: captures EXACT contract body (name/age/phone?/nationalId?/emergencyContact/address/adminNotes≤500); `409 candidate` → side-by-side "use existing" vs override-if-permitted; `201` → offer immediate check-in chain (S-01 tail).
  4. Crisis-lite hook: identifier-or-lite path delegates to FE-203 dialog (no duplication).
  5. Zero-knowledge bound: search/detail/balance payloads typed `SecretSafe`; `pastVisitTimestamps` rendered as dates only; no composite visit card (ZK-4).
- **Ticket gate slice:** search-stream (debounce/cancel/empty-no-http) + check-in advisory debtAlert + 409-candidate specs green.

### FE-203 — Crisis Intake Modal (crisis:true bypass flow for psychiatric emergencies)

- **Clinical objective & persona context:** Psychiatric emergency fast path (S-03): agitated patient or distressed family cannot wait for full identity. Minimal friction, maximal safety: emergency anchor only, position 0, full record completed later. Persistent crisis banner until unflagged.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-crisis-intake-dialog.component.ts/html/scss/spec.ts`, `src/app/features/front-desk/crisis-banner.component.ts/html/scss/spec.ts` (`role=alert`, crimson, sticky, persistent).
  - Modify: `src/app/core/state/ops/queue.store.ts` (`checkIn` emergency path), `src/app/features/front-desk/ops-checkin-dialog.component.*` (handoff entry "Crisis intake" switching to this dialog).
- **Prerequisites & dependencies:** Requires FE-202 (search lite + check-in intent). Blocks nothing downstream (parallelizable with FE-204 after FE-201).
- **Technical acceptance criteria:**
  1. Modal deliberately SHORT: identifier (search-or-lite) + emergency anchor ONLY (contact name+phone+relation, all required) + one-line operational note (capped, ZK-5 hint visible) + `isEmergency:true` + reason (prefilled "crisis intake", editable, required). NO full identity, NO fee, NO debt step. CTA "Admit to position 0" (crimson-solid/white 5.9:1) disabled until anchor valid; idempotency key minted at confirm, duplicate taps ignored.
  2. Dispatch `POST /queue/check-in {isEmergency:true, emergencyReason}`; success → banner increments + board row at 0 with `queue.called`-grade flash + toast with new `queueVersion`; full record completed later via `PATCH /patients/:id` (separate surface, not this dialog).
  3. Banner: `bg(--alert-emergency-bg)`, pulse dot (1600 ms, `motion-reduce` static), "Crisis intake — N emergency waiting · position 0 held" + Review button; never auto-dismisses.
  4. Accessibility: `role=alertdialog aria-modal`, focus trap, initial focus identifier, Esc cancels restoring invoker focus, SR announces "Emergency entry, position zero".
  5. Zero-knowledge bound: note composer shows "Operational only — never type diagnoses, drug names, or findings"; no clinical pre-fill; char cap enforced.
- **Ticket gate slice:** crisis admit + banner persistence + a11y specs green.

### FE-204 — Live Waiting Room Queue View (patient cards, status transitions, wait-time estimator)

- **Clinical objective & persona context:** The Desk's primary instrument (S-04/S-06/S-07) and the Doctor's read/command surface (D-02 read side). One ordered list both roles trust; secretary transitions limited to `requeue`, everything else read-only with actor attribution.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-waiting-room-board.component.ts/html/scss/spec.ts`, `queue-patient-card.component.*` (Step-3 §3.1 anatomy verbatim), `emergency-flag-dialog.component.*` (reason-required both directions), `src/app/features/front-desk/queue-lane.component.*` (WAITING/IN_CONSULTATION/COMPLETED/SKIPPED grouping preserving `position` order).
  - Modify: `src/app/core/state/ops/queue.store.ts` (`loadSnapshot/requeue/flagEmergency/no-show` intents), `src/app/features/front-desk/front-desk.routes.ts` (`/board` wiring + `shiftGuard`).
- **Prerequisites & dependencies:** Requires FE-201, FE-202 (check-in feeds board). Blocks FE-205 (DnD layers onto these rows).
- **Technical acceptance criteria:**
  1. Renders `GET /queue` + `queue.updated` frames: `position/isEmergency badge/estimatedWaitMin/checkedInAt` + status chips (WAITING ops-info / IN_CONSULTATION indigo read-only desk-side / COMPLETED neutral / SKIPPED faint-dashed, always icon+text, never color-only); header shows `avgConsultDurationMin` + head-of-queue "now serving in ≈ X min" from `GET /queue/wait-times` verbatim.
  2. Secretary-visible transition LIMITED to `requeue` (SKIPPED→WAITING, `POST /queue/:entryId/requeue` with current `lastSeenQueueVersion` in body); call/skip/complete/undo render read-only with WS actor attribution; `400 ILLEGAL_TRANSITION` unreachable by design (illegal buttons disabled) and handled as snapshot convergence if ever observed. `POST /queue/:entryId/no-show` desk-enabled renders skipped lane.
  3. Emergency: per-row flag/unflag dialogs both require reason (`EMERGENCY_FLAG/UNFLAG` audit); flagged row pins at 0 with crimson ring + reason excerpt; unflag re-requires reason. Client NEVER recomputes order/position/wait.
  4. States: initial `GET` skeleton shimmer ONLY; WS patches never skeleton (no flicker); stale suffix `· v{N}` when DEGRADED; keyboard listbox (arrows/Enter, Space-lift DnD reserved for FE-205).
- **Ticket gate slice:** board render + requeue-only + emergency pin + wait-verbatim specs green; logical-properties lint clean on new templates.

### FE-205 — Drag-and-Drop Queue Reordering with server-side OCC (lastSeenQueueVersion) & 409 stale queue recovery toast

- **Clinical objective & persona context:** Secretary flow control when the waiting room reality changes (late arrival, child, distressed patient needs adjacency) — with structural protection: emergency rows can never be buried, and a concurrent terminal (two secretaries + doctor calling) can never silently overwrite order.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/queue-dnd.directive.ts` + `queue-dnd.directive.spec.ts` (drag handles WAITING-only, keyboard Space/arrows/Enter/Esc), `src/app/core/state/ops/reorder-intent.ts` (ghost + `pendingIntent` types).
  - Modify: `src/app/features/front-desk/ops-waiting-room-board.component.*` + `queue-patient-card.component.*` (ghost `opacity-70 shadow-elevated`, `border-s-4 brand` drop indicator on inline-start edge), `src/app/core/state/ops/queue.store.ts` (`reorder()` + `applyOptimisticReorder/revertToSnapshot`), `src/app/core/net/interceptors/occ-version.interceptor.ts` (reorder body injection — already built FE-003, wired here).
- **Prerequisites & dependencies:** Requires FE-204 (rows), FE-201 (version source), FE-003 (OCC + idempotency). Terminal ticket of Sprint 2.
- **Technical acceptance criteria:**
  1. Drag handles on WAITING rows ONLY; emergency rows pinned (drop-below-position-0 targets disabled with "locked at top until unflagged" tooltip); non-WAITING rows non-draggable; DnD disabled unless WS LIVE ("Queue offline — reconnecting" tooltip).
  2. On drop: send `POST /queue/reorder {orderedEntryIds (WAITING set), lastSeenQueueVersion}` + `Idempotency-Key` (Q-OCC-1: NO `If-Match` header — spec asserts header absence); `-1` version blocks dispatch → `loadSnapshot()` first. Optimistic ghost renders instantly.
  3. `409 STALE_QUEUE` (with current snapshot): `revertToSnapshot` (instant snap, no masking animation) + warning toast "Queue changed under you (v{old}→v{new}). Review and retry." + "Review board" focusing changed rows; NEVER auto-retry the drag (C-01). Retry re-issues with new `lastSeenQueueVersion` + SAME key if payload identical, new key if edited.
  4. `422` (burying emergency / non-WAITING in set) structurally unreachable; if observed, converge + guidance toast.
  5. Zero-knowledge bound: reorder payload contains ids + version only — zero identity/clinical content beyond existing row ids.
- **Ticket gate slice:** DnD (mouse + keyboard) + OCC body + 409 snap-back + no-auto-retry specs green.

**Sprint 2 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual two-browser: desk check-in → doctor deck <1s; doctor call-next → desk board <1s; concurrent drag → loser gets snap-back + toast, boards identical
```

---

## Sprint 3: Cashier Desk, Invoicing, Debt & Blind Shift Close (FE-301…FE-306)

**Sprint goal:** POS-grade cashier that cannot double-spend, cannot see the drawer projection, and cannot edit money. **Entry:** S2 gate green + backend billing/shift routes available. **Exit:** full `complete → shell → checkout → pay → summary → blind-close` spine green with idempotent replay treated as success and blind-reveal coming ONLY from persisted `200`.

### FE-301 — ShiftStore & BillingStore implementation (cashier state, blind-count discipline)

- **Clinical objective & persona context:** Cashier memory: which shift is OPEN, which invoices are owed, which receipts exist — with blindness-by-absence built into the TYPE system (P-04) so a curious template cannot leak the projection.
- **Exact files to create/modify:**
  - Create: `src/app/core/state/ops/shift.store.ts` + `shift.store.spec.ts` (`currentShift`, blind-aware `summary` with NO expected field pre-close, `isOpen()/canAttemptClose()/postCloseResult()`, intents `open/loadSummary/closeBlind/forceCloseWithReason(doctor)`), `src/app/core/state/ops/billing.store.ts` + `billing.store.spec.ts` (`invoices/receipts/balanceByPatient` maps, `outstandingFor/oldestFirstLines`, intents `checkout/payInvoice/reverseReceipt(doctor)/writeOff(doctor)/allocateOldestFirst/settlePatient/complimentary(doctor)`), `src/app/core/state/ops/shift-models.ts` + `billing-models.ts` (branded `Minor`, blind-aware summary union: `OpenSummary{result:null,differenceMinor:null}` vs `ClosedSummary{triplet+result}`).
  - Modify: `src/app/core/net/ops-api.ts` (billing/shift/receipt typed methods per `04` §1.4), `src/app/features/front-desk/ops-shift-open-dialog.component.*` skeleton (OPEN per date, `openingFloatMinor` — the ONLY Phase-1 float top-up, GAP-04).
- **Prerequisites & dependencies:** Requires FE-003 (outbox), FE-201 (invoiceUpdated hook), FE-101 (settings: fee/currency). Blocks FE-302–FE-306.
- **Technical acceptance criteria:**
  1. `ShiftStore`: shift id in `sessionStorage`; `actualCountedMinor` draft NEVER persisted (reload forces re-entry); `canAttemptClose()` = zero open WAITING/IN_CONSULTATION (else `422` path or doctor force-with-reason audited); CLOSED terminal — post-close corrections via new-date adjustment invoice only (INV-9), zero reopen affordance.
  2. `BillingStore`: reconciles displayed `collected` to server (`billing.invoiceUpdated`/invoice reads, INV-1); allocation stops at zero per line (INV-2); discount exists ONLY at creation, post-creation shortfalls → pay or doctor write-off (INV-3); reverse once per CHARGE with linkage chain (INV-4); floor meter live, breach routes to doctor (INV-6); petty disabled on CLOSED, no delete (INV-7); never compute drawer projection (INV-8); every sensitive intent captures reason BEFORE dispatch (INV-10).
  3. `WRITTEN_OFF` sticky terminal (E-3): pay/re-checkout on it → `400 INVOICE_ALREADY_WRITTEN_OFF` terminal banner, controls disabled with forward guidance.
  4. Zero-knowledge/binding: stores typed `SecretSafe` Ops models only; `ClinicalApi` untouched.
- **Ticket gate slice:** store specs (blind-aware types, terminal states, INV mapping incl. `WRITTEN_OFF`) green.

### FE-302 — Checkout Modal: suggested fee, manual override, discount floor warning (422 DISCOUNT_BELOW_FLOOR)

- **Clinical objective & persona context:** Secretary one-click billing after doctor `complete` (S-08/S-09/S-10): suggested fee → adjust → reason → collect. Protects practice revenue (floor) without blocking legitimate raises; breach guidance routes to doctor, never silent escalation.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-billing-checkout-sheet.component.ts/html/scss/spec.ts` (Step-3 §3.3 anatomy verbatim: header context + shell chip, fee block, reason block, method block, collected block, footer idem+version chips).
  - Modify: `src/app/core/state/ops/billing.store.ts` (`checkout()`), `src/app/features/front-desk/ops-waiting-room-board.component.*` (checkout entry point from COMPLETED rows).
- **Prerequisites & dependencies:** Requires FE-301. Blocks FE-303 (method presets render inside this sheet), FE-304 (pay-down pivot target).
- **Technical acceptance criteria:**
  1. Prefills `standardFeeMinor` from `SettingsStore`; raise free; lower arms reason field + floor meter (`secretaryMaxDiscountMinor` absolute cap vs `secretaryMaxDiscountPct`, tighter wins) as live `role=progressbar`; empty-string reason never satisfies (P-06, nonBlank); breach disables CTA + shows "Requires doctor" card routing to complimentary (doctor widget) / write-off (doctor flow).
  2. Tolerates both shell states: "shell exists" (set fee + collect) and "no shell yet"; `409 already invoiced` pivots sheet to pay-down mode (amounts preserved, CTA swaps to "Pay down", never an error page). Auto-created UNPAID shell carries zero-amount CHARGE traceability row (DB-07) — sheet explains "completing a visit, not creating one".
  3. Dispatch `POST /billing/checkout {queueEntryId, collectedMinor, finalFeeMinor?, discountReason?, method?}` + pre-minted key; `Idempotent-Replayed` = success (single toast, reconcile to original, no double navigation); `422` reason codes focus the justification field; `403 FLOOR_VIOLATION` → breach card + audit notice; `409 SHIFT_LOCKED` → "Drawer busy — Retry (same key held)".
  4. Amount display `aria-live=polite` (formatted totals, never raw minor ints); append-only (no edit-invoice control anywhere).
- **Ticket gate slice:** checkout specs (prefill/raise/lower+reason/floor-meter/breach/409-pivot/replay-success) green.

### FE-303 — Multi-channel payment recording (Cash, Transfer, Mobile Wallet mapped to CASH/OTHER)

- **Clinical objective & persona context:** Egyptian-clinic reality: cash drawer + instant transfers + wallets. Cashier taps one preset; persistence stays enum-clean (`CASH|OTHER`) so INV-1/INV-8 derivations hold; preset label survives only as UI/print context (GAP-10).
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/payment-method-presets.component.ts/html/scss/spec.ts` (3 presets + `aria-pressed`, quick-amount chips: exact fee / exact outstanding / custom).
  - Modify: `src/app/features/front-desk/ops-billing-checkout-sheet.component.*` + debt sheet (FE-304) + settle panel (embed presets), `src/app/core/utils/money.ts` (preset→enum map + formatter).
- **Prerequisites & dependencies:** Requires FE-302 (host sheet). Parallelizable with FE-304 after FE-301.
- **Technical acceptance criteria:**
  1. Presets: Cash→`CASH`, Transfer→`OTHER`, Wallet→`OTHER`; pressed state uses `aria-pressed` + brand wash; quick chips feed `collectedMinor`; wire enum is ONLY `CASH|OTHER` (spec asserts no label string leaves the client except print template context).
  2. Receipt rendering/printing uses preset label from client context + persisted `method` from `GET /receipts/:id`; open-shift receipt archive for secretary stays suppressed (GAP-03 client rule — FE-304/702 surfaces enforce).
  3. Zero-knowledge bound: method block contains zero clinical content.
- **Ticket gate slice:** preset→enum map + chip-feed + print-context specs green.

### FE-304 — Debt Pay-down & Settlement View (oldest-first allocation across open invoices)

- **Clinical objective & persona context:** Chronic-care reality: patients carry balances across visits (S-12). Check-in shows `hasDebtAlert`; this surface retires debt oldest-first so the oldest obligation clears first (fair + auditable). Two execution paths: single-call `settle` where adopted, sequential `pay` loop otherwise.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-debt-settlement-sheet.component.ts/html/scss/spec.ts`, `ops-patient-balance-panel.component.*` (drawer: identity header + ledger `lines[]` oldest-first + pay entry), `src/app/core/state/ops/oldest-first.ts` + `oldest-first.spec.ts` (C-07 engine: date-asc sort, per-line zero-stop, running remainder meter).
  - Modify: `src/app/core/state/ops/billing.store.ts` (`payInvoice/settlePatient/allocateOldestFirst`), `src/app/features/front-desk/ops-checkin-dialog.component.*` (`hasDebtAlert` badges on rows/dialog/queue rows).
- **Prerequisites & dependencies:** Requires FE-301 (+ FE-302 pivot contract, FE-303 presets). Blocks nothing (parallelizable with FE-305/306 after FE-301).
- **Technical acceptance criteria:**
  1. Lists `GET /patients/:id/balance` `lines[]` oldest-first (canonical `toSecretPatientBalanceDto`, BOTH roles identical shape — E-4); COMPLIMENTARY lines contribute zero due and are excluded from `outstandingMinor` (no manual refresh needed); each `POST /billing/invoices/:id/pay {collectedMinor>0, method?}` carries its OWN key (never changes `finalFee`); running "remaining to allocate" meter; `400` on PAID/COMPLIMENTARY/`WRITTEN_OFF` → terminal banner pivot (E-3).
  2. Alternate single-intent path: `POST /patients/:id/settle {amountMinor>0, method?}` (one key) → renders `applied[] + remainderMinor`; UI prefers `settle` when available, falls back to sequential loop on `404/501` (probe-settle-first, studio-guarded — exactly one path executes per user intent).
  3. `400` already-reversed/pay-on-PAID pivots to current-state view, never an error page.
- **Ticket gate slice:** oldest-first engine + settle-vs-loop + terminal-banner specs green.

### FE-305 — Petty Cash Drawer Flow (EXPENSE deducts, INJECTION adds, mandatory purpose)

- **Clinical objective & persona context:** Drawer discipline for consumables (tissues, printing, emergency transport): every deduction is explained (S-15, INV-7/INV-10). Phase-1 CORRECTED posture: EXPENSE-only (GAP-04 — no `INJECTION` wire/model exists, INV-8 deducts all petty); float top-ups happen ONLY at shift open via `openingFloatMinor` (FE-301 dialog).
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-petty-cash-sheet.component.ts/html/scss/spec.ts` (`amountMinor>0` + mandatory non-blank `purpose`, one key per entry, list via `GET /shifts/:id/petty`).
  - Modify: `src/app/core/state/ops/shift.store.ts` (petty intent + `lockShift` contention path), `src/app/features/front-desk/ops-day-summary-page.component.*` skeleton (petty section hook — full page FE-702-adjacent desk variant in this sprint per §3 S-17; doctor supervision summary extends in FE-702).
- **Prerequisites & dependencies:** Requires FE-301. Parallelizable with FE-304/306.
- **Technical acceptance criteria:**
  1. `POST /shifts/:id/petty` OPEN-shift only (`lockShift` server-side); disabled on CLOSED (INV-9); no delete affordance (INV-7); empty purpose blocked client-side AND `422` mapped back to the field; each entry its own key; `409 SHIFT_LOCKED` bounded same-key retry.
  2. UI offers EXPENSE only; any `INJECTION` affordance is a DEFECT (GAP-04 test asserts no injection control/string in template); top-up guidance points to shift-open float.
  3. Day-summary petty section renders `pettyTotalMinor + items[]` from `GET /shifts/:id/summary`.
- **Ticket gate slice:** petty validation + EXPENSE-only + CLOSED-disabled specs green.

### FE-306 — Blind Shift Close Procedure: cash counting input, masking expected cash (---), revealing difference (BALANCED/SURPLUS/DEFICIT)

- **Clinical objective & persona context:** End-of-day integrity ritual (S-16): counter counts the drawer BLIND so the count cannot chase the projection. Only after persistence does the system reveal whether the drawer balances — discrepancies route to resolve-or-escalate, never to silent edit.
- **Exact files to create/modify:**
  - Create: `src/app/features/front-desk/ops-blind-drawer-close-dialog.component.ts/html/scss/spec.ts` (two strict phases: count-entry bare input → reveal triplet + result word), `src/app/features/front-desk/ops-day-summary-page.component.ts/html/scss/spec.ts` (S-17: totals served, gross/net, petty, method breakdown, discount/write-off/complimentary/reversal counts; pre-close expected/difference slots ABSENT).
  - Modify: `src/app/core/state/ops/shift.store.ts` (`closeBlind(actualCountedMinor)`), `src/app/features/front-desk/front-desk.routes.ts` (`/day-summary` wiring).
- **Prerequisites & dependencies:** Requires FE-301 (+ FE-305 petty totals for summary). Terminal ticket of Sprint 3.
- **Technical acceptance criteria:**
  1. Phase 1 (count entry): BARE numeric input for `actualCountedMinor` ONLY — no expected value, hint, history, or computed projection anywhere in DOM/state type (P-04/C-12, FT-5); placeholder `0.00` is input affordance with `aria-label="Actual counted cash"` + helper "Count the drawer, then enter. Expected stays hidden until you confirm."; submit once via `POST /shifts/:id/close` + key; draft NEVER persisted.
  2. Phase 2 (reveal, ONLY after persisted `200`): render `{expectedCashMinor, actualCountedMinor, differenceMinor, result}` in mono + `result` word in Display type: `BALANCED` emerald / `SURPLUS` ops-sky / `DEFICIT` amber + next-step guidance; reveal animation 200 ms (`motion-reduce` instant); data from response ONLY, never computed (`openingFloat + ΣCASH CHARGE − ΣCASH REVERSAL − Σpetty` preview is a DEFECT).
  3. `422` open-entries-remaining → "resolve queue" (non-doctor path) or doctor force-with-reason (audited); `409 INVARIANT_VIOLATION + discrepancies[]` → resolve-or-escalate into FE-703 surface; `400` already CLOSED → read-only summary; pre-close summary renders null slots as `—`, never `0`.
  4. Accessibility: result `role=status`, amounts `aria-live`, destructive-adjacent confirm dual-tap.
- **Ticket gate slice:** blind-absence (no expected selector/field pre-reveal) + reveal-from-response-only + 422/409 routing specs green (FT-5 seed).

**Sprint 3 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual: complete → shell → checkout(below-floor breach → doctor path) → pay → debt oldest-first → petty → blind close(BALANCED + DEFICIT rehearsals); replay same key → single receipt, Idempotent-Replayed success
```

---

## Sprint 4: Doctor Clinical Cockpit, Manual SOAP & Titration (FE-401…FE-405)

**Sprint goal:** calm consultation instrument — command the queue, chart explicitly, sign authoritatively, titrate safely. **Entry:** S3 gate green + backend EHR/medication routes available. **Exit:** doctor can run a full visit without scribe/vault: call-next → MSE → manual SOAP → sign → addendum → meds/titration, with unsigned backlog tracked.

### FE-401 — ConsultationStore & Live Consultation Queue Controller ("Call Next", Skip, Undo-complete)

- **Clinical objective & persona context:** Doctor authority over flow (D-02): one-thumb Call Next (incl. force path), reversible Skip, windowed Undo-complete. Every command shows its `queueVersion` + WS echo so doctor and desk never disagree about who is in the room.
- **Exact files to create/modify:**
  - Create: `src/app/core/state/clinical/consultation.store.ts` + `consultation.store.spec.ts` (doctor scope: `activeEntryId`, `encounterDraft`, `signedChart`, `isDraftDirty/unsignedBacklog(GAP-02 local roster)`), `src/app/features/cockpit/doctor-command-deck.component.ts/html/scss/spec.ts`, `doctor-directives-widget.component.*` (floating: Call-Next / Complimentary / Follow-up — complimentary/follow-up dispatch in FE-701/S3 hooks, widget skeleton here).
  - Modify: `src/app/core/state/ops/queue.store.ts` (`callNext/skip/requeue/complete/undoComplete` doctor intents), `src/app/core/net/ops-api.ts` (C-3 global `call-next` + C-4 per-entry `call` + skip/requeue/complete/undo-complete/no-show/abandon/debt-ack), `src/app/features/cockpit/cockpit.routes.ts` (`/` deck wiring).
- **Prerequisites & dependencies:** Requires FE-201 (queue truth), FE-301 (complete→shell chain), FE-103 (doctorGuard). Blocks FE-403/404 (consult context), FE-702 (readiness consumes openEntries).
- **Technical acceptance criteria:**
  1. Global `POST /queue/call-next {shiftId?, force?}` + per-entry `POST /queue/:entryId/call {force?}`: `force` requires explicit confirm + audit on single-consult `409` (`uq_queue_single_consult`); desk `Alt+N` sends REQUEST notice only (intercom), never this route (guard + facade absence test).
  2. `skip` (`QUEUE_SKIP` audit) reversible via `requeue`; `complete` (requires IN_CONSULTATION, auto-creates UNPAID shell — checkout tolerates both states per FE-302); `undo-complete` single-hop windowed ~15 min with `{reason + key + lastSeenQueueVersion?}` (`QUEUE_UNDO_COMPLETE` audit; invoice NOT deleted (retained; re-completion reuses it)); local countdown from client's own `complete` (GAP-11 — DTO carries no deadline, UI MUST NOT present a fake server deadline); `400` expired/second-use → guidance; `403` secretary → 403 page.
  3. Every command surfaces resulting `queueVersion` + WS echo; illegal transitions disabled with reason tooltips; `400 ILLEGAL_TRANSITION` converges silently.
  4. Keyboard: `Alt+N` call-next (doctor only), `?` overlay documents scope (secretary palette EXCLUDES doctor commands — C-08 test).
- **Ticket gate slice:** call/force/skip/complete/undo specs (incl. window + single-hop + invoice-retained) green.

### FE-402 — Mental Status Examination (MSE) Selector Matrix (Appearance, Behavior, Speech, Mood/Affect + explicit NOT_PERFORMED chip)

- **Clinical objective & persona context:** One-thumb psychiatric exam capture during consultation (D-04): four required selectors, each HONEST about "not performed" vs "not yet entered" (missing ≠ `NOT_PERFORMED` ≠ empty). Feeds manual encounters AND scribe drafts unchanged; server `422 MSE_REQUIRED` distinguishes the states and so does the UI.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/doctor-mse-chip-panel.component.ts/html/scss/spec.ts` (Step-3 §3.4 pattern verbatim: 4× `radiogroup` rows + dashed `NOT_PERFORMED` chip inline-end), `src/app/shared/forms/mse.form.ts` (explicitness validators, `MSEValue = string | 'NOT_PERFORMED'`, missing-vs-performed triple-state).
  - Modify: `src/app/core/state/clinical/consultation.store.ts` (draft MSE slice), `src/app/core/state/clinical/scribe.store.ts` skeleton hook (MSE feed signature — full store FE-601; this ticket defines the shared MSE type both consume).
- **Prerequisites & dependencies:** Requires FE-401 (consult context). Blocks FE-403/404 (sign validation), FE-603/604 (scribe MSE submit).
- **Technical acceptance criteria:**
  1. Four single-select rows (Appearance/Behavior/Speech Coherence/Mood & Affect), each required, each with prominent dashed `NOT_PERFORMED` chip (filled slate when selected, never emerald/cockpit — never reads as a positive finding); NEVER defaults any selector (C-10); row-state Missing (amber hollow) vs Recorded (emerald check) distinct.
  2. `422 MSE_REQUIRED details[]` map per-row: `missing(null)` → amber "Missing — select or mark Not performed" + focus first missing + single shake (240 ms, `motion-reduce` focus-only); explicit `NOT_PERFORMED` accepted silently.
  3. A11y: `radiogroup` + arrow keys per row, `aria-checked`, `aria-describedby` errors, ≥44 px touch chips, wrap `gap-2` (no h-scroll); selection pop 120 ms (`motion-reduce` instant).
  4. Guards enumerate `'NOT_PERFORMED'` literally (FT-4); MSE in MEMORY only (C-18 — disk persistence is a defect); no copy-to-intercom affordance (ZK-5 template-audit).
- **Ticket gate slice:** MSE triple-state + `NOT_PERFORMED`-literal + memory-only specs green (FT-4 seed).

### FE-403 — Manual SOAP Charting Console (Drafting, autosave, complete SOAP validation)

- **Clinical objective & persona context:** Independent charting path (D-07): phone follow-ups, chart corrections, no-queue encounters, scribe-independent visits. Partial drafts allowed; signing is a SEPARATE explicit act (FE-404). Drafts NEVER appear in the timeline (SIGNED-only).
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/doctor-encounter-editor.component.ts/html/scss/spec.ts` (drawer/modal: S/O/A/P prose `Body-L max-w-[72ch]`, MSE panel embed, diagnoses chips, dirty guard), `src/app/features/cockpit/doctor-consult-room.component.*` skeleton (active-consultation host — full studio embed FE-601; this ticket establishes the route `/consult/:entryId` + editor docking).
  - Modify: `src/app/core/net/clinical-api.ts` (`POST /ehr/encounters`, `GET /ehr/encounters/:id`, `PATCH …` with `If-Match`), `src/app/core/state/clinical/consultation.store.ts` (`startManual/patchDraft`, `rowVersion` cache).
- **Prerequisites & dependencies:** Requires FE-401, FE-402. Blocks FE-404 (sign consumes drafts).
- **Technical acceptance criteria:**
  1. `POST /ehr/encounters {patientId, queueEntryRef?(plain id, no FK), source:MANUAL default, soap?(partial), mse(explicit), diagnoses?}` → `{encounterId, DRAFT, rowVersion}`; NO queue required; `422 MSE_REQUIRED` per-row mapping (FE-402); `404` patient → resync.
  2. Draft-only `PATCH {soapPatch?, msePatch?, diagnoses?}` with `If-Match: <rowVersion>` (E-OCC-1): success bumps `rowVersion`; `400 SIGNED`/`409 already SIGNED`/`STALE_ROW_VERSION` → reload + route edits to addendum (FE-404), never forced PATCH; `428` (missing header) unreachable (interceptor always attaches; if observed → reload + guidance). Client MUST NOT send `If-Match` to any non-EHR route.
  3. Draft durability: MEMORY/session only (C-18 — clinical drafts to disk is a defect); dirty guard on route exit; SIGNED encounters lock editor ("signed — addendum only").
  4. Chart timeline exclusion: drafts live exclusively in consult room; `GET /ehr/patients/:id/chart` (SIGNED-only) untouched by this ticket (timeline component FE-404-adjacent history section reuses the same endpoint — stub hook here).
- **Ticket gate slice:** create/patch-OCC/addendum-reroute + memory-only specs green.

### FE-404 — Encounter Sign-off (POST /sign with finalContentHash) & Append-only Addenda Drawer

- **Clinical objective & persona context:** Authoritative attestation (D-07/D-08): doctor declares the note complete and immutable; later corrections are versioned addenda, never edits. **Wire correction (binding):** contract carries NO `finalContentHash` — sign body is `{finalSoap?, rowVersion}` (E-OCC-1). This ticket implements `rowVersion`, not a hash; any `finalContentHash` reference elsewhere in planning prose is SUPERSEDED.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/encounter-signoff-sheet.component.ts/html/scss/spec.ts` (review: full SOAP + MSE + diagnoses + `Alt+S` commit), `addendum-drawer.component.*` ("Add addendum" on SIGNED, version history via `addendumCount`), `doctor-chart-timeline.component.ts/html/scss/spec.ts` (reverse-chron SIGNED-only cards: SOAP/MSE/diagnoses/`signedAt`/source badge `MANUAL|SCRIBE`/`addendumCount`; `NOT_PERFORMED` rendered "not performed", never blank).
  - Modify: `src/app/core/net/clinical-api.ts` (`POST /ehr/encounters/:id/sign`, `POST …/addenda` plural — `…/append` alias resolves to the same handler per code reality; `POST …/discard` DRAFT-only), `src/app/core/state/clinical/consultation.store.ts` (`sign/appendAddendum`, unsigned-roster removal on sign/discard).
- **Prerequisites & dependencies:** Requires FE-403 (drafts + rowVersion), FE-402 (complete-MSE validation). Blocks FE-605 (scribe commit navigates to chart card pattern defined here).
- **Technical acceptance criteria:**
  1. Sign: `POST …/sign {finalSoap?(if draft incomplete), rowVersion REQUIRED}` → `{SIGNED, signedAt, rowVersion}`; button disabled until MSE explicit + draft non-empty; `Alt+S` commits; `409` already SIGNED / `STALE_ROW_VERSION` / `422` incomplete → reload + guidance (incomplete maps per-field; signed maps to addendum path).
  2. Addenda: `POST …/addenda {addendumText non-blank}` → `201 {addendumId, version}`; original preserved; timeline `addendumCount` increments; editor locked post-sign.
  3. Discard: `POST …/discard` DRAFT-only (typed confirm); removes unsigned-roster entry.
  4. Timeline: `GET /ehr/patients/:id/chart?limit&cursor` SIGNED-only desc; source badge; drafts never appear; `queueEntryRef`/`originScribeDraftRef` plain ids rendered as reference chips only (DB-02 severed — no composite visit card joining invoice+SOAP, ZK-4).
- **Ticket gate slice:** sign-OCC + addendum-append-only + timeline-SIGNED-only specs green.

### FE-405 — Longitudinal Medication Tracker & Titration (atomic adjust saga, cessation reasons, safety alert banner)

- **Clinical objective & persona context:** Safe psychopharmacology over months (D-10/D-11/D-12): active vs discontinued lists, every stop explained, titration as ONE confirmed intent (create-new + discontinue-old with half-failure repair — copy states "two-step, not atomic"), overlap flags ADVISORY ONLY (never blocking, never dose advice).
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/doctor-medication-tracker.component.ts/html/scss/spec.ts` (Active vs Discontinued, cessation-reason sheet, titrate wizard, overlap advisory badges), `src/app/core/state/clinical/medication.store.ts` + `medication.store.spec.ts` (`create/discontinue/titrateSaga`, `active/discontinued/overlapAdvisories(C-22)`).
  - Modify: `src/app/core/net/clinical-api.ts` (`POST …/medications`, `POST /ehr/medications/:id/discontinue`, `GET …/medications?status=`), `src/app/features/cockpit/cockpit.routes.ts` (`/meds/:patientId` wiring).
- **Prerequisites & dependencies:** Requires FE-401 (patient context), FE-404 (encounterRef plain-id pattern). Terminal ticket of Sprint 4.
- **Technical acceptance criteria:**
  1. Create: `{drugName, dosage, frequency, instructions, encounterRef?(plain, no FK)}` → ACTIVE; new-row only (no reactivation — history retained); `422` missing → inline.
  2. Discontinue: `{cessationReason non-blank}` → DISCONTINUED + server `stoppedAt`; `422` no-reason → field focus; `400` already-discontinued → converge.
  3. Titrate saga: single "Titrate" user intent → guarded two-step (create-new-ACTIVE then discontinue-old-with-reason); on half-completion surfaces EXACTLY which half landed + one-click repair; copy NEVER claims server atomicity.
  4. Overlap advisories: client-side date-range/agent overlap badges, labeled "Advisory only — not interaction checking", never blocking, never dose-advising (C-22). Safety banner for cessation gaps (e.g., active regimen ends with no successor) is informational + links to create, never modal-blocking.
- **Ticket gate slice:** create/discontinue/titrate-saga-half-repair + advisory-non-blocking specs green.

**Sprint 4 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual: doctor call-next → MSE(all four + NOT_PERFORMED rehearsal) → manual SOAP draft → sign(Alt+S) → addendum → meds create/discontinue/titrate; unsigned roster decrements; timeline shows SIGNED only
```

---

## Sprint 5: Encrypted Therapy Vault (FE-501…FE-503)

**Sprint goal:** doctor-only encrypted psychotherapy notes with ephemeral reads and high-friction shred. **Entry:** S4 gate green + vault routes available. **Exit:** secretary cannot resolve, route, fetch, or bundle any vault surface; doctor reads are audit-noticed and memory-scrubbed; shred leaves a tombstone, never plaintext.

### FE-501 — VaultStore & Secure Vault Shell (strictly inaccessible to Secretary)

- **Clinical objective & persona context:** Separate locked room inside the Cockpit (D-09): long-term therapy narratives live here, invisible to Desk by construction (type + injector + bundle + route + network layers). Every grant shows the `VAULT_ACCESS` audit notice (ids + timestamps only).
- **Exact files to create/modify:**
  - Create: `src/app/core/state/clinical/vault.holder.ts` + `vault.holder.spec.ts` (EPHEMERAL: `plaintextByNote` map ONLY here, `isOpen()`, `writeNote/readEphemeral/scrub(reason)`; NEVER persisted), `src/app/features/cockpit/doctor-vault-page.component.ts/html/scss/spec.ts` (segregated route `/vault/:patientId`, write + list-of-refs + reading pane + shred entry), `src/app/core/guards/vault.guard.ts` (full: doctor + per-session notice-ack).
  - Modify: `src/app/features/cockpit/cockpit.routes.ts` (vault route + `vaultGuard`, cockpit providers include `VaultHolder`), `src/app/core/net/clinical-api.ts` (vault methods segregated section).
- **Prerequisites & dependencies:** Requires FE-401 (clinical scoping pattern), FE-103 (guard chain). Blocks FE-502/503.
- **Technical acceptance criteria:**
  1. `vaultGuard` extends `doctorGuard`: doctor + explicit per-session `VAULT_ACCESS_NOTICE_SHOWN` ack (client log ids-only); deny → `/403?reason=vault` with zero vault fetch.
  2. Five-layer secretary exclusion (all asserted): (a) type — zero `Clinical*`/vault imports in `front-desk/**`; (b) injector — `VaultHolder` cockpit-scoped, front-desk resolution throws; (c) route — no vault path in desk tree; (d) bundle — `front-desk` chunk contains zero `vault` strings/identifiers; (e) network — secretary deep-link to `/vault/:id` fires zero `/ehr/vault/*` requests.
  3. Write: `POST …/vault/patients/:id/notes {content non-blank, noteDate?}` → `{noteId, createdAt, keyId}` (plaintext NEVER echoed); `keyId` displayed per custody checklist; `422` empty → inline.
  4. Privacy: one-click `.privacy-blur` covers vault, idle auto-lock hook, document title generic, print-disabled (clinical), toasts clinical-free (ZK-7).
- **Ticket gate slice:** 5-layer exclusion + notice-ack + write-no-echo specs green (FT-1/FT-8 seeds).

### FE-502 — In-Memory Decrypt Note Viewer (Doctor-authenticated on-demand decryption)

- **Clinical objective & persona context:** Read a therapy note only for as long as the doctor looks at it (ZK-6/C-15): plaintext enters ONE in-memory map, never disk/logs/reports/clipboard-history, and is scrubbed on lock/logout/role-switch/tab-hide/route-exit.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/vault-note-reader.component.ts/html/scss/spec.ts` (single-note reading pane `Body-L max-w-[68ch]`, `VAULT_ACCESS` notice, scrub-on-exit), `src/app/core/state/clinical/vault-scrub.ts` (scrub triggers: lock/logout/route-exit/tab-hide/idle timer).
  - Modify: `src/app/core/state/clinical/vault.holder.ts` (`readEphemeral()`), `src/app/core/net/clinical-api.ts` (`GET …/vault/patients/:id/notes` → decrypted-in-memory shape).
- **Prerequisites & dependencies:** Requires FE-501. Blocks FE-503 (shred operates on listed refs; reader proves ephemerality first).
- **Technical acceptance criteria:**
  1. `GET …/notes` plaintext lands ONLY in `VaultHolder.plaintextByNote`; never `localStorage/sessionStorage/IndexedDB`; never logs/error reports; scrub on ALL of: lock, logout, role switch, tab hide (configurable), route exit from vault surface, idle timeout; scrub covered by per-trigger specs.
  2. Reader shows `VAULT_ACCESS` notice ("every read is logged — id + timestamp only"); single-note pane (no bulk-decrypt-all affordance); close/exit scrubs that note immediately; back-navigation re-fetches (never rehydrates from cache).
  3. `keyId` per note displayed; ciphertext-at-rest assumed (client never handles keys — key-label display only).
- **Ticket gate slice:** ephemerality (persistence-absence + 5-trigger scrub) specs green (FT-8 seed).

### FE-503 — High-Friction "Shred Note" Modal: typed-confirmation ("SHRED") & permanent tombstone rendering

- **Clinical objective & persona context:** Irrevocable destruction with a permanent audit scar (D-09 + V-SHRED-1): ciphertext/wrappedDek/nonce nulled server-side, tombstone retained, idempotent re-shred returns the existing tombstone. Friction (typed `SHRED`) matches irreversibility; tombstone prevents "ghost note" confusion.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/vault-shred-modal.component.ts/html/scss/spec.ts` (Step-3 §3.6 pattern verbatim: typed-`SHRED` + tombstone preview + dual-tap/confirm, crimson-solid, `role=alertdialog`).
  - Modify: `src/app/features/cockpit/doctor-vault-page.component.*` (post-shred tombstone row `noteId · shreddedAt · actor`, never plaintext; shred entry point), `src/app/core/net/clinical-api.ts` (`POST /ehr/vault/notes/:id/shred`; contract alias `…/patients/:id/notes/:noteId/shred` resolves to the same handler), `src/app/core/state/clinical/vault.holder.ts` (post-shred scrub of that note + tombstone cache of refs only).
- **Prerequisites & dependencies:** Requires FE-501, FE-502. Terminal ticket of Sprint 5.
- **Technical acceptance criteria:**
  1. Modal requires typed `SHRED` (exact, case-sensitive) to arm the confirm CTA; shows tombstone preview (what will remain: id + shreddedAt + actor) + "This cannot be undone" + audit notice; `200 {noteId, shreddedAt}` → row renders tombstone permanently; re-shred → existing tombstone (idempotent, not an error).
  2. Post-shred: plaintext for that note scrubbed immediately; no recovery affordance anywhere (offering recovery is a DEFECT — zero-hard-delete invariant); list retains tombstone ordering (no silent disappearance).
  3. Secretary exclusion extends to shred (same 5 layers, FE-501).
- **Ticket gate slice:** typed-confirm + tombstone + idempotent-reshred + post-shred-scrub specs green.

**Sprint 5 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual: as secretary → /vault/:id = /403 + zero vault network calls + front-desk chunk grep clean; as doctor → write → read → tab-hide scrub → shred(SHRED) → tombstone, no recovery path
```

---

## Sprint 6: Multimodal AI Scribe Studio (FE-601…FE-605)

**Sprint goal:** hands-free ambient + dictation → reviewed SOAP → ONE atomic commit (D-03/D-05). **Entry:** S5 gate green + scribe routes available (Gen-2 + Gen-1). **Exit:** doctor can record → transcribe → draft → correct → commit exactly once per session, with consent/retention visible and WITHDRAWN/PURGED locking the surface (never an error toast).

### FE-601 — ScribeStore & Audio Recording Engine (local metering, waveform visualizer, 15MB buffer limit)

- **Clinical objective & persona context:** Hands-free consultation capture: doctor taps record and stays with the patient. Local waveform proves capture without uploading first; 60 s dictation cap countdown pre-empts server `422`; bounded buffer + 120 s upload timeout keep low-end clinic devices safe.
- **Exact files to create/modify:**
  - Implemented (Gen-2 canonical): `scribe.store.ts` (doctor scope: `session/cycle1Draft/cycle2Draft/audioBlob` signals, `consentState/retentionUntil/canCommit/isLocked`, intents `createSession/setAudio/runCycle1Analyze/runCycle2Synthesis/patchCycle2Soap/commitScribeSession/withdrawConsent/purgeAudio/startNewSession`), `cycle1-analysis/cycle2-dictation/scribe-review-studio` components, `core/utils/audio-buffer.ts` + `core/audio/audio-recorder.service.ts` (bounded buffer, cap enforcement).
  - Modify: `src/app/features/cockpit/doctor-consult-room.component.*` (studio docking slot), `src/app/core/net/clinical-api.ts` (scribe section skeleton).
- **Prerequisites & dependencies:** Requires FE-401 (consult context), FE-402 (MSE type). Blocks FE-602–FE-605.
- **Technical acceptance criteria:**
  1. Transport: record/pause/stop + live waveform from Web Audio `AnalyserNode` (client-only, C-02) + local chunk buffering; duration meter + 60 s cap countdown (warn ~55 s, auto-stop assist — C-03; timer is assistive, server `422` still handled); session states `UPLOADED→TRANSCRIBING→TRANSCRIBED/FAILED/WITHDRAWN/PURGED` as first-class stepper states.
  2. Buffer: bounded (15 MB ceiling documented in-studio as "local buffer held, cleared on session close/purge"); upload chunked with 120 s timeout; `410 GONE` (withdrawn) → "start a new session" path (never error toast).
  3. Recording indicator visible + textual (never color-only); bytes never retained after session close/purge; consent-gated upload (FE-602 hook — engine refuses upload without `consentConfirmed` for `AMBIENT_LIVE`).
- **Ticket gate slice:** waveform/metering + cap-countdown + bounded-buffer + `410`-recovery specs green.

### FE-602 — Explicit Patient Consent Acknowledgment Gate (422 CONSENT_REQUIRED handling) & Consent Withdrawal Action

- **Clinical objective & persona context:** Legal gate for ambient capture (P-11): no `AMBIENT_LIVE` session without explicit acknowledgment; withdrawal is deliberate, confirmed, audited — and locks the session with a visible recovery path (new session), honoring the 30-day purge.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/scribe-consent-gate.component.ts/html/scss/spec.ts` (acknowledgment checkbox + consent chip + `audioRetentionUntil` countdown + WITHDRAWN/PURGED full-surface lock screens), `scribe-withdraw-sheet.component.*` (dual-tap confirmed withdraw with optional operational-note reason, no clinical text).
  - Modify: `src/app/core/state/clinical/scribe.store.ts` (`createSession` consent path, `withdrawConsent`), `src/app/core/net/clinical-api.ts` (`POST /scribe/sessions`, `POST …/withdraw-consent`).
- **Prerequisites & dependencies:** Requires FE-601. Blocks FE-603/604 (sessions cannot start without consent path).
- **Technical acceptance criteria:**
  1. Create: `POST /scribe/sessions {patientId, mode: AMBIENT_LIVE|DICTATION_60S, consentConfirmed}` → `{sessionId, consentStatus:GRANTED, audioRetentionUntil}`; `AMBIENT_LIVE` without `consentConfirmed:true` → `422 CONSENT_REQUIRED` maps to the consent-capture step (not a toast).
  2. Surface: consent chip (`granted/withdrawn/purged`) + retention countdown persistent in studio header; WITHDRAWN/PURGED lock transcribe/synthesize/upload/draft with full-surface state + "Start new session" path (C-13); blocked actions offer no hidden affordance.
  3. Withdraw: `POST …/withdraw-consent {reason? operational}` → `{WITHDRAWN, withdrawnAt, audioRetentionUntil}` + `CONSENT_WITHDRAWN` audit (ids only); `400` already-withdrawn/purged → converge; audio ops on withdrawn → `403 WITHDRAWN_GONE`/`410 GONE` → new-session path.
- **Ticket gate slice:** consent-gate + withdraw-lock + retention-countdown specs green.

### FE-603 — Cycle 1 Consultation Audio Ingestion & Structured Clinical Analysis view

- **Clinical objective & persona context:** Pass 1 of the three-pass scribe (D-05): ambient consultation audio → dialogue analysis review (chief complaint, symptoms, mood/affect, suggestions) with violet AI provenance. Doctor reviews BEFORE dictation so Pass 2 can override.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/scribe-cycle1-panel.component.ts/html/scss/spec.ts` (analysis cards: complaint/symptoms/mood-affect/suggestions with `AI` glyph + `scribe-ai` chips, diff-neutral styling — del/add highlights reserved for Pass-2 SOAP).
  - Implemented (Gen-2 canonical): `clinical-api.ts` `POST …/cycle-1-consultation {audioBase64, mimeType?}` strict inline; `scribe.store.ts` `runCycle1Analyze()` requires the recorded buffer; no upload/stop/transcribe endpoints exist.
- **Prerequisites & dependencies:** Requires FE-601, FE-602. Blocks FE-605 (review grid left column). Parallelizable with FE-604.
- **Technical acceptance criteria:**
  1. Upload-then-analyze: binary/chunked `audio` (Gen-1) or `audioReference` (Gen-2) → `200 {analysis{chiefComplaint, symptoms[], moodAffect, suggestions[{text, provenance:AI}]}}`; `202 TRANSCRIBING` (Gen-1) → stepper + bounded poll, no tight loops; WITHDRAWN/PURGED blocks with lock screen (never toast).
  2. "Doctor decisions override dialogue" directive (GAP-07): `POST /scribe/drafts` accepts `{scribeSessionId, mse}` ONLY — prioritization lives server-side; client submits MSE only and MUST NOT synthesize prioritization locally (test asserts draft payload contains no dialogue-derived ranking).
  3. Violet AI-only rule (SPEC-DS-1.4): AI text carries `AI` glyph + chip; human content never violet (template-audit).
- **Ticket gate slice:** cycle-1 analyze + poll + lock-screen + AI-provenance specs green.

### FE-604 — Cycle 2 Doctor 30-sec Dictation Ingestion & SOAP/Prescription Synthesis view

- **Clinical objective & persona context:** Pass 2 (D-05): doctor's closing 30-second speech (prioritized over dialogue server-side) → SOAP synthesis + Rx suggestions + MSE feed. Short by design: decisions, not dictation of the whole visit.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/scribe-cycle2-panel.component.ts/html/scss/spec.ts` (SOAP synthesis with `diff-add/diff-del` highlights + Rx suggestion cards + MSE panel feed-through).
  - Implemented (Gen-2 canonical): `clinical-api.ts` `POST …/cycle-2-doctor-decision {audioBase64, mimeType?}` strict; the typed note is a client-side affordance (never transmitted); the doctor's explicit MSE submits with the COMMIT body (G-6), not the cycle-2 call.
- **Prerequisites & dependencies:** Requires FE-601, FE-602, FE-402 (MSE explicit). Blocks FE-605 (right column). Parallelizable with FE-603.
- **Technical acceptance criteria:**
  1. Dictation: 30 s guidance ("closing decisions in ~30 seconds") + 60 s hard-cap countdown shared engine; `POST …/cycle-2-doctor-decision` → `{soap:{S,O,A,P}, prescriptions[], finalDiagnosis}` (Gen-2 canonical; no fallback — the draft endpoints do not exist); MSE completeness gates client-side.
  2. Multi-session→single-draft (GAP-08): studio tolerates single-session drafts; bundle contract tolerates future multi-session without UI fork (draft header shows session chip(s), capped-at-1 note).
  3. Rx suggestions render as stronie suggestions with "Confirm in Medication Tracker" handoff (FE-405) — studio NEVER writes meds directly except via the atomic commit (FE-605).
- **Ticket gate slice:** cycle-2 synthesis + MSE-required + single-binding-cap specs green.

### FE-605 — Side-by-side SOAP Review & Atomic Commit Saga (commitScribeSession to Encounter + Medications)

- **Clinical objective & persona context:** Pass 3 (D-05): human commits — side-by-side dialogue analysis vs SOAP synthesis with manual correction, then ONE click creates the `SCRIBE`-source Encounter (+ linked meds). Exactly one commit path executes per session (Gen-2 `commit` XOR Gen-1 `sign-off`).
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/scribe-review-grid.component.ts/html/scss/spec.ts` (Step-3 §3.5 review-grid verbatim: `[Dialogue analysis | SOAP synthesis w/ diff]` + draft-version chip + 1-click commit), `src/app/features/cockpit/doctor-scribe-studio.component.ts/html/scss/spec.ts` (cycle switch + consent chip + retention + waveform well + pass stepper + review grid + commit footer).
  - Implemented (Gen-2 canonical): `clinical-api.ts` `POST …/commit {soap, mse?, prescriptions?, diagnoses?}` strict → `{encounterId, status:'COMMITTED'}` (single commit path; Encounter source SCRIBE atomically with meds + session flip); `scribe.store.ts` `commitScribeSession()` + `patchCycle2Soap()` local-correction lane (EDITED v n+1, corrected note lands at commit); `consultation.store.ts` post-commit chart navigation hook into FE-404 timeline.
- **Prerequisites & dependencies:** Requires FE-603, FE-604, FE-404 (chart card pattern), FE-405 (med handoff). Terminal ticket of Sprint 6.
- **Technical acceptance criteria:**
  1. Review: side-by-side grid (analysis left, synthesis right with `diff-add` indigo-ring + `diff-del` strikethrough+label, never red-text-only); inline manual corrections → `EDITED v n+1` (version chain retained, superseded kept); draft-version chip mono; commit disabled until MSE explicit + consent GRANTED + non-empty draft.
  2. Commit: studio guards double-commit (single Gen-2 `commit` path; second click disabled + in-flight lock); success creates Encounter `source:SCRIBE` + linked meds → navigates to FE-404 chart card; `409` double-commit / `422` incomplete → per-field guidance; `POST …/purge-audio` hygiene action shares TTL-worker result shape (retention path).
  3. Provenance survives: `MANUAL|SCRIBE` source badge + `AI` chips persist onto chart card.
- **Ticket gate slice:** review-correct + single-commit-guard + chart-handoff specs green.

**Sprint 6 Quality Gate (terminal):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# + manual: Cycle1 record → analysis review → Cycle2 30s dictation + MSE → side-by-side correct → single commit → chart card(S권을CRIBE); withdraw rehearsal → lock + new-session path; purge rehearsal → bytes gone, records kept
```

---

## Sprint 7: Supervision, Invariants, Intercom & Hardening (FE-701…FE-705)

**Sprint goal:** practice oversight + corridor voice + release hardness. **Entry:** S6 gate green. **Exit:** doctor supervises cash/queue/audit/discrepancies; intercom directives carry effect receipts; FT-1…FT-8 green; staging sign-off recorded.

### FE-701 — Persistent In-Clinic Intercom Mini-Dock (DOCTOR_NEXT, DOCTOR_COMPLIMENTARY, quick secretary alerts)

- **Clinical objective & persona context:** Operational voice of the clinic (S-14/D-13): silent badge+pulse (no autoplay), rapid templates, and DIRECTIVES AS DATA — every doctor directive renders its effect receipt (invoice id / task id / new `queueVersion`), not just its text. Type-ownership is role-derived (forging impossible).
- **Exact files to create/modify:**
  - Create: `src/app/core/state/ops/intercom.store.ts` + `intercom.store.spec.ts` (`messages/unreadCount/directiveReceipts`, `send/applyReceived/markRead`), `src/app/features/front-desk/ops-intercom-dock.component.ts/html/scss/spec.ts` (persistent mini-dock/floating drawer, `inset-inline-end`, templates, composer with ZK-5 hint, history `GET /intercom?limit&cursor` + reconnect gap-fill), `src/app/features/cockpit/doctor-directives-widget.component.ts/html/scss/spec.ts` (full: Call-Next / Complimentary (key-minted) / Follow-up → `FollowUpTask REQUESTED`).
  - Modify: `src/app/core/net/ops-api.ts` (`GET/POST /intercom`, `GET /followups`), `src/app/features/front-desk/desk-shell.component.*` + `cockpit-shell.component.*` (dock/widget mount points), `src/app/core/realtime/queue-ingest.ts` (`intercom.received` routing + receipt enrichment C-23).
- **Prerequisites & dependencies:** Requires FE-201 (socket + gap-fill), FE-301 (complimentary billing effect), FE-401 (Call-Next command). Blocks nothing (parallelizable with FE-702 after FE-201/301).
- **Technical acceptance criteria:**
  1. Templates→wire (role-derived, never user-selected): secretary "disturbance"→`SEC_DISRUPTION`, "pharmacy"→`SEC_PHARMACY_LAB`, "arrived early"→`CUSTOM_TEXT` (capped + "Operational only — never type diagnoses, drug names, or findings" hint); doctor widget three actions→`DOCTOR_NEXT/DOCTOR_COMPLIMENTARY(+key, executes zeroing + `billing.invoiceUpdated`)/DOCTOR_FOLLOWUP(→`REQUESTED` task, `relatedQueueEntryId`)`; forging → `403` error frame, no broadcast (spec covers forged-type attempt).
  2. `CUSTOM_TEXT` requires non-blank capped text; no composer pre-fills from clinical state; zero "send to desk" buttons on SOAP/MSE/meds/vault surfaces (template-audit, ZK-5).
  3. Effect receipts (C-23): `DOCTOR_COMPLIMENTARY` shows zeroed invoice id; `DOCTOR_NEXT` shows new IN_CONSULTATION entry + `queueVersion`; `DOCTOR_FOLLOWUP` shows created task id; history paginates; reconnect gap-fills from last `createdAt` cursor; unread badge + subtle pulse, silent by default.
- **Ticket gate slice:** type-ownership + receipt-rendering + gap-fill + ZK-5-audit specs green.

### FE-702 — Practice Supervision Dashboard: Cash summary, unacknowledged shifts, unsigned notes backlog

- **Clinical objective & persona context:** Doctor oversight (D-01): front-desk activity feed, cash summary + audit coverage (INV-10 gate as "complete the reason and retry"), shift readiness (`canClose/blockers/openEntries`), unsigned-notes backlog (GAP-02 local roster + proposed `GET /ehr/encounters?status=DRAFT` tolerance).
- **Exact files to create/modify:**
  - Create: `src/app/core/state/clinical/supervision.store.ts` + `supervision.store.spec.ts` (DOCTOR SCOPE: `activity/cashSummary+auditCoverage/discrepancies/readiness`, `refreshAll`), `src/app/features/cockpit/doctor-command-deck-sections/supervision-views.component.ts/html/scss/spec.ts`, `front-desk-activity.component.*`, `cash-summary.component.*`, `shift-readiness.component.*`, `unsigned-backlog.component.*`, `src/app/features/cockpit/doctor-user-admin.component.ts/html/scss/spec.ts` (`POST /users/secretaries`, `GET /users`, `PATCH …/deactivate|activate` — BE-104 parity; self-deactivate typed confirm).
  - Modify: `src/app/core/net/ops-api.ts` (supervision-safe subsets) + `clinical-api.ts` (doctor supervision reads: `GET /supervision/front-desk-activity|cash-summary|discrepancies|shift-readiness`, `GET /audit` full), `src/app/features/cockpit/cockpit.routes.ts` (`/supervision/*` + `/admin/users` wiring).
- **Prerequisites & dependencies:** Requires FE-401 (queue/openEntries), FE-301 (summary shape), FE-404 (unsigned roster source). Blocks FE-703 (discrepancy drill-down host), FE-704 (audit feed shares coverage model).
- **Technical acceptance criteria:**
  1. `refreshAll()` fans out to activity + cash-summary(+`auditCoverage{required,present,missing[]}`) + discrepancies + readiness; `supervision.discrepancy` WS frames (doctor room only) raise non-blocking alerts; missing-audit blockers render as actionable "complete the reason and retry" (INV-10).
  2. Readiness: `canClose/blockers[]/openEntries` verbatim; force-close-with-reason entry point (audited) delegating to `ShiftStore.forceCloseWithReason`.
  3. Unsigned backlog: local per-shift roster of doctor's uncompleted consults (from `ConsultationStore`) + tolerance for future `GET /ehr/encounters?status=DRAFT` (probe-draft-list-first, local-roster fallback — exactly one source renders, studio-guarded).
  4. User admin: provision/deactivate/activate secretary roster; `409` duplicate identifier → inline variant suggestion; deactivation of self → FE-104 lockout path.
  5. Zero-knowledge bound: `SupervisionStore` doctor-scoped; secretary injector resolution throws (DI test); secretary bundle contains zero supervision handlers.
- **Ticket gate slice:** refreshAll + coverage-gate + readiness + backlog + user-admin specs green.

### FE-703 — Invariant & Discrepancies Monitor (realtime inspection of INV-1..10 violations)

- **Clinical objective & persona context:** Trust instrument (D-01/I-10): every `INV-*` break is inspectable the moment it lands — which invariant, which entities, which forward repair (pay, reversal, write-off, addendum, reason completion, escalation). Close dialog's `409 INVARIANT_VIOLATION + discrepancies[]` routes HERE.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/discrepancy-monitor.component.ts/html/scss/spec.ts` (`invViolations[{inv, detail, entities}]`, `missingAudit`, `staleQueue` rendering + resolve-or-escalate actions per INV row), `src/app/core/state/clinical/invariant-copy.ts` (per-INV-1…10 title/copy/repair-link table mirroring Step-1 §4.6).
  - Modify: `src/app/core/state/clinical/supervision.store.ts` (`applyDiscrepancy`), `src/app/features/front-desk/ops-blind-drawer-close-dialog.component.*` (409 routing into this monitor for doctor escalation), `src/app/features/cockpit/supervision-views.component.*` (monitor embed).
- **Prerequisites & dependencies:** Requires FE-702 (store + feed). Blocks FE-705 (FT gates consume this surface for INV tripwires).
- **Technical acceptance criteria:**
  1. Renders `GET /supervision/discrepancies` verbatim (`invViolations/missingAudit/staleQueue`) + live `supervision.discrepancy` frames; each INV row shows Step-1 §4.6 obligation copy + EXACT forward repair control (e.g., INV-10 → "complete the reason and retry" deep-linking the originating sheet; INV-4 → reversal linkage chain; INV-8 → no-preview reminder + reveal path).
  2. `409 INVARIANT_VIOLATION` from close/checkout/pay routes lists `discrepancies[]` with resolve-or-escalate; silent-convergence codes never land here (routing test).
  3. Non-blocking alert posture (supervision channel); no modal hijack; `aria-live=polite` announces new INV with id only.
- **Ticket gate slice:** discrepancy render + per-INV repair routing + close-409 handoff specs green.

### FE-704 — Audit Feed Explorer (GET /api/v1/audit with role-filtered views)

- **Clinical objective & persona context:** Accountability reader (D-01/S-14-adjacent): every sensitive mutation proves its audit row (ids + timestamps, never clinical bodies). Secretary sees own-operational-only (vault/scribe rows filtered server-side); doctor sees full operational list incl. `WRITE_OFF` (E-2 canonical), `IDEMPOTENT_REPLAY`, `CONSENT_WITHDRAWN`, `QUEUE_UNDO_COMPLETE`, `EMERGENCY_FLAG/UNFLAG`, `DISCOUNT`, `REVERSE`, `FORCE_CLOSE`.
- **Exact files to create/modify:**
  - Create: `src/app/features/cockpit/audit-feed-explorer.component.ts/html/scss/spec.ts` (filters `shiftId/actorId/action/entityType/entityId/date-range`, `limit&cursor` pagination, coverage pairing with FE-702 `auditCoverage`), `audit-feed-secretary.component.*` (desk-side own-ops view, presentation-only filtering — no semantic extension).
  - Modify: `src/app/core/net/ops-api.ts` (`GET /audit` secretary-subset) + `clinical-api.ts` (`GET /audit` full), `src/app/features/front-desk/front-desk.routes.ts` (secretary audit view route, if chartered) + `cockpit.routes.ts` (doctor explorer route).
- **Prerequisites & dependencies:** Requires FE-702 (coverage model), FE-701 (followup/intercom actions appear as audit rows). Blocks FE-705 (audit-coverage FT assertion).
- **Technical acceptance criteria:**
  1. Query filters map 1:1 to contract (`shiftId/actorId/action/entityType/entityId/startDate/endDate/limit/cursor`); rows render `{actorId, action, entityType, entityId, createdAt}` operational structs ONLY; E-2 verified: write-off rows carry `action:'WRITE_OFF'` (spec pins the literal).
  2. Role filtering is server-side; client adds presentation only (no client-side vault/scribe unmasking — attempting to render a clinical body from an audit row is a defect; allowlist test).
  3. Pagination cursor opaque; filter change resets cursor (cursor+filter-mix is an error — spec covers).
- **Ticket gate slice:** filter-mapping + `WRITE_OFF`-literal + pagination-reset + role-presentation-only specs green.

### FE-705 — End-to-End Verification, Frontend Tripwires Execution (FT-1..FT-8), and Staging Readiness Sign-off

- **Clinical objective & persona context:** Release gate for the whole practice: proves the two cockpits are one coherent clinic AND provably disconnected where law/threat-model demand it. No staging deploy without this ticket green + recorded sign-off.
- **Exact files to create/modify:**
  - Create: `tests/tripwires/ft-1-secretary-import-graph.spec.ts`, `ft-2-allowlist-snapshot.spec.ts`, `ft-3-occ-interceptor.spec.ts`, `ft-4-mse-not-performed.spec.ts`, `ft-5-blind-close.spec.ts`, `ft-6-include-clinical-fuzz.spec.ts`, `ft-7-bundle-audit.spec.ts`, `ft-8-vault-ephemerality.spec.ts`, `tests/e2e/j-01-routine-visit.spec.ts` (J-01…J-08 journey selection: routine/new/crisis/discounted/debt/correction/blocked-close/consent-withdraw per Step-1 §2.6), `docs/frontend/STAGING_SIGNOFF.md` (sign-off record: versions, gates, waivers, residual risks T-1 shoulder-surfing + procedural mitigations).
  - Modify: `angular.json` (CI: tripwire + bundle-audit + contrast-sweep jobs blocking), `.eslintrc`/`eslint.config.js` (promote tripwire rules to error), `README-FRONTEND.md` (record zoneless outcome + chunk baselines + waiver log).
- **Prerequisites & dependencies:** Requires ALL FE-001…FE-704 (terminal ticket of the program). No parallelization.
- **Technical acceptance criteria (FT-1…FT-8 must ALL pass in CI):**
  1. **FT-1 Secretary import graph:** no `Clinical*` import reachable from `features/front-desk/**`, `core/net/ops-api*`, `core/state/ops/**` (boundary + `no-clinical-in-desk` rule).
  2. **FT-2 Allowlist snapshot:** secretary fixtures (queue/search/balance/summary/audit-secretary) contain Ops keys ONLY; unexpected key fails.
  3. **FT-3 OCC interceptor:** reorder/emergency requests ALWAYS carry body `lastSeenQueueVersion` and NEVER `If-Match`; encounter PATCH ALWAYS carries `If-Match: <rowVersion>`; no-snapshot blocks dispatch (request-interceptor test).
  4. **FT-4 MSE:** schemas/guards/panel enumerate `'NOT_PERFORMED'` literally; missing-vs-performed triple-state covered.
  5. **FT-5 Blind close:** no expected-value selector/field/binding exists in close-dialog/summary pre-reveal states; reveal data equals persisted `200` only (no client computation).
  6. **FT-6 `?include=clinical` fuzz:** API client fuzz with clinical-include-style params returns zero clinical keys (client MUST NOT invent extension params; test asserts absence).
  7. **FT-7 Bundle audit:** `dist/front-desk-*.js` contains zero `/ehr/|/scribe/|/vault/|/supervision/` + zero `VaultHolder|ScribeStore|ConsultationStore|ScribeDraft` identifiers; chunk budgets hold (initial ≤250 kB / desk ≤350 kB / cockpit ≤600 kB gz, >10% growth fails).
  8. **FT-8 Vault ephemerality:** vault plaintext absent from `localStorage/sessionStorage/IndexedDB`/logs/reports; all 5 scrub triggers covered; post-shred tombstone-only.
  9. **Journeys:** J-01 routine return visit + J-03 crisis + J-04 discounted (floor breach → doctor) + J-05 debt oldest-first + J-06 correction (reversal + addendum) + J-07 blocked close (force-with-reason) + J-08 consent withdraw→purge pass headless against staging backend; J-02 new-patient duplicate-candidate path covered.
  10. **Staging sign-off:** `STAGING_SIGNOFF.md` records resolved `angular/typescript` versions, gate transcripts, chunk baselines, waiver log (expected zero), residual procedural risks (T-1 shoulder-surfing → privacy-blur + auto-lock + training note), and explicit GO/NO-GO.
- **Ticket gate slice (program gate):** FT-1…FT-8 suites + selected E2E green; sign-off file merged.

**Sprint 7 Quality Gate (terminal — program release gate):**

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
npx ng e2e --configuration staging
# + FT bundle audit on dist + rtl smoke(desk board + checkout + dock + consult room) + STAGING_SIGNOFF.md recorded GO
```

---

## Appendix A — Master Traceability (S/D → Endpoints → FE tickets → FT gates)

| Feature | Endpoints (`04` §1) | FE tickets | Gates |
|---|---|---|---|
| S-01 check-in returning | B-1, C-1, C-14 | FE-202, FE-204 | FT-2, FT-3 |
| S-02 rapid registration | B-2, B-3, B-4 | FE-202 | FT-2 |
| S-03 crisis intake | B-2-lite, B-4-later, C-1 emergency | FE-203 | FT-2, FT-3 |
| S-04 queue state | C-2, C-11, WS `queue.updated/called/reordered/emergency/undoComplete` | FE-201, FE-204 | FT-3 |
| S-05 DnD reorder OCC | C-9 + Q-OCC-1 | FE-205 | FT-3 |
| S-06 emergency flag | C-10 + Q-OCC-1 | FE-204, FE-205 | FT-3 |
| S-07 wait estimator | C-11 | FE-204 | — |
| S-08 suggested fee | A-10, D-6, C-7 shell | FE-301, FE-302 | — |
| S-09 discount reason | D-1 | FE-302 | — |
| S-10 floor protection | A-10, D-1 (`403 FLOOR_VIOLATION`) | FE-302 | — |
| S-11 multi-channel pay | D-1, D-3, D-7 (`CASH\|OTHER`) | FE-303 | — |
| S-12 debt oldest-first | B-5, B-6, D-3 | FE-304 | — |
| S-13 receipts archive | D-7 (closed-only, GAP-03) | FE-303, FE-304 | FT-2 |
| S-14 intercom desk | E-1, E-2, WS `intercom.received` | FE-701 | FT-1 |
| S-15 petty EXPENSE-only | D-9, D-10 (GAP-04) | FE-305 | — |
| S-16 blind close | D-11, D-12 (P-04) | FE-306 | FT-5 |
| S-17 day summary | D-12 (null discipline) | FE-305, FE-306 | FT-5 |
| S-18 zero-knowledge | all SecretSafe | FE-004 + every ticket §(5) | FT-1, FT-2, FT-6, FT-7, FT-8 |
| D-01 oversight | H-2, H-3, H-4, H-5, WS supervision | FE-702, FE-703 | FT-1, FT-7 |
| D-02 queue command | C-3…C-8, C-12, C-13 | FE-401 | FT-3 |
| D-03 audio ingest | G-1, G-2a/b/c, G-3 (cap + 410) | FE-601 | — |
| D-04 MSE explicit | F-1, F-4, F-5, G-2c, G-8 | FE-402 | FT-4 |
| D-05 3-pass scribe | G-1…G-11 (S-DUAL-1) | FE-601…FE-605 | FT-4 |
| D-06 timeline SIGNED-only | F-2, F-3 | FE-404 | FT-1, FT-2 |
| D-07 manual SOAP | F-1, F-3, F-4, F-5 (E-OCC-1) | FE-403, FE-404 | FT-3, FT-4 |
| D-08 addenda | F-6, F-7 | FE-404 | — |
| D-09 vault | F-11, F-12, F-13 (V-SHRED-1) | FE-501…FE-503 | FT-1, FT-7, FT-8 |
| D-10 meds tracker | F-8, F-9, F-10 | FE-405 | — |
| D-11 titration saga | F-8 + F-9 composite | FE-405 | — |
| D-12 overlap advisory | client-only C-22 | FE-405 | — |
| D-13 directives widget | E-2, B-6/D-2 effects, E-3 | FE-401, FE-701 | — |
| Auth/session/users/settings | A-1…A-11 | FE-101…FE-104, FE-702(admin) | — |
| INV-1…INV-10 | §4.6 obligations | FE-301…FE-306, FE-703 | FT-5 |
| C-01…C-24 | arch §2-4 / map §0-4 | embedded per-ticket | FT-1…FT-8 |
| F-01…F-10 / X-01/X-02 | deferred/excluded | NO ticket (scope-gate §0.2.12 analogue: amendment required) | — |

---

## Appendix B — Canonical File Manifest (Step 6 creation order)

Creation order = FE numeric order. Co-located `*.spec.ts` ships WITH each file (no untested file merges).

```
FE-001: package.json, angular.json, tsconfig*.json, src/main.ts, app.component.*, app.routes.ts(skeleton),
        environments/*, eslint/stylelint configs, README-FRONTEND.md
FE-002: styles/themes.css, typography.css, logical-utilities.css, print.css, tailwind config/theme, index.html(dir/theme)
FE-003: core/net/{ops-api, clinical-api(skeleton), interceptors/*, http-timeout, idempotency-keys},
        core/state/ops/outbox.store, core/errors/*, core/utils/{uuid, payload-hash, money, time}
FE-004: app.routes.ts(final) + front-desk.routes + cockpit.routes(+providers) + desk/cockpit shells +
        shared/ui/ui-shell-skeleton + core/guards/*(skeletons)
FE-101: core/state/ops/{auth.store, settings.store}
FE-102: features/auth/login.* + shared/forms/login.form + shared/i18n/auth.copy
FE-103: core/guards/{auth, role}.guard(full) + forbidden/not-found components + routes wiring
FE-104: features/auth/change-password-sheet.* + core/state/ops/session-events.ts
FE-201: core/realtime/{socket.service, queue-ingest, frame-guards} + core/rx-boundary/ws-bridge +
        core/state/ops/{queue.store, followup.store(skeleton)} + app.component link badge
FE-202: features/front-desk/{ops-checkin-dialog, ops-patient-registration-wizard} +
        core/rx-boundary/search-stream + shared/forms/patient-identity.form
FE-203: features/front-desk/{ops-crisis-intake-dialog, crisis-banner}
FE-204: features/front-desk/{ops-waiting-room-board, queue-patient-card, emergency-flag-dialog, queue-lane}
FE-205: features/front-desk/queue-dnd.directive + core/state/ops/reorder-intent.ts
FE-301: core/state/ops/{shift.store, billing.store} + core/state/ops/{shift-models, billing-models} +
        features/front-desk/ops-shift-open-dialog(skeleton full)
FE-302: features/front-desk/ops-billing-checkout-sheet
FE-303: features/front-desk/payment-method-presets (+ money.ts map)
FE-304: features/front-desk/{ops-debt-settlement-sheet, ops-patient-balance-panel} + core/state/ops/oldest-first.ts
FE-305: features/front-desk/ops-petty-cash-sheet (+ day-summary petty hook)
FE-306: features/front-desk/{ops-blind-drawer-close-dialog, ops-day-summary-page}
FE-401: core/state/clinical/consultation.store + features/cockpit/{doctor-command-deck, doctor-directives-widget(skeleton full FE-701)}
FE-402: features/cockpit/doctor-mse-chip-panel + shared/forms/mse.form
FE-403: features/cockpit/{doctor-encounter-editor, doctor-consult-room(skeleton full FE-601)}
FE-404: features/cockpit/{encounter-signoff-sheet, addendum-drawer, doctor-chart-timeline}
FE-405: core/state/clinical/medication.store + features/cockpit/doctor-medication-tracker
FE-501: core/state/clinical/vault.holder + features/cockpit/doctor-vault-page + core/guards/vault.guard(full)
FE-502: features/cockpit/vault-note-reader + core/state/clinical/vault-scrub.ts
FE-503: features/cockpit/vault-shred-modal
FE-601: core/state/clinical/scribe.store(skeleton) + features/cockpit/scribe-audio-bar + core/utils/audio-buffer.ts
FE-602: features/cockpit/{scribe-consent-gate, scribe-withdraw-sheet}
FE-603: features/cockpit/scribe-cycle1-panel
FE-604: features/cockpit/scribe-cycle2-panel
FE-605: features/cockpit/{scribe-review-grid, doctor-scribe-studio}
FE-701: core/state/ops/intercom.store + features/front-desk/ops-intercom-dock + features/cockpit/doctor-directives-widget(full)
FE-702: core/state/clinical/supervision.store + cockpit supervision-views/* + doctor-user-admin
FE-703: features/cockpit/discrepancy-monitor + core/state/clinical/invariant-copy.ts
FE-704: features/cockpit/{audit-feed-explorer, audit-feed-secretary}
FE-705: tests/tripwires/ft-1…ft-8 + tests/e2e/j-* + docs/frontend/STAGING_SIGNOFF.md
```

---

## Appendix C — Sprint Gate Command Reference (copy-paste)

Every sprint gate runs the same five commands; Sprint 7 adds E2E + dist audit. Do NOT substitute `Select-Object -First` truncation — full output is captured to file by the runner.

```powershell
npx tsc --noEmit
npx eslint src --max-warnings=0
npx stylelint "src/**/*.{css,scss}"
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
# Sprint 7 only, after the five above:
npx ng e2e --configuration staging
Get-ChildItem dist\front-desk-*.js | Select-String -Pattern '/ehr/|/scribe/|/vault/|/supervision/|VaultHolder|ScribeStore'  # expect ZERO hits (FT-7)
```

Targeted suites (ticket slices) use `--include` filters, e.g. `npx ng test --watch=false --browsers=ChromeHeadless --include="**/queue*spec.ts"`. Logical-property violations fail at the `eslint` (template `no-physical-classes`) + `stylelint` (property-disallowed-list) steps — either red blocks the sprint.

---

## Appendix D — Definition of Done & Staging Sign-off (FE-705 checklist)

1. All 37 tickets DONE (acceptance + gate slices green, no open TODOs in ticket scope).
2. All 8 sprint gates green consecutively on a clean checkout (no `--force`, no skipped specs).
3. FT-1…FT-8 green in CI (blocking jobs, not advisory).
4. Chunk budgets hold; `dir=rtl` smoke (board, checkout, dock, consult room, review grid) shows zero overflow + mirrored drawer/dock; `.dark` parity holds per Step-3 §1.7 ledger.
5. E2E J-01/J-03/J-04/J-05/J-06/J-07/J-08 (+ J-02 candidate path) pass against staging backend.
6. `docs/frontend/STAGING_SIGNOFF.md` merged with: resolved versions, gate transcripts, chunk baselines, waiver log, residual risks (T-1 shoulder-surfing → blur + auto-lock + training), explicit GO/NO-GO + signatories.
7. Scope discipline: zero F-01…F-10 / X-01/X-02 affordance merged; any such request re-enters via WBS amendment (contract + RBAC + SecretSafe + tripwire, per Step-1 §5.3/P-12).

> **Next step after this WBS (Step 6):** execute FE-001 on a clean branch in `D:\Clinic-front`. DO NOT batch sprints; land Sprint 0, tag it, then proceed in FE numeric order. Any wire drift discovered during implementation MUST be logged as a new `GAP-*`/amendment here before code adapts to it.
