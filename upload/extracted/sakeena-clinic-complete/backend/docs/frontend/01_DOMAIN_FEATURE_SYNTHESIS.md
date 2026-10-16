# Master Frontend Domain & Feature Playbook
## Phase 1 — Step 1: Domain Synthesis & Clinical Feature Scope Reconnaissance

> **Document:** `docs/frontend/01_DOMAIN_FEATURE_SYNTHESIS.md`
> **Status:** APPROVED FOR STEP 2 (Angular Architecture Specification)
> **Scope:** Frontend domain synthesis only. No code, no scaffolding, no component implementation.
> **Inputs (normative, inspected on disk at `D:\Clinic\docs\`):**
>
> | # | Artifact | Version / Status | Authority for frontend |
> |---|----------|------------------|------------------------|
> | 1 | `API_CONTRACTS.md` | RPS-2 applied, 223 lines | REST DTO shapes, error codes, WebSocket frames, RBAC tags, idempotency rules |
> | 2 | `DATABASE_SCHEMA_SPEC.md` | RPS-2 applied, incl. §14 canon SQL + §15 INV-1..10 | Severed-relation topology, enums, derivation rules that the UI must never violate |
> | 3 | `BACKEND_TASKS_WBS.md` | RPS-2 build order BE-101→702 + hardening | Build-order sequencing that constrains frontend integration order |
> | 4 | `PROJECT_CONVENTIONS.md` | CONV-01..10, App. B/C/F | Allowlist-first SecretSafe, error envelope, tripwire matrix the frontend must mirror |
> | 5 | Clinical Practice Feature Charter (brief, §2 below) | 43-feature matrix | Persona scope, interaction-model requirements, deferred/excluded discipline |
>
> **Precedence rule:** Where the Charter and a backend spec disagree, the **backend spec wins for wire behavior** and the discrepancy is logged in the Gap Register (§4.9). The Charter wins for **interaction-model intent**. Neither document may be silently extended — see §5.3.
> **Next step after this playbook:** `docs/frontend/02_FRONTEND_ARCH_SPEC.md` (Angular route tree, module boundaries, state model, API client design).

---

## Table of Contents

1. [Executive Clinical Vision & Architecture Principles](#1-executive-clinical-vision--architecture-principles)
2. [Persona Workflows & Component Mapping](#2-persona-workflows--component-mapping)
3. [Pure-Frontend & Client-Side Feature Capabilities](#3-pure-frontend--client-side-feature-capabilities)
4. [Backend Contracts & Invariant Cross-Examination](#4-backend-contracts--invariant-cross-examination)
5. [Deferred & Excluded Features Matrix](#5-deferred--excluded-features-matrix)
6. [Architectural Readiness Statement](#6-architectural-readiness-statement)
7. [Appendix A — Endpoint → UI Surface Index](#appendix-a--endpoint--ui-surface-index)
8. [Appendix B — Canonical Enums & State Machines](#appendix-b--canonical-enums--state-machines)
9. [Appendix C — Glossary](#appendix-c--glossary)

---

## 1. Executive Clinical Vision & Architecture Principles

### 1.1 The two-cockpit thesis

The practice is one clinic with **two mutually blind operational realities**:

- **The Secretary Desk** is a *logistics and money terminal*. It sees identities, queue order, fees, debts, receipts, shifts, and intercom. It must move fast (sub-second check-in, drag-and-drop queue, one-click billing) and it must never, under any circumstance, observe or carry clinical content.
- **The Doctor Cockpit** is a *clinical and supervisory terminal*. It sees everything the desk sees (oversight) plus the entire clinical plane (SOAP, MSE, diagnoses, medications, vault, scribe). It must be calm during consultation (hands-free audio, one-thumb MSE chips, AI-assisted charting) and authoritative outside it (call-next, fee waivers, discrepancy review, shift force-close).

The frontend's job is to make these two realities feel like **one coherent practice** to the people running it, while keeping them **provably disconnected** where the law, the threat model, and the backend demand it. The bridge points are narrow, explicit, and operational-only:

| Bridge | Direction | Content allowed | Content forbidden |
|---|---|---|---|
| Queue check-in → Doctor "call next" | Desk → Doctor | Operational queue entry (name, position, emergency flag, wait) | Any chart content |
| Doctor "call next / skip / undo-complete" → Desk board | Doctor → Desk | Status transitions, `queueVersion` | Diagnoses, SOAP, MSE |
| Doctor fee waiver (`DOCTOR_COMPLIMENTARY`) → Desk cashier | Doctor → Desk | `billing.invoiceUpdated` totals only | Reason text is operational-only and length-capped |
| Check-in debt alert | Desk-local | Outstanding totals + `hasDebtAlert` | Which visits/encounters the debt relates to clinically |
| Checkout (desk) after doctor `complete` | Desk ↔ Doctor | Invoice totals, receipt identity | Encounter linkage (correlation is a DOCTOR-only second lookup, never a shared view) |

**Non-bridge rule (load-bearing):** The RPS-2 backend *severed* every operational→clinical Prisma relation (DB-02). The frontend must not re-stitch them in the browser. There is no "visit card that shows both the invoice and the SOAP" — that composite view **must not be designed, built, or shipped** for any persona. The Doctor may open a patient chart and, separately, that patient's balance; the UI must keep those two queries and two surfaces disjoint.

### 1.2 How the frontend bridges Desk and Cockpit (the handoff spine)

One patient visit traverses both cockpits in a fixed spine the UI must enforce:

```
SEARCH → REGISTER (if new) → CHECK-IN (advisory debtAlert — never blocks, never requires acknowledgement) → QUEUE (live, OCC)
  → CALL-NEXT (doctor) → IN_CONSULTATION
  → CONSULT (audio + MSE + AI scribe + meds + vault, doctor-only)
  → COMPLETE (doctor, auto-creates invoice shell)
  → CHECKOUT / PAY (desk, fee + reason + floor + idempotency)
  → RECEIPTS → SHIFT SUMMARY → BLIND CLOSE (desk) → POST-CLOSE SUPERVISION (doctor)
```

UI consequences:

1. **The queue is the single shared source of truth.** Both cockpits render from the same versioned snapshot (`queueVersion`), converge on reconnect in <1s, and lose identically on `409 STALE_QUEUE` (refetch, never force).
2. **The `complete → invoice shell → checkout` chain is the money spine.** `POST /queue/:entryId/complete` auto-creates an Invoice shell (UNPAID, with the zero-amount CHARGE traceability row per DB-07 conventions); the desk's checkout screen then sets `finalFeeMinor`, collects, and justifies discounts. The UI must present checkout as *completing* a visit, never as creating one from scratch — and must gracefully handle the `409 already invoiced` path by pivoting to the pay-down surface.
3. **Directives flow doctor → desk as data, not as chat.** `DOCTOR_COMPLIMENTARY` executes a real billing mutation (idempotent) and emits `billing.invoiceUpdated`; `DOCTOR_NEXT` drives the queue machine; `DOCTOR_FOLLOWUP` creates a `FollowUpTask`. The desk dock must render each directive with its *effect receipt* (invoice id, new queueVersion), not just its text.
4. **Money is write-once, correct-forward.** Invoices are never edited after creation (discount is fixed at creation; shortfalls go through `/pay`; errors through REVERSAL; uncollectible through write-off). Every billing UI must be designed as *append-only forms*, with no "edit invoice" affordance anywhere.

### 1.3 The Zero-Knowledge UI barrier (structural prevention, not promises)

Backend T-1 accepts screen shoulder-surfing as a residual procedural risk; the frontend's duty is to make leakage **structurally impossible in data flow**, leaving only the physical-screen residual. Seven mechanisms, all mandatory for the architecture spec:

**ZK-1 — Type-level segregation mirroring `SecretSafe<T>`.**
The frontend defines two disjoint model families: `Ops*` models (patient identity, queue, invoices, receipts, shifts, intercom) and `Clinical*` models (encounters, medications, vault, scribe). No component, service, or store slice reachable from a Secretary route may import, inject, reference, or type a `Clinical*` model. This is a lint-enforced boundary (import graph rule), mirroring the backend's "no `toSecret` mapper exists for clinical types — hard 403."

**ZK-2 — Route-guard segregation.**
Secretary routes and Doctor routes are separate route subtrees with separate guards (`SecretaryGuard`, `DoctorGuard`) resolved from `GET /auth/me` role. A Secretary session must have **no registered URL** that returns clinical data — not even a hidden one. Deep-linking a doctor URL as a secretary lands on a 403 page, never a partial render or a skeleton that leaks field names.

**ZK-3 — HTTP surface segregation.**
The frontend API client exposes two facades: `OpsApi` (queue, billing, shifts, receipts, intercom, patient identity, follow-ups, supervision-safe subsets) and `ClinicalApi` (EHR, meds, vault, scribe). `ClinicalApi` is provided only inside the Doctor route subtree's injector scope; the Secretary subtree cannot resolve it at all. A secretary build of the app must be able to pass a static "no clinical endpoint string reachable" audit.

**ZK-4 — Store segregation.**
No shared entity cache mixes operational and clinical records for the same patient. The Ops store holds `patientId → identity/queue/balance`; the Clinical store (doctor-only) holds `patientId → chart/meds/vault/scribe`. Cross-store joins are forbidden: the UI never renders one card from both stores.

**ZK-5 — Intercom/audit text discipline (backend T-3).**
`CUSTOM_TEXT` is length-capped and the backend emits a clinical-pattern warning. The frontend adds: (a) a visible "operational only — never type diagnoses, drug names, or findings" hint on every free-text composer for both roles; (b) automatic refusal to pre-fill any composer with clinical content; (c) no copy/paste affordance from clinical surfaces into intercom composers (no "send to desk" buttons on SOAP/MSE/meds/vault screens).

**ZK-6 — Vault ephemerality.**
Vault plaintext returned by `GET /ehr/vault/patients/:id/notes` lives only in a doctor-scoped in-memory holder, is never written to `localStorage`/`sessionStorage`/IndexedDB, never enters logs or error reports, and is scrubbed on lock, logout, role switch, tab hide (configurable), and route exit from the vault surface. Opening the vault shows the `VAULT_ACCESS` audit notice: every read is logged (id + timestamp only).

**ZK-7 — Shoulder-surfing hygiene (procedural support for T-1 residual).**
Privacy mode (one-click content blur on clinical surfaces), auto-lock on idle, no clinical content in document titles, toasts, or notification previews, and print/PDF export restricted to the doctor subtree (receipts only, which are operational).

### 1.4 Architecture principles (P-01…P-12)

- **P-01 Server is the authority; the client is an optimistic renderer.** Every mutation result is provisional until the versioned response or WS frame confirms it. Queue order, invoice status, shift status, and scribe state converge to server snapshots.
- **P-02 Version everything the server versions.** `queueVersion` is carried in client state alongside the queue; any reorder/emergency attempt uses the latest seen version; `409 STALE_QUEUE` always wins over local intent.
- **P-03 Idempotency is a UX feature.** Every money/queue-complimentary action pre-generates a UUIDv4 intent key, persists it in a local outbox until terminal confirmation, and treats `200 + Idempotent-Replayed: true` as success — not as an error.
- **P-04 The blind drawer is blind by construction.** The close surface holds no `expectedCashMinor` field, no computed "projected drawer" value, and no selector that could derive one (§4.3). Blindness is a type-level absence, not a hidden div.
- **P-05 Append-only money UI.** No edit affordances on invoices, receipts, or petty rows. Corrections are new rows (pay, reversal, write-off, addendum). Disabled buttons explain the forward path ("Pay down", "Request doctor reversal", "Add addendum").
- **P-06 Explicit is better than absent.** MSE selectors, discount reasons, emergency reasons, cessation reasons, reversal reasons, write-off reasons, undo reasons — the UI never submits an empty justification where the contract demands one, and distinguishes "not performed / not applicable" from "not yet entered."
- **P-07 State machines are rendered, not implied.** Queue transitions, scribe lifecycle, shift lifecycle, follow-up status, and invoice status each get a single canonical client-side machine whose transitions are a subset of the server machine; illegal transitions are disabled with the reason surfaced.
- **P-08 Errors are a catalogue, not strings.** The full backend code list (§4.5) maps to deterministic UI behavior: field errors, blocking dialogs, silent convergence, or escalation. Unknown codes fall back to a safe generic + incident id, never to a retry loop.
- **P-09 Realtime degrades to polling snapshots, never to invention.** On WS loss, surfaces show staleness badges with last `serverAt`/`queueVersion` and fall back to REST snapshots; the client never extrapolates queue positions or balances locally.
- **P-10 Every number is minor units until the last render.** Formatting (currency, decimals) happens at the view edge from `GET /settings`; no float arithmetic anywhere in the money path.
- **P-11 Consent and retention are visible.** Scribe sessions show `consentStatus`, `audioRetentionUntil` countdown; WITHDRAWN/PURGED states lock the surface with the exact recovery path (new session). Withdraw is a deliberate, confirmed, audited action.
- **P-12 Scope changes go through the gate.** §5.3: no deferred feature enters the build, and no excluded feature is revisited, without a ratified contract amendment (RBAC tag + Zod + SecretSafe note + tripwire test, per the API contract preamble).

---

## 2. Persona Workflows & Component Mapping

### 2.1 Feature census (the 43)

- **31 Core MVP:** Secretary S-01…S-18 (18) + Doctor D-01…D-13 (13).
- **10 Deferred:** F-01…F-10 (§5.1).
- **2 Excluded:** X-01, X-02 (§5.2).

Total 18 + 13 + 10 + 2 = **43**. Every Charter bullet maps to exactly one feature ID below; nothing is double-counted, nothing is orphaned.

### 2.2 Secretary surface inventory (route/view intent names — not code)

| Surface intent | Kind | Purpose |
|---|---|---|
| `OpsHome` (desk dashboard) | Route | Shift status, queue summary, today's collections, debt alerts, pending directives |
| `OpsWaitingRoomBoard` | Route | Live queue: DnD reorder, emergency flags, wait times, call/skip state |
| `OpsCheckInDialog` | Modal | Returning-patient search → debt-ack → single-click queue entry |
| `OpsPatientRegistrationWizard` | Modal (stepped) | Rapid core-identity capture with duplicate-candidate resolution |
| `OpsCrisisIntakeDialog` | Modal (minimal) | Emergency-anchor-only fast path onto the waiting list |
| `OpsDebtSettlementSheet` | Drawer/modal | Oldest-first pay-down across open invoices |
| `OpsBillingCheckoutSheet` | Drawer/modal | Suggested fee → adjust → reason → method → collect |
| `OpsReceiptArchivePage` | Route | Historical (closed-shift) receipt query; open-shift access suppressed |
| `OpsPatientBalancePanel` | Drawer | Per-patient ledger lines + pay-down entry |
| `OpsPettyCashSheet` | Drawer/modal | Expense-only petty logging with mandatory purpose |
| `OpsBlindDrawerCloseDialog` | Modal (gated) | Actual-count entry with zero expected knowledge + reveal screen |
| `OpsDaySummaryPage` | Route | Totals served, gross/net, petty, method breakdown, discount/write-off/complimentary/reversal counts |
| `OpsIntercomDock` | Persistent dock | Templates, directive listener, history |
| `OpsFollowUpBoard` | Route/section | `REQUESTED → SCHEDULED|DONE|CANCELLED (DONE/CANCELLED terminal; SECRETARY schedules/completes, DOCTOR cancels)` task list |
| `OpsShiftOpenDialog` | Modal | Open today's shift (opening float, business date) |

### 2.3 Secretary feature matrix (S-01…S-18)

**S-01 — Instant check-in for returning patients.**
UI: `OpsCheckInDialog` with debounced multi-parameter search (phone / national ID / name via `GET /patients/search`), result rows showing `fullName`, `phone`, `nationalId`, `lastVisitAt`, `hasDebtAlert` + `outstandingBalanceMinor`. Single "Check in" click dispatches `POST /queue/check-in` with a pre-generated Idempotency-Key. If the server answers `200 {advisory debtAlert, debtAlert}`, the dialog pivots to the debt-ack step (S-12) and retries with `acknowledged:true`. `409 duplicate open entry` surfaces the existing entry with a "jump to queue" action.

**S-02 — New patient rapid registration.**
UI: `OpsPatientRegistrationWizard` capturing exactly the contract body: `fullName`, `age`, `phone?`, `nationalId?`, `emergencyContact{name,phone,relation}`, `physicalAddress`, `adminNotes? (≤500 chars, with live counter)`. `409 with candidate` shows the duplicate candidate side-by-side with "use existing" vs "override with reason" (override only if the contract permits; default is use-existing). On `201`, offers immediate check-in (chains S-01).

**S-03 — Crisis / psychiatric distress intake path.**
UI: `OpsCrisisIntakeDialog` — deliberately minimal: patient identifier (or rapid registration lite), **emergency anchor only** (contact name + phone + relation), optional one-line operational note. Creates the waiting-list entry via `POST /queue/check-in` with `isEmergency:true + emergencyReason` (auto-prefilled "crisis intake", editable), without blocking on full identity. The full record is completed later via `PATCH /patients/:id`.

**S-04 — Dynamic waiting queue state management.**
UI: `OpsWaitingRoomBoard` renders `GET /queue` + `queue.updated` frames: grouped lanes or a single ordered list with status chips (`WAITING / IN_CONSULTATION / COMPLETED / SKIPPED`), `position`, `isEmergency` badge, `estimatedWaitMin`, `checkedInAt`. Secretary-visible transitions are limited to `requeue` (SKIPPED→WAITING); call/skip/complete/undo are doctor-only and appear as read-only state with actor attribution from WS frames. `400 illegal transition` is unreachable by design (illegal buttons are disabled) and handled as convergence if it ever occurs.

**S-05 — Manual drag-and-drop queue reordering (OCC-governed).**
UI: drag handles on WAITING rows only; emergency-flagged rows are pinned and non-droppable-below (burying is a `422` — the UI prevents it structurally with a "locked at top until unflagged" affordance). On drop, the client sends `POST /queue/reorder` with **both** `If-Match: <queueVersion>` header **and** `expectedQueueVersion` body (must match each other and the latest snapshot) plus Idempotency-Key, with `orderedEntryIds` covering the WAITING set. Optimistic ghost reorder renders instantly; `409 STALE_QUEUE` snaps back to the returned current snapshot with a "queue changed under you — review and retry" notice. No auto-retry of the user's drag result.

**S-06 — Emergency triage indicator.**
UI: per-row "flag emergency" action (both roles) opening a reason-required dialog; on confirm, `POST /queue/:entryId/emergency {isEmergency:true, reason}` with `If-Match` + Idempotency-Key → entry jumps to position 0 with a persistent red badge showing reason excerpt. Unflag requires a second reason (`EMERGENCY_UNFLAG` audit) — the UI enforces reason capture again. While any emergency is active, reorder targets below position 0 are disabled.

**S-07 — Realtime wait-time estimator.**
UI: per-row `estimatedWaitMin` from `queue.updated` frames and `GET /queue/wait-times` (`precedingCount × avgConsultDurationMin`, excluding active/completed/skipped; multi-emergency ordered by flag time). The board header shows `avgConsultDurationMin` from settings and the head-of-queue "now serving in ≈ X min". No client-side wait formula — the server value is rendered.

**S-08 — Suggested consultation fee with manual adjustment.**
UI: `OpsBillingCheckoutSheet` pre-fills `standardFeeMinor` from `GET /settings`; the cashier may raise freely or lower (which arms S-09/S-10). Downward adjustment immediately reveals the reason field and the floor meter (see S-10). The sheet shows the queue entry context (name, position) and the invoice shell state if `complete` already auto-created it.

**S-09 — Mandatory discount justification.**
UI: whenever `finalFeeMinor < standardFeeMinor` on a non-complimentary checkout, the reason field is required and non-blank (empty string never satisfies — §1.4 P-06). Submit without it is blocked client-side; `422` from the server maps back to the same field. The reason travels into the `DISCOUNT` audit event.

**S-10 — Secretary discount floor protection.**
UI: the checkout sheet renders the floor from settings (`secretaryMaxDiscountMinor` absolute cap and `secretaryMaxDiscountPct`, tighter wins) as a live "max allowed discount" meter. Breach is blocked client-side with "requires doctor" guidance; `403 FLOOR_VIOLATION` (server-side, DB-09) maps to the same guidance plus audit notice. Write-off is **not** offered here — it is a separate doctor-only path (S-12/D-01 context).

**S-11 — Multi-channel payment method capture.**
UI: three client presets — Physical Cash, Instant Bank Transfer, Mobile Wallet — mapped to the wire enum `CASH | OTHER` (Cash→`CASH`; Transfer/Wallet→`OTHER`). The preset label is retained client-side for the drawer/session UX and printed receipt, but the persisted `Receipt.method` is only `CASH|OTHER`. Quick-amount chips (exact fee, exact outstanding, custom) feed `collectedMinor` for `POST /billing/checkout` and `POST /billing/invoices/:id/pay`.

**S-12 — Debt pay-down & settlement tracking (oldest-first).**
UI: `hasDebtAlert` badges on search rows, check-in dialog, and queue rows. `OpsDebtSettlementSheet` / `OpsPatientBalancePanel` lists `GET /patients/:id/balance` `lines[]` **oldest-first** and applies collections to the oldest open line first via sequential `POST /billing/invoices/:id/pay` calls — **the server collects per-invoice only, so oldest-first allocation is a client-side orchestration rule** (GAP-09). Each pay carries its own Idempotency-Key; partial allocation across lines shows a running "remaining to allocate" meter.

**S-13 — Digital receipts archive (access-controlled).**
UI: `OpsReceiptArchivePage` queries `GET /receipts?patientId=&shiftId=` and `GET /receipts/:id` — **closed shifts only**. While the current shift is `OPEN`, the archive navigation for the open shift is suppressed for the Secretary role (Charter blind-count protection; server ratification pending — GAP-03). Receipt rows show `type` (`CHARGE|REVERSAL`), `amountMinor`, `method`, reversal linkage, reason; there is no edit/delete affordance (immutable + DB REVOKE).

**S-14 — Internal intercom dock (desk side).**
UI: `OpsIntercomDock` — persistent mini-dock / floating drawer, silent (badge + subtle pulse, no sound by default). Rapid templates map to wire types: "Waiting room disturbance/noise" → `SEC_DISRUPTION`; "Pharmacy inquiry on line" → `SEC_PHARMACY_LAB`; "Patient arrived early" → `CUSTOM_TEXT` (capped, operational-only hint per ZK-5). Directive listener renders doctor messages with effect receipts: `DOCTOR_COMPLIMENTARY` shows the zeroed invoice; `DOCTOR_NEXT` shows the new `IN_CONSULTATION` entry + `queueVersion`; `DOCTOR_FOLLOWUP` shows the created task. History via `GET /intercom?limit&cursor`.

**S-15 — Petty cash logging (expense-only in Phase 1).**
UI: `OpsPettyCashSheet` — `amountMinor > 0` + mandatory non-blank `purpose`, one Idempotency-Key per entry, `POST /shifts/:id/petty` (OPEN shift only, `lockShift` server-side). **The Charter's `INJECTION` direction has no wire/model representation and contradicts INV-8 (all petty deducts) — Phase 1 implements EXPENSE-only; float top-ups happen at shift open via `openingFloatMinor`** (GAP-04). List via `GET /shifts/:id/petty`.

**S-16 — Blind drawer count + discrepancy reveal.**
UI: `OpsBlindDrawerCloseDialog` in two strict phases: (1) count entry — a bare numeric input for `actualCountedMinor` with no expected value, no hint, no history, no computed projection anywhere on the screen (P-04); submit once via `POST /shifts/:id/close` with Idempotency-Key; (2) reveal — only after the persisted `200` response, show `expectedCashMinor`, `actualCountedMinor`, `differenceMinor`, and `result` (`BALANCED|SURPLUS|DEFICIT`). `422` open-entries-remaining offers "resolve queue" (non-doctor) or doctor force-with-reason; `409 INVARIANT_VIOLATION` lists `discrepancies[]` with resolve-or-escalate paths.

**S-17 — Daily financial summary.**
UI: `OpsDaySummaryPage` from `GET /shifts/:id/summary`: `totalServed`, `grossCollectedMinor`, `pettyTotalMinor` + items, `netTotalMinor`, per-method breakdown, `discountTotalMinor` + count, `newDebtTotalMinor`, `writeOffTotalMinor`, `complimentaryCount`, `reversalCount`, plus `result`/`differenceMinor` post-close (null while open). Pre-close, the page renders with the expected/difference slots explicitly absent — never zero-filled (zero is a value; null is blindness).

**S-18 — Absolute zero-knowledge privacy isolation.**
UI: not a screen but a structural property — ZK-1…ZK-7 (§1.3) enforced across every Secretary surface: no clinical route, no clinical API facade, no clinical model import, no clinical pre-fill, no clinical toast/title/print. Verified by the Secretary allowlist snapshot test mirror (§4.7).

### 2.4 Doctor surface inventory

| Surface intent | Kind | Purpose |
|---|---|---|
| `DoctorCommandDeck` | Route (home) | Shift oversight, front-desk feed, discrepancies, readiness, unsigned backlog, queue command |
| `DoctorConsultRoom` | Route | Active consultation: audio, MSE, scribe studio, encounter editor |
| `DoctorScribeStudio` | Panel (in consult) | Gen-2 pipeline UI: session → cycle-1 → cycle-2 → review → commit (canonical, Decision 4) |
| `DoctorMseChipPanel` | Panel | Four explicit selectors incl. `NOT_PERFORMED` |
| `DoctorChartTimeline` | Route | Reverse-chron encounter cards (SIGNED only): SOAP, MSE, diagnoses |
| `DoctorEncounterEditor` | Drawer/modal | Manual SOAP draft → sign → addenda |
| `DoctorVaultPage` | Route (segregated) | Ciphertext notes: write, read (ephemeral), shred-pending-ratification |
| `DoctorMedicationTracker` | Route/section | Active vs discontinued, titration action, cessation reasons, overlap advisory |
| `DoctorDirectivesWidget` | Floating widget | One-click Call-Next / Complimentary / Follow-up |
| `DoctorSupervisionViews` | Sections | Front-desk activity, cash summary + audit coverage, discrepancies, shift readiness |
| `DoctorUserAdmin` | Route | Secretary provisioning, deactivate/activate (BE-104) |

### 2.5 Doctor feature matrix (D-01…D-13)

**D-01 — Full practice oversight.**
UI: `DoctorCommandDeck` + `DoctorSupervisionViews` combine `GET /supervision/front-desk-activity`, `/cash-summary` (+`auditCoverage`), `/discrepancies` (`invViolations[{inv, detail, entities}]`, `missingAudit`, `staleQueue`), and `/shift-readiness` (`canClose`, `blockers[]`, `openEntries`). Live `supervision.discrepancy` WS frames (doctor room only) raise non-blocking alerts. Unsigned-notes backlog is tracked per GAP-02 (local roster + proposed listing endpoint).

**D-02 — Waiting room command.**
UI: `DoctorCommandDeck` + `DoctorDirectivesWidget`: "Call Next" (`POST /queue/:entryId/call-next`, `{force?}` with force requiring explicit confirm + audit when single-consult `409` fires), temporary skip (`/skip`, reversible via `/requeue`), `complete` (auto-invoice shell), and single-hop `undo-complete` (`{reason}` + Idempotency-Key, within the ~15-min window, once — GAP-11 for window visibility). Every command shows the resulting `queueVersion` and the WS echo.

**D-03 — Hands-free consultation audio ingestion.**
UI: `DoctorConsultRoom` audio bar — record/pause/stop with a live waveform from the Web Audio `AnalyserNode` (client-side only, §3), local `MediaRecorder` chunk buffering, duration meter with the **60-second dictation cap countdown**, and session state (`UPLOADED → TRANSCRIBING → TRANSCRIBED / FAILED / WITHDRAWN / PURGED`). Upload via `POST /scribe/sessions/:id/audio` (chunked); `410 GONE` (withdrawn) routes to "start a new session"; `422` cap breach is pre-empted by the countdown.

**D-04 — Rapid MSE chip selectors.**
UI: `DoctorMseChipPanel` — four single-select chip rows (Appearance, Behavior, Speech Coherence, Mood & Affect), each **required and explicit, including a `NOT_PERFORMED` chip** (DB-14/CONV-09). Missing (no chip) is a distinct validation state from `NOT_PERFORMED` (server `422 MSE_REQUIRED` distinguishes them — the UI mirrors that distinction). The panel feeds both manual encounters and scribe drafts unchanged.

**D-05 — Three-pass AI Scribe workflow (2 Gemini syntheses + 1 human commit).**
UI: `DoctorScribeStudio` state machine — *Pass 1* ambient (`AMBIENT_LIVE` session, consent-gated) → transcribe → dialogue analysis review (chief complaint, symptoms, mood/affect, suggestions); *Pass 2* closing dictation (`DICTATION_60S` session, 30-second doctor speech, server prioritizes doctor decisions over dialogue); *Pass 3* SOAP draft review, manual correction, and atomic commit creating `Encounter` (source `SCRIBE`) + linked `Medication` rows. Audio is uploaded INLINE per cycle ({audioBase64, mimeType} strict ≤15 MB); typed dictation is a client-side affordance only. Consent (`consentConfirmed`, `consentStatus`, `withdraw-consent` with optional reason), `audioRetentionUntil` countdown, and `WITHDRAWN/PURGED` locks are first-class states, not error toasts. (Gen-2 is the canonical and only workflow — Decision 4; GAP-06/GAP-08 polling and multi-draft binding are retired with the Gen-1 plan.)

**D-06 — Chronological visit timeline.**
UI: `DoctorChartTimeline` — reverse-chron cards from `GET /ehr/patients/:id/chart?limit&cursor` (**SIGNED only**): signed SOAP, MSE (with `NOT_PERFORMED` rendered as "not performed", never blank), diagnoses, `signedAt`, source badge (`MANUAL|SCRIBE`), `addendumCount`. Drafts never appear here.

**D-07 — Independent manual SOAP workflow.**
UI: `DoctorEncounterEditor` — `POST /ehr/encounters` (source `MANUAL`, **no queue required** — phone follow-ups, chart corrections), partial draft editing via draft-only `PATCH`, explicit sign via `POST /ehr/encounters/:id/sign` (`{finalSoap?}`, complete-SOAP + explicit-MSE validation; `409 already SIGNED`, `422 incomplete`). No `If-Match` headers are sent (GAP-01); currency of a draft is protected by draft-only PATCH semantics + version chain.

**D-08 — Append-only addenda.**
UI: on any SIGNED encounter, "Add addendum" (`POST /ehr/encounters/:id/append {addendumText}` → versioned `201`); the original is never editable post-sign (the editor locks with a "signed — addendum only" state). Timeline cards show version history via `addendumCount`.

**D-09 — Encrypted therapy vault.**
UI: `DoctorVaultPage` (segregated route, separate authz check): write (`POST …/vault/patients/:id/notes {content}` → `{noteId, createdAt, keyId}`, plaintext never echoed back), read (ephemeral in-memory holder per ZK-6, `VAULT_ACCESS` notice), key-label (`keyId`) display per the Appendix B custody checklist. **Shred (irrevocable + audit tombstone) has no backend endpoint today — the UI must not fake it; shred ships only after ratification** (GAP-05).

**D-10 — Longitudinal medication tracker.**
UI: `DoctorMedicationTracker` — Active vs Discontinued lists from `GET /ehr/patients/:id/medications?status=`, discontinue requiring `cessationReason` (+`stoppedAt` server-side; `422` no-reason, `400` already-discontinued). No reactivation affordance (new row instead — history retained).

**D-11 — Atomic titration.**
UI: single "Titrate" action that composes **create-new-ACTIVE + discontinue-old-with-reason** as one confirmed user intent. There is no server-side atomic endpoint, so the UI implements a guarded two-step saga with explicit partial-failure recovery (GAP-04-class; see §4.6): on half-completion it surfaces exactly which half landed and the one-click repair.

**D-12 — Frontend drug-safety overlap flags.**
UI: purely client-side advisory badges on overlapping active psychotropic regimens (same/similar agent, overlapping date ranges). **Advisory only — never authoritative, never blocking, always labeled as such**; the backend performs no interaction checking and the UI must not imply otherwise.

**D-13 — Floating directives widget (doctor side).**
UI: `DoctorDirectivesWidget` — persistent floating control: "Call Next Patient" (`DOCTOR_NEXT`), "Convert Visit to Complimentary" (`DOCTOR_COMPLIMENTARY` + Idempotency-Key, executes the zeroing + emits `billing.invoiceUpdated`), "Schedule Follow-up Task" (`DOCTOR_FOLLOWUP` → `FollowUpTask REQUESTED`, `relatedQueueEntryId`). Forged-type sends are impossible (type-ownership is role-derived, not user-selected).

### 2.6 End-to-end journeys (acceptance narratives for Step 2)

- **J-01 Routine return visit:** search → debt-ack (if due) → check-in → live board → call-next → consult (audio+MSE+scribe or manual) → complete → checkout (fee+reason+method) → receipt → (later) blind close.
- **J-02 New patient:** wizard → duplicate-candidate check → register → immediate check-in → J-01 tail.
- **J-03 Crisis intake:** minimal dialog → emergency entry at position 0 → consult → checkout/complimentary → full identity completion.
- **J-04 Discounted visit:** checkout below standard → reason → floor meter → (breach → doctor path) → collect → summary reflects `discountTotalMinor`.
- **J-05 Debt across visits:** balance lines oldest-first → sequential pays → next-visit check-in shows reduced/nil alert.
- **J-06 Error correction:** wrong charge → doctor reversal with reason (REVERSAL row, original retained) → invoice outstanding recomputed; wrong chart → addendum (original preserved).
- **J-07 Blocked close:** open entries or `discrepancies[]` → resolve queue / resolve invariants / doctor force-with-reason (audited) → reveal → post-close supervision.
- **J-08 Consent withdrawal:** doctor withdraws scribe consent → session locks → transcribe/upload blocked → 30-day purge → `PURGED`, audio ref nulled, bytes gone.

---

## 3. Pure-Frontend & Client-Side Feature Capabilities

Client-side features that improve usability **without changing backend semantics**. Each carries a guardrail: the capability must never invent, pre-empt, or contradict server state.

| ID | Capability | Client mechanism | Guardrail (must not…) |
|---|---|---|---|
| C-01 | Optimistic DnD queue reorder | Ghost list on drop; snap-back on `409` | …auto-retry the drag or keep a diverged order after STALE |
| C-02 | Local audio waveform + level metering | Web Audio `AnalyserNode` + `MediaRecorder` chunk buffering; pause/resume; local retry buffer | …upload without consent; …retain bytes after session close/purge |
| C-03 | Dictation countdown (60 s cap) | Local timer, warn at ~55 s, auto-stop assist | …treat the timer as authoritative (server `422` still handled) |
| C-04 | Undo-complete countdown (~15 min) | Local deadline from the client's own `complete` action | …show a fake server deadline (DTO carries none — GAP-11) |
| C-05 | Idempotency outbox | UUIDv4 per user intent, persisted until terminal `201`/`200-replay`; replay-keyed retry | …reuse a key for a different payload (`422 REUSE` is terminal) |
| C-06 | Payment presets + quick amounts | Cash/Transfer/Wallet presets → `CASH|OTHER`; exact/outstanding/custom chips | …persist the preset label as anything but UI/printed context |
| C-07 | Oldest-first allocation engine | Sort `balance.lines` by date asc; sequential per-invoice pays with running remainder | …net across invoices in one call; server collects per-invoice only |
| C-08 | Keyboard shortcuts + command palette | Call-next, check-in focus, checkout submit, intercom focus; `?` overlay | …expose doctor commands in the secretary palette |
| C-09 | Offline toast buffering | Queue toasts/actions during WS loss; staleness badge with last `queueVersion`/`serverAt` | …extrapolate positions/balances while offline (P-09) |
| C-10 | MSE explicitness machine | Missing vs `NOT_PERFORMED` as distinct states; per-selector validation | …default any selector (no silent `NOT_PERFORMED`) |
| C-11 | Minor-unit money edge | Integer math only; currency/decimals from `GET /settings` at render | …float arithmetic; …hard-code currency |
| C-12 | Blindness-by-absence | Close/summary states have no expected-value field at all | …compute or display any drawer projection pre-reveal (P-04) |
| C-13 | Retention & consent surfacing | `audioRetentionUntil` countdowns; WITHDRAWN/PURGED lock screens with recovery path | …offer transcribe/upload on locked sessions |
| C-14 | Privacy mode + auto-lock | One-click blur, idle lock, clinical-free titles/toasts/prints | …persist vault plaintext anywhere (ZK-6) |
| C-15 | Vault memory hygiene | Ephemeral holder; scrub on lock/logout/route-exit/tab-hide | …enter vault text into logs, error reports, or clipboard history |
| C-16 | Error-catalogue mapping | Deterministic behavior per code (§4.5); incident-id fallback | …retry loops on terminal codes (`REUSE`, `FLOOR_VIOLATION`, `GONE`) |
| C-17 | Search UX | Debounced multi-field search, keyboard navigation, duplicate-candidate compare view | …auto-merge duplicates (server `409` owns identity) |
| C-18 | Form durability | Dirty guards, draft persistence for non-clinical forms only (checkout notes, petty purpose) | …persist clinical drafts to disk (memory/session only) |
| C-19 | Receipt rendering/printing | Client-side receipt layout from `GET /receipts/:id` (closed shifts) | …render open-shift receipts for secretary (GAP-03) |
| C-20 | Relative time + timezone | UTC wire → local render; "x min ago", shift-day boundaries | …recompute wait times locally (server values only) |
| C-21 | Titration saga guard | Two-step composite with half-failure repair screen | …claim atomicity the server doesn't provide |
| C-22 | Overlap advisory flags | Client-side date-range/agent overlap badges | …block, diagnose, or dose-advise (advisory label mandatory) |
| C-23 | Directive effect receipts | Render invoice id / task id / new `queueVersion` per directive | …render directive text as sufficient confirmation |
| C-24 | Session/token hygiene | Silent refresh rotation, 401 → re-login, deactivation → immediate lockout incl. WS | …retry authenticated calls after `403 deactivated` |

---

## 4. Backend Contracts & Invariant Cross-Examination

### 4.1 WebSocket `queue.updated` consumption (snapshot discipline + role channels)

The Charter's "`queue.snapshot`" is realized in the contract as **`queue.updated`** (authoritative snapshot frame) plus the initial REST `GET /queue` snapshot and the `queue.subscribe → immediate snapshot` handshake. All frames carry `queueVersion`; reconnect replays the snapshot; convergence target <1s.

**Frame inventory and role visibility:**

| Server→Client frame | Payload essence | Secretary | Doctor |
|---|---|---|---|
| `queue.updated` | `{queueVersion, shiftId, avgConsultDurationMin, serverAt, entries[]}` (SecretSafe) | Yes — the board | Yes — command deck |
| `queue.called` | `{queueVersion, entryId, patientId, displayName, calledAt}` | Yes | Yes |
| `queue.reordered` | `{queueVersion, orderedEntryIds, actorId, serverAt}` | Yes | Yes |
| `queue.emergency` | `{queueVersion, entryId, isEmergency, position, serverAt}` | Yes | Yes |
| `queue.undoComplete` | `{queueVersion, entryId, status:"IN_CONSULTATION", serverAt}` | Yes (read-only) | Yes |
| `billing.invoiceUpdated` | `{shiftId, invoiceId, status, collectedMinor, outstandingMinor, serverAt}` — totals only | Yes | Yes |
| `intercom.received` | `{id, fromRole, type, text, relatedQueueEntryId, createdAt}` | Yes | Yes |
| `supervision.discrepancy` | `{shiftId, inv, detail, serverAt}` | **No** (doctor room only) | Yes |

Frontend rules: (1) the "dual shape" is a **channel rule, not a payload fork** — both roles receive the identical SecretSafe queue shape; the doctor additionally joins the supervision room; (2) every frame handler is keyed off `queueVersion` monotonicity — a frame with `queueVersion ≤ current` is stale and dropped after the snapshot check, a jump triggers a REST snapshot resync; (3) queue mutation travels **REST only** (`queue.reorder` has no WS mutation path — avoids version races); (4) `intercom.send` is Zod-validated with type-ownership — `DOCTOR_COMPLIMENTARY` requires `idempotencyKey` even over WS and executes the billing mutation + emits `billing.invoiceUpdated` + audit.

### 4.2 OCC mechanics (queueVersion, If-Match, and the encounter correction)

**Queue OCC (normative):** `Shift.queueVersion` increments in-transaction on every queue mutation (check-in, call, skip, requeue, complete, undo-complete, reorder, emergency flag/unflag). Reorder and emergency require **both** `If-Match: <queueVersion>` header **and** matching body field (`expectedQueueVersion` on reorder) plus Idempotency-Key. Mismatch → `409 STALE_QUEUE` **with the current snapshot** — the client applies it and asks the user to re-issue intent. `lockShift` contention on cash paths → `409 SHIFT_LOCKED` with retry guidance (safe to retry: same Idempotency-Key).

**Encounter concurrency (Charter correction — GAP-01):** The Charter's "header `If-Match` on encounters" **does not exist** in the API contract. Encounter concurrency is enforced by (a) draft-only `PATCH` (`400 SIGNED` → use addendum), (b) explicit sign (`409 already SIGNED`, `422 incomplete`), and (c) the scribe draft version chain (`version n+1`, superseded retained). The frontend **must not send `If-Match` on EHR routes**; currency conflicts surface as `409 SIGNED` / version-mismatch, handled by reloading the encounter and routing edits to an addendum.

### 4.3 Blind drawer count UX (null discipline)

Wire facts: `Shift.expectedCashMinor` is derived server-side but **withheld** until `actualCountedMinor` is persisted; `toSecretShiftDto` is blind-aware; `GET /shifts/:id/summary` returns `result:null`, `differenceMinor:null` pre-close; the `POST /shifts/:id/close {actualCountedMinor}` `200` reveals `{expectedCashMinor, actualCountedMinor, differenceMinor, result}` exactly once.

Frontend rules: (1) the close dialog's state type contains **no expected field** (P-04/ZK-analog for money); (2) pre-close summary renders null slots as absent, never `0`; (3) the client **must not compute** `openingFloat + ΣCASH CHARGE − ΣCASH REVERSAL − Σpetty` (INV-8) as a preview — it holds all inputs, so this is a deliberate omission enforced by code review, mirroring tripwire C-12; (4) close requires no open `WAITING/IN_CONSULTATION` entries unless doctor force-with-reason (audited); (5) `CLOSED` is terminal — post-close corrections go through a new-business-date adjustment invoice with doctor audit, never through editing (INV-9; the UI offers no reopen).

### 4.4 Idempotency-Key generation (UUIDv4 intent protocol)

Required on: `POST /billing/checkout`, `/billing/invoices/:id/pay`, `/billing/receipts/:id/reverse`, `/billing/invoices/:id/write-off`, `/shifts/:id/petty`, `/shifts/:id/close`, `/queue/check-in`, and `/intercom` with `DOCTOR_COMPLIMENTARY` (REST and WS alike).

Client protocol: (1) generate UUIDv4 **at user-intent time** (dialog confirm), not at retry time; (2) persist key + payload hash in the outbox (C-05) until terminal success; (3) treat `200 + Idempotent-Replayed: true` as success and reconcile to the returned original (no duplicate toast, no double navigation); (4) on `422 IDEMPOTENCY_KEY_REQUIRED`, attach a key and retry **once**; (5) on `422 IDEMPOTENCY_KEY_REUSE` (same key, different payload hash), **stop** — surface a hard error and require fresh user intent with a new key; (6) scope note: keys are unique per actor+shift+entity — the outbox keys entries by `(route, entityId, shiftId)`.

### 4.5 Error envelope → UX catalogue (complete)

Failure envelope: `{error:{code, message, details:[{field?, issue, expected?}]}}`. Mapping is deterministic:

| Code (HTTP) | UI behavior | Owner surface |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` (422) | Attach key, retry once silently | Outbox (C-05) |
| `IDEMPOTENCY_KEY_REUSE` (422) | Hard stop, fresh intent required | All money surfaces |
| `STALE_QUEUE` (409) | Apply attached snapshot, prompt re-issue | Board, reorder, emergency |
| `SHIFT_LOCKED` (409) | Bounded retry with same key + backoff | Checkout, pay, petty, close |
| `INVARIANT_VIOLATION` (409) | Render `discrepancies[]`, resolve-or-escalate | Close dialog → supervision |
| `FLOOR_VIOLATION` (403) | "Requires doctor" path, no retry | Checkout |
| `DISCOUNT`/`reason` 422s | Focus the justification field | Checkout, reversal, write-off, petty, emergency, undo |
| `MSE_REQUIRED` (422) | Distinguish missing vs `NOT_PERFORMED` in `details` | MSE panel, drafts, sign |
| `CONSENT_REQUIRED` (422) | Consent capture step | Scribe session create |
| `WITHDRAWN_GONE` (403) / `GONE` (410) | "Start new session" path | Scribe |
| `ILLEGAL_TRANSITION` (400) | Converge to snapshot (unreachable by design) | Queue command |
| `ALREADY_REVERSED` (400) / pay-on-PAID (400) | Pivot to current-state view | Receipts, pay-down |
| `UNAUTHORIZED` (401) / `FORBIDDEN` (403) incl. deactivated | Re-login / lockout; clinical 403 page for secretary | Session, guards |
| `NOT_FOUND` (404) | Remove stale reference, resync list | All entity views |
| `INTERNAL` (500 + incident id) | Safe generic + incident id + report affordance | Global boundary |

### 4.6 INV-1…INV-10 → frontend obligations

| Invariant | Frontend obligation |
|---|---|
| INV-1 Collected integrity (`collected = ΣCHARGE − ΣREVERSAL`) | Never display a locally summed "collected" that disagrees with the server; reconcile to `billing.invoiceUpdated`/invoice reads |
| INV-2 Outstanding integrity (never negative; patient = Σ UNPAID/PARTIAL) | Allocation engine (C-07) stops at zero per line; badges derive from server `outstandingMinor` only |
| INV-3 Discount vs write-off separation | Discount UI exists only at creation; post-creation shortfalls route to pay or (doctor) write-off; no "edit final fee" control |
| INV-4 Reversal linkage (one REVERSAL per CHARGE, ≤ amount) | Reverse action available once per CHARGE; double-reverse is unreachable; UI shows linkage chain |
| INV-5 Idempotency (replay = original, zero dup rows) | §4.4 protocol; replay is success |
| INV-6 Floor enforcement | Live floor meter; breach routes to doctor; `403` maps to guidance, never to silent escalation |
| INV-7 Petty containment (OPEN shift, monotonic) | Petty entry disabled on CLOSED shift; no delete affordance; EXPENSE-only (GAP-04) |
| INV-8 Blind expected (post-actual reveal) | §4.3 null discipline; no client-side preview computation |
| INV-9 Closed-shift freeze | All mutation controls disable on CLOSED; corrections via new-date adjustment invoice (doctor) |
| INV-10 Audit coverage (one event per sensitive mutation) | Every sensitive action captures its required reason **before** dispatch; missing-audit blockers in readiness surface as "complete the reason and retry" |

### 4.7 Frontend tripwire mirror (CI for Step 2+)

The architecture spec must adopt frontend-side equivalents of backend tripwires C-3/C-4/C-9/C-10/C-12 and test-matrix F-1/F-4/F-5: (1) secretary import-graph test — no `Clinical*` import reachable from secretary routes; (2) allowlist snapshot test — secretary fixtures contain only Ops keys; (3) reorder/emergency requests always carry `If-Match` + version body (request-interceptor test); (4) MSE schemas include `NOT_PERFORMED` literally; (5) blind-close test — no expected-value selector/field exists in close/summary states; (6) `?include=clinical`-style fuzz on the API client returns nothing clinical.

### 4.8 Endpoint → UI wiring notes (key non-obvious bindings)

- `POST /queue/:entryId/complete` **auto-creates the invoice shell** — checkout screens must tolerate both "shell exists" (set fee + collect) and "no shell" paths, and `409 already invoiced` pivots to pay-down, not to an error page.
- Check-in debt flow is a **two-step 200→201**: `201 entry + advisory debtAlert` is not an error; the dialog continues with `acknowledged:true`.
- `POST /billing/complimentary` is doctor-only; the desk never offers it — it only renders its effect (`billing.invoiceUpdated` → COMPLIMENTARY).
- `GET /ehr/patients/:id/chart` is SIGNED-only; drafts live exclusively in the consult room.
- `GET /audit` is role-filtered server-side (secretary: own operational only, vault/scribe rows filtered) — the UI adds no further filtering semantics, only presentation.
- `GET /followups` + `DOCTOR_FOLLOWUP` intercom type close the loop on D-13 directives.

### 4.9 Contract Gap & Ratification Register (normative for Step 2)

These Charter-vs-contract deltas are **not resolved by the frontend**; each needs a backend ratification (contract entry + Zod + RBAC/SecretSafe note + tripwire test) or an explicit Step-2 design decision recorded here:

| ID | Gap | Wire fact | Frontend posture until ratified |
|---|---|---|---|
| GAP-01 | `If-Match` on encounters (Charter) | No such header in contract; draft-only PATCH + `409 SIGNED` + version chain | Never send `If-Match` to EHR; handle `409/422` by reload → addendum |
| GAP-02 | Unsigned-notes backlog listing | Chart endpoint is SIGNED-only; no draft list | Local per-shift roster of doctor's uncompleted consults + proposed `GET /ehr/encounters?status=DRAFT` |
| GAP-03 | Open-shift receipt archive block (secretary) | `GET /receipts` has no shift-state guard in contract | Suppress open-shift archive nav for secretary; request explicit server rule |
| GAP-04 | Petty `INJECTION` direction | No wire/model representation; INV-8 deducts all petty | EXPENSE-only UI; top-ups via `openingFloatMinor` at shift open |
| GAP-05 | Vault shred + tombstone | No endpoint; zero-hard-delete invariant | No shred affordance; request doctor-only tombstone route |
| GAP-06 | Scribe session status polling | RESOLVED by Gen-2: cycle responses are synchronous (session status flips server-side per call) | none — no polling loop exists |
| GAP-07 | "Doctor decisions override dialogue" synthesis directive | `POST /scribe/drafts` accepts only `{scribeSessionId, mse}` | Submit MSE only; prioritization must live in the server adapter prompt |
| GAP-08 | Ambient + dictation → single draft | Draft binds one `scribeSessionId` | Studio tolerates single-session drafts; request multi-session/bundle contract |
| GAP-09 | Oldest-first cross-invoice allocation | Server collects per-invoice only | Client-side orchestration (C-07); no server change needed |
| GAP-10 | Transfer/Wallet channel labels | Wire enum is `CASH\|OTHER` only | Preset→enum map; labels are UI/print context only |
| GAP-11 | Undo-window visibility | Queue DTO carries no `completedAt`/`undoWindowUntil` | Local countdown from client's own complete; request DTO field or accept local-only |

---

## 5. Deferred & Excluded Features Matrix

### 5.1 Deferred (F-01…F-10) — explicitly out of MVP, explicitly not designed around

| ID | Feature | Why deferred | Step-2 constraint (do not…) |
|---|---|---|---|
| F-01 | Waiting-room crowding index | Needs load model + thresholds not in contract | …add crowding fields to queue state; wait-time stays per-entry |
| F-02 | Psychometric scales (PHQ-9, GAD-7, …) | New clinical instruments + scoring + versioning | …overload MSE/diagnoses to fake scales |
| F-03 | Condition progression graphs | Longitudinal analytics over signed data | …store derived trend caches; charts read signed encounters only |
| F-04 | Patient self-service portal / online booking | Public auth surface + threat model expansion | …expose any patient-facing route or token |
| F-05 | Insurance / payer claims | New money types beyond CASH/OTHER + reconciliation deltas | …add payment methods or invoice states |
| F-06 | SMS/WhatsApp reminders | External provider + consent + PHI-in-transit review | …put contact automation in the intercom channel |
| F-07 | Multi-branch tenancy | Settings/shift/queue scoping per branch | …add branch keys to any model or request |
| F-08 | Attachments / document management (labs, imaging, forms) | Binary store + retention + vault-adjacency review | …smuggle files through audio refs or admin notes |
| F-09 | Appointment calendar / recurring slots | Scheduling domain disjoint from today's queue | …morph queue positions into appointments |
| F-10 | BI analytics / report exports | Aggregation layer + export controls | …build derived financial caches outside summaries |

### 5.2 Excluded (X-01, X-02) — will not be built; architecture must not anticipate them

| ID | Feature | Rationale | Hard rule |
|---|---|---|---|
| X-01 | Telehealth / video visits | Separate realtime-media, consent, and recording-retention regime; in-person psychiatric practice scope | No media-call infrastructure, no visit-type branching in queue/encounter models |
| X-02 | Public marketing portal | Public web presence is outside the clinical system trust boundary | No public routes, no CMS, no shared auth with the clinic app |

### 5.3 Scope-discipline gate (change control)

1. A deferred feature enters the build only via a ratified amendment: contract entry (RBAC tag + Zod + idempotency + SecretSafe note) + tripwire test + a playbook addendum updating the census (the "43" changes by amendment, never by drift).
2. An excluded feature is revisited only by a new phase charter — never inside Phase 1.
3. Any UI copy, empty state, or settings screen that implies a deferred/excluded capability ("coming soon: video visits") is a scope violation — the MVP contains no placeholders for them.

---

## 6. Architectural Readiness Statement

### 6.1 Digestion checklist (all backend contracts consumed)

- [x] REST surface: all 7 epics' endpoints mapped to UI surfaces (Appendix A), with RBAC tags, required headers (Idempotency-Key, `If-Match`), and error codes bound to deterministic UX (§4.5).
- [x] WebSocket surface: 8 server→client frames + 2 client→server messages mapped to stores, with `queueVersion` monotonicity and reconnect-replay rules (§4.1).
- [x] OCC: queue `queueVersion` + dual header/body version + `409 STALE_QUEUE` snapshot application; encounter concurrency corrected to draft/version semantics (GAP-01).
- [x] Blind drawer: null discipline, two-phase close UX, no-preview rule, INV-8/INV-9 obligations (§4.3, §4.6).
- [x] Idempotency: UUIDv4 intent protocol, outbox, replay-as-success, `REUSE` terminality (§4.4).
- [x] Invariants INV-1…INV-10 translated into frontend obligations (§4.6).
- [x] Zero-knowledge barrier specified structurally (ZK-1…ZK-7), mirroring `SecretSafe`, DB-02 severance, and threat-model residuals T-1/T-3.
- [x] 43-feature census closed: 31 core mapped (S-01…S-18, D-01…D-13), 10 deferred + 2 excluded fenced (§5).
- [x] 11 contract gaps registered with interim postures; none block Step 2 (GAP-02/06/08 shape studio polling/binding options — flagged as Step-2 decisions below).

### 6.2 Decisions carried into `02_FRONTEND_ARCH_SPEC.md` (not decided here)

1. Angular module boundary for the ZK barrier (lazy doctor subtree + injector-scoped `ClinicalApi` vs build-time split) — options constrained by ZK-1…ZK-3.
2. State container for versioned queue + outbox persistence (survives reload without leaking clinical or expected values).
3. Scribe studio state machine shape under GAP-06/GAP-08 (single-session-tolerant, multi-session-ready).
4. Unsigned-notes roster source under GAP-02 (local-first, endpoint-if-ratified).
5. WS client design (rooms, re-subscribe, frame-version guard, fallback polling cadence).
6. API client facades (`OpsApi`/`ClinicalApi`), error-catalogue interceptor, idempotency-key interceptor.
7. Frontend tripwire mirror implementation (§4.7) in CI.

### 6.3 Formal sign-off

As Principal Frontend Systems Architect and Lead Clinical HealthTech Consultant for this initiative, I confirm:

1. The clinical domain — both personas, all 31 core features, the visit spine, and the money lifecycle — is fully digested and traceable to Charter bullets and backend contracts.
2. The backend contracts — REST, WebSocket, OCC, blind-count, idempotency, error envelope, and INV-1…INV-10 — are fully digested, including the documented Charter-vs-contract deltas in the Gap Register, which are the **complete and only** known interface risks entering Step 2.
3. The Zero-Knowledge barrier is specified as structural mechanism (ZK-1…ZK-7), not policy prose, and is verifiable by the mirrored tripwires.
4. Scope discipline is fenced: the 10 deferred and 2 excluded features are named, reasoned, and gated against drift.
5. **The team is ready to draft the Angular Architecture Specification (`02_FRONTEND_ARCH_SPEC.md`).** No frontend code, scaffolding, or component implementation is authorized before it.

---

## Appendix A — Endpoint → UI Surface Index

| Method + Path | RBAC | UI surface(s) | Notes |
|---|---|---|---|
| `GET /health` | public | Boot/status probe | — |
| `POST /auth/login`, `/refresh`, `/logout`, `GET /auth/me` | public/BOTH | Session bootstrap, guards, role resolution | Refresh rotation; reuse revokes; deactivation locks out incl. WS |
| `POST /users/secretaries`, `GET /users`, `PATCH /users/:id/deactivate\|activate`, `POST /auth/change-password` | DOCTOR / BOTH (pwd) | `DoctorUserAdmin` | — |
| `GET /settings` | BOTH (SecretSafe) | Fee prefill, floor meter, wait header, currency, retention display | Floor + TTL visible to both; no secrets |
| `GET /patients/search?q=` | BOTH | `OpsCheckInDialog` | Debt flags inline |
| `POST /patients` | BOTH | `OpsPatientRegistrationWizard` (+crisis lite) | `409` candidate compare |
| `GET /patients/:id`, `PATCH /patients/:id` | BOTH | Identity panel, crisis completion | Contact/admin-notes only |
| `POST /queue/check-in` | BOTH + Idem-Key | Check-in, registration chain, crisis intake | `201 entry + advisory debtAlert` → ack step; `409` → jump-to-entry |
| `GET /queue?shiftId=&status=` | BOTH | Board initial snapshot | Carries `queueVersion` |
| `POST /queue/:id/call-next\|skip\|requeue\|complete` | call/skip/complete DOCTOR; requeue BOTH | Command deck, widget, board | `complete` auto-creates invoice shell |
| `POST /queue/:entryId/undo-complete` | DOCTOR + reason + Idem-Key | Command deck (windowed, single-hop) | `400` expired/second-use; invoice preserved |
| `POST /queue/reorder` | BOTH + If-Match + version body + Idem-Key | Board DnD | `422` non-WAITING/bury; `409` + snapshot |
| `POST /queue/:entryId/emergency` | BOTH + If-Match + Idem-Key | Flag/unflag dialogs (reason both ways) | Position 0; audit both ways |
| `GET /queue/wait-times` | BOTH | Board header + row estimates | Server-computed only |
| `POST /billing/checkout` | BOTH + Idem-Key | `OpsBillingCheckoutSheet` | `422` no-reason; `403` floor; `409` invoiced → pay-down |
| `POST /billing/complimentary` | DOCTOR + Idem-Key | Doctor widget (desk renders effect only) | `403` secretary |
| `POST /billing/invoices/:id/pay` | BOTH + Idem-Key | Debt settlement, balance panel | Per-invoice; oldest-first is client orchestration |
| `POST /billing/receipts/:id/reverse` | DOCTOR + reason + Idem-Key | Doctor correction flow | `403` secretary; `400` already-reversed |
| `POST /billing/invoices/:id/write-off` | DOCTOR + reason | Doctor uncollectible flow | Distinct from discount |
| `GET /billing`, `GET /patients/:id/balance`, `GET /receipts*`, `GET /receipts/:id` | BOTH (SecretSafe) | Ledger, balance, archive | Open-shift archive suppressed for secretary (GAP-03) |
| `POST /shifts/open`, `POST /shifts/:id/petty`, `GET …/petty`, `POST …/close`, `GET …/summary` | BOTH + Idem-Key (mutating) | Shift open, petty sheet, blind close, day summary | Blind + immutable rules throughout |
| `GET /intercom`, `POST /intercom`, `GET /followups` | BOTH (type-ownership) | Dock, widget, follow-up board | Idem-Key iff `DOCTOR_COMPLIMENTARY` |
| `POST /ehr/encounters`, `GET …/chart`, `GET /ehr/encounters/:id`, `PATCH …`, `POST …/sign`, `POST …/append` | DOCTOR | Consult room, editor, timeline | Manual path; no `If-Match` (GAP-01) |
| `POST /ehr/patients/:id/medications`, `POST /ehr/medications/:id/discontinue`, `GET …/medications` | DOCTOR | Medication tracker, titration saga | Cessation reason required |
| `POST /ehr/vault/patients/:id/notes`, `GET …` | DOCTOR (segregated) | Vault page (ephemeral) | No shred endpoint (GAP-05) |
| `POST /scribe/sessions`, `…/:id/cycle-1-consultation`, `…/:id/cycle-2-doctor-decision`, `…/:id/commit`, `…/:id/purge-audio`, `…/:id/withdraw-consent` | DOCTOR | Scribe studio | Gen-2 canonical lifecycle (Decision 4); inline base64 audio; commit = {soap, mse?, prescriptions?, diagnoses?} strict |
| `GET /audit` | role-filtered | Supervision (doctor full; secretary own-ops) | Vault/scribe rows filtered for secretary |
| `GET /supervision/front-desk-activity\|cash-summary\|discrepancies\|shift-readiness` | DOCTOR | Command deck, supervision views | INV gate + readiness blockers |

WS: `queue.subscribe` / `intercom.send` (client→server); `queue.updated|called|reordered|emergency|undoComplete`, `billing.invoiceUpdated`, `intercom.received`, `supervision.discrepancy` (server→client) — §4.1.

## Appendix B — Canonical Enums & State Machines

- **Roles:** `DOCTOR | SECRETARY`. **Queue:** `WAITING | IN_CONSULTATION | COMPLETED | SKIPPED` with machine `WAITING→IN_CONSULTATION→COMPLETED`, `WAITING↔SKIPPED`, `COMPLETED→IN_CONSULTATION` (undo only: doctor, reasoned, windowed, single-hop); `WAITING→COMPLETED` illegal.
- **Invoices:** `UNPAID | PARTIAL | PAID | COMPLIMENTARY | WRITTEN_OFF`; derived `collected/outstanding`; `discount` fixed at creation.
- **Receipts:** `CHARGE | REVERSAL` (immutable; reversal links one CHARGE via plain id). **Payment method (wire):** `CASH | OTHER`.
- **Shifts:** `OPEN | CLOSED`; close result `BALANCED | SURPLUS | DEFICIT` (null until reveal); `CLOSED` terminal.
- **Intercom:** `DOCTOR_COMPLIMENTARY | DOCTOR_NEXT | DOCTOR_FOLLOWUP | SEC_DISRUPTION | SEC_PHARMACY_LAB | CUSTOM_TEXT` with type-ownership.
- **Encounters:** `DRAFT | SIGNED`, source `MANUAL | SCRIBE`; MSE selectors each `clinical-value | NOT_PERFORMED` (missing rejected).
- **Medications:** `ACTIVE | DISCONTINUED` (+`cessationReason`, `stoppedAt`). **Follow-ups:** `REQUESTED | SCHEDULED | DONE | CANCELLED`.
- **Scribe:** sessions `UPLOADED | TRANSCRIBING | TRANSCRIBED | FAILED | WITHDRAWN | PURGED`, consent `GRANTED | WITHDRAWN`, modes `AMBIENT_LIVE | DICTATION_60S` (60 s cap); drafts `DRAFT | EDITED | SIGNED | SUPERSEDED` with integer version chain.
- **Money/time:** integer minor units; ISO-8601 UTC; pagination `?limit&cursor`.

## Appendix C — Glossary

- **OCC** — optimistic concurrency control via `Shift.queueVersion` + `If-Match`/version-body on reorder/emergency.
- **`SecretSafe<T>`** — backend branded allowlist DTO; the frontend mirrors it with disjoint `Ops*`/`Clinical*` model families.
- **Blind close** — drawer reconciliation where `expectedCashMinor` is revealed only after `actualCountedMinor` persists.
- **Charge/Reversal** — immutable receipt pair; corrections are new `REVERSAL` rows, never edits.
- **Idempotent replay** — `200 + Idempotent-Replayed: true` returning the original result with zero duplicate rows.
- **Debt-ack** — check-in two-step (`201 entry + advisory debtAlert` → retry `acknowledged:true`) when outstanding > 0; never blocking.
- **Floor** — `secretaryMaxDiscountMinor`/`secretaryMaxDiscountPct` caps; tighter wins; breach is `403 FLOOR_VIOLATION`.
- **INV-1…INV-10** — reconciliation invariants gating shift close (§4.6; spec §15 of the schema doc).
- **RPS-2** — the applied backend revision series (DB/CONV/API/BE amendments) that this playbook treats as normative.

*End of Step 1 playbook. Next: `docs/frontend/02_FRONTEND_ARCH_SPEC.md`.*
