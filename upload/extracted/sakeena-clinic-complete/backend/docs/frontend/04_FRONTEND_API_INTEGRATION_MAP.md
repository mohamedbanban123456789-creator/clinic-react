# Frontend API Integration & Contract Mapping Specification — Psychiatric Practice Management System & Clinical AI Assistant

> **Document:** `docs/frontend/04_FRONTEND_API_INTEGRATION_MAP.md`
> **Phase:** Frontend Engineering Initiative — **Step 4: Frontend API Integration & Contract Mapping**
> **Status:** NORMATIVE FOR STEP 5+ (all service/store/component wiring MUST conform; deviations require an integration-map amendment)
> **Predecessors (approved, binding):**
> | # | Artifact | Authority for this map |
> |---|----------|------------------------|
> | 1 | `docs/API_CONTRACTS.md` — RPS-2 applied (223 lines, API-01…API-09) | REST schemas, WS frames, RBAC tags, idempotency scope, error codes — **wire authority** |
> | 2 | `docs/PROJECT_CONVENTIONS.md` — CONV-01…CONV-10, App. B/C/F | SecretSafe allowlist, lockShift/OCC/blind-close/floor/consent semantics, tripwire matrix |
> | 3 | `docs/frontend/01_DOMAIN_FEATURE_SYNTHESIS.md` — APPROVED | 43-feature census (S-01…S-18, D-01…D-13), visit spine, ZK-1…ZK-7, P-01…P-12, C-01…C-24, GAP-01…GAP-11, INV-1…INV-10 |
> | 4 | `docs/frontend/02_FRONTEND_ARCH_SPEC.md` — NORMATIVE | 12 signal stores, 5-interceptor chain, socket pipeline, route tree, FT-1…FT-8 gates |
> | 5 | `docs/frontend/03_CLINICAL_DESIGN_SYSTEM.md` — NORMATIVE | Component anatomies, toast catalogue, keyboard map, token contract |
> | 6 | **Backend code reality on disk** (`D:\Clinic\src/**`, verified this step) | Remediations E-1…E-4, `toSecretPatientBalanceDto`, `WRITE_OFF` audit, `WRITTEN_OFF` terminality, scribe DB lifecycle, `If-Match` on encounters, body-OCC on queue, vault shred, settle endpoint |
> **Operating constraint:** NO application source code (`.ts`/`.html`/`.scss`) in app directories was produced in this step. NO scaffolding (`ng new`) was executed. This document is specification only. TypeScript interfaces below are **binding contracts, not implementation** — Step 5 realizes them file-for-file in `OpsApi` / `ClinicalApi` / stores.
> **Mirror:** this file is mirrored verbatim to `D:\Clinic-front\docs\frontend\04_FRONTEND_API_INTEGRATION_MAP.md`. The `D:\Clinic` copy is the record of authority; divergence resolves in favor of `D:\Clinic`.
> **Conformance language:** MUST / MUST NOT = blocking; SHOULD = strong default with recorded justification; MAY = permitted option.

---

## Table of Contents

- [0. How to Read This Map & Global Wire Rules](#0-how-to-read-this-map--global-wire-rules)
- [1. Exhaustive Domain Endpoint-to-Component Matrix](#1-exhaustive-domain-endpoint-to-component-matrix)
- [2. WebSocket Gateway Real-Time Ingestion Protocol](#2-websocket-gateway-real-time-ingestion-protocol)
- [3. Concurrency, OCC & Financial Protocol Enforcement](#3-concurrency-occ--financial-protocol-enforcement)
- [4. Master Error Envelope Translation Catalogue](#4-master-error-envelope-translation-catalogue)
- [Appendix A — Idempotency Outbox Route Table (normative)](#appendix-a--idempotency-outbox-route-table-normative)
- [Appendix B — SecretSafe Mapper & Store Subscription Index](#appendix-b--secretsafe-mapper--store-subscription-index)
- [Appendix C — Backend Code-Reality Reconciliation Log (E-1…E-4 + drift)](#appendix-c--backend-code-reality-reconciliation-log-e-1e-4--drift)
- [Appendix D — Traceability (S-*/D-* → Endpoints → Stores)](#appendix-d--traceability-s-d--endpoints--stores)
- [Appendix E — Step-5 Entry Criteria](#appendix-e--step-5-entry-criteria)

---

## 0. How to Read This Map & Global Wire Rules

### 0.1 Precedence

1. **Wire behavior:** `docs/API_CONTRACTS.md` + verified backend code on disk win. Where contract prose and code disagree, §Appendix C records the winner and the frontend posture. This map MUST NOT silently extend the wire (no new endpoints, headers, or `?include=clinical`).
2. **Interaction intent:** Step-1 feature matrices and Step-3 anatomies win for UX shape.
3. **Architecture binding:** Step-2 store catalogue (`AuthStore`, `SettingsStore`, `QueueStore`, `ShiftStore`, `BillingStore`, `IntercomStore`, `FollowUpStore`, `SupervisionStore` [doctor scope], `ConsultationStore` [doctor], `ScribeStore` [doctor], `MedicationStore` [doctor], `VaultHolder` [doctor ephemeral], `OutboxStore`), two facades (`OpsApi` root / `ClinicalApi` cockpit-scoped), 5-interceptor chain order, and FT-1…FT-8 gates are all assumed and referenced by short name.

### 0.2 Global wire facts (all sections inherit these)

| Fact | Normative value |
|------|-----------------|
| Base URL | `/api/v1` (relative; dev host override only). Health `GET /health` is unversioned public probe |
| Auth | `Authorization: Bearer <accessJWT>` (~15 min) on every `/api/v1/*` except `POST /auth/login`, `POST /auth/refresh`, `GET /health`. Refresh via httpOnly secure rotating cookie (`withCredentials: true`). `authenticate + requireFreshPassword` middleware on all routers |
| Success envelope | DTO or `{ data }` — no `error` key. Mutating POSTs return `201` on create, `200` on idempotent replay / state transition / write-off / close-reveal |
| Failure envelope | `{ error: { code, message, details: [{ field?, issue, expected? }] } }`. `code` is the contract; `message` is human-debug only — UI keys off `code` + HTTP status, never message text |
| Money | Integer minor units end-to-end (`type Minor = number & SecretSafe-brand`). Frontend type `type Minor = number & { readonly __minor: unique symbol }`. NO float arithmetic; format at view edge from `GET /settings` (`currency`, decimals via `Intl.NumberFormat`) |
| Time | ISO-8601 UTC strings on wire; local render via `core/utils/time.ts`. No client recomputation of waits |
| Pagination | `?limit&cursor` (opaque cursor). History feeds (`GET /intercom`, chart, audit) paginate; board/balance are snapshots |
| RBAC tags | `[DOCTOR]`, `[SECRETARY]`, `[BOTH]`. SECRETARY-visible responses are branded `SecretSafe<T>` via explicit `toSecret<X>Dto` mappers (CONV-02). No `toSecret` mapper exists for clinical types — SECRETARY → `403`, generic, no existence oracle |
| Audit | Every sensitive mutation writes an operational allowlist audit row (ids + timestamps only, never clinical bodies). Client MUST capture required reasons BEFORE dispatch (INV-10) |
| Idempotency marker | Replay success = HTTP `200` + response header `Idempotent-Replayed: true` + `IDEMPOTENT_REPLAY` audit. Treated as success, reconciled to returned original |
| WS transport | `socket.io-client` v4, `auth: { token }`, rooms `clinic:queue` + `clinic:intercom` (both), `supervision.discrepancy` doctor-only |

### 0.3 Shared TypeScript foundation (binding shapes)

```ts
// CONTRACT — global primitives (mirrors API_CONTRACTS.md Part 0)
type Role = 'DOCTOR' | 'SECRETARY';
type QueueStatus = 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'SKIPPED';
type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'COMPLIMENTARY' | 'WRITTEN_OFF';
type ReceiptType = 'CHARGE' | 'REVERSAL';
type ShiftResult = 'BALANCED' | 'SURPLUS' | 'DEFICIT';
type IntercomType = 'DOCTOR_COMPLIMENTARY' | 'DOCTOR_NEXT' | 'DOCTOR_FOLLOWUP' | 'SEC_DISRUPTION' | 'SEC_PHARMACY_LAB' | 'CUSTOM_TEXT';
type ScribeMode = 'AMBIENT_LIVE' | 'DICTATION_60S';
type MSEValue = string | 'NOT_PERFORMED';
type Minor = number & { readonly __minor: unique symbol };
type SecretSafe<T> = T & { readonly __secretSafe: unique symbol };
interface ApiErrorEnvelope { error: { code: string; message: string; details?: { field?: string; issue: string; expected?: string }[] } }
interface Paginated<T> { data: T[]; nextCursor: string | null }
```

> Every Request/Response interface in §1 extends these primitives. `SecretSafe` branding on a Response DTO means: (a) the route is reachable by SECRETARY, (b) the payload passed through a `toSecret<X>Dto` allowlist mapper, (c) the frontend MUST type it as an `Ops*` model and MUST NOT attempt to read clinical keys from it.

---

## 1. Exhaustive Domain Endpoint-to-Component Matrix

**Row legend:** `Headers` lists ONLY wire headers (auth Bearer is implicit everywhere). `Binding Target` names the Step-2 store + Step-1/Step-3 surface + state mutation in `apply/reconcile` terms. All money POSTs go through `OutboxStore.mint()` → `idempotencyInterceptor` → `BillingStore`/`ShiftStore`/`QueueStore` intent (Step-2 §2.5/§3.4).

### 1.1 Module A — Authentication & User Management

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| A-1 | `GET /health` | public | none | n/a (probe) | `{ status: 'ok' }` | `Boot probe` → readiness gate only; no store write |
| A-2 | `POST /api/v1/auth/login` | public | `Content-Type: application/json` | `{ identifier: string; password: string }` | `200 { accessToken: string }` + `Set-Cookie: refresh` (httpOnly). Failure `401` / `403 deactivated` | `AuthStore.login()` → `OpsHome` / role-home redirect; `POST /auth/me` restore follows. `403 deactivated` → lockout screen, no retry |
| A-3 | `POST /api/v1/auth/refresh` | cookie (`[BOTH]` session) | cookie only; EXCLUDED from `authInterceptor` Bearer | n/a (cookie) | `200 { accessToken: string }`. Reuse → revokes family `401` | `refreshTokenInterceptor` single-flight (Step-2 §3.3) → replay queued with ORIGINAL `Idempotency-Key`s; family failure → `AuthStore.logout(failClosed)` + WS disconnect + `/login?reason=session` |
| A-4 | `POST /api/v1/auth/logout` | `[BOTH]` | Bearer | n/a | `200 { ok: true }` | `AuthStore.logout()` → clear all stores incl. `VaultHolder.scrub('logout')`, retain ONLY outbox PENDING money intents for resume; WS disconnect; redirect `/login` |
| A-5 | `GET /api/v1/auth/me` | `[BOTH]` | Bearer | n/a | `200 { id: string; name: string; role: Role; lastLoginAt: string \| null }` | `AuthStore.restore()` / guards (`authGuard`, `doctorGuard`/`secretaryGuard`); role resolved ONLY here, never from client storage. Cold-boot guard path |
| A-6 | `POST /api/v1/auth/change-password` | `[BOTH]` | Bearer | `{ oldPassword: string; newPassword: string }` (Zod strength rules) | `200 { ok: true }` (rotates session) | `AuthStore` session settings surface; re-auth confirm sheet; `422` → inline field error on `newPassword` |
| A-7 | `POST /api/v1/users/secretaries` | `[DOCTOR]` | Bearer | `{ name: string; identifier: string; password: string }` | `201 { id: string; name: string; identifier: string; role: 'SECRETARY'; isActive: boolean }`. `403` non-doctor; `409` duplicate; `422` | `DoctorUserAdmin` (`/cockpit/admin/users`) via `OpsApi.createSecretary()` → `SupervisionStore`/local users list append; `409` → inline "identifier taken" + suggest variant |
| A-8 | `GET /api/v1/users` | `[DOCTOR]` | Bearer | n/a (query `?limit&cursor` MAY apply) | `200 { data: { id: string; name: string; identifier: string; role: Role; isActive: boolean }[] }` | `DoctorUserAdmin` roster; doctor scope; never exposed to secretary injector |
| A-9 | `PATCH /api/v1/users/:id/deactivate` / `PATCH /api/v1/users/:id/activate` | `[DOCTOR]` | Bearer | n/a (id in path) | `200 { id: string; isActive: boolean }` | `DoctorUserAdmin` toggle → list patch; deactivation of self requires typed confirm + immediate `AuthStore.handleDeactivated()` if own session |
| A-10 | `GET /api/v1/settings` | `[BOTH]` SecretSafe | Bearer | n/a | `200 SecretSafe<ClinicSettingsDto>`: `{ standardFeeMinor: Minor; currency: string; avgConsultDurationMin: number; openingFloatMinor: Minor; secretaryMaxDiscountMinor: Minor; secretaryMaxDiscountPct: number; audioRetentionDays: number }` — floor + TTL visible to both; no secrets | `SettingsStore.load()` (root, memory) → fee prefill (S-08), floor meter (S-10), wait header (S-07), currency formatter (C-11), retention countdown (C-13). Computed `floorMeterFor(fee)`, `currencyFormatter()` |
| A-11 | `PUT /api/v1/settings` | `[DOCTOR]` (verified: `settings.routes.ts` upsert singleton) | Bearer | `Partial<{ standardFeeMinor: Minor; currency: string; avgConsultDurationMin: number; openingFloatMinor: Minor; secretaryMaxDiscountMinor: Minor; secretaryMaxDiscountPct: number; audioRetentionDays: number }>` (at least one key; Zod range checks) | `200 { settings: ClinicSettingsDto }` | Doctor settings surface (supervision-adjacent, cockpit) → `SettingsStore.load()` refresh; SECRETARY never dispatches (guard + facade absence); `422` → per-field inline errors |

### 1.2 Module B — Patient Identity & Intake

All SECRETARY-visible shapes are `SecretSafe` (allowlisted identity only — no clinical keys exist to leak).

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| B-1 | `GET /api/v1/patients/search?q=` | `[BOTH]` SecretSafe | Bearer | query `{ q: string; limit?: number }` (debounced 250–350 ms, R-1 `switchMap`) | `200 SecretSafe<PatientSearchDto>`: `{ data: { id: string; fullName: string; phone: string \| null; nationalId: string \| null; emergencyContact: { name: string; phone: string; relation: string }; lastVisitAt: string \| null; outstandingBalanceMinor: Minor; hasDebtAlert: boolean }[] }` | `OpsCheckInDialog` + `OpsPatientRegistrationWizard` duplicate check via `OpsApi.searchPatients()` → signal list; rows show debt badge from `outstandingBalanceMinor`/`hasDebtAlert` ONLY (never visit reasons). Empty query emits `[]` without HTTP |
| B-2 | `POST /api/v1/patients` | `[BOTH]` | Bearer | `{ fullName: string; age: number; phone?: string; nationalId?: string; emergencyContact: { name: string; phone: string; relation: string }; physicalAddress: string; adminNotes?: string }` (`adminNotes` ≤ 500 chars, live counter) | `201 { id: string } & identity` ; `409 { candidate: PatientSearchRow }` duplicate; `422` field errors | `OpsPatientRegistrationWizard` (stepped) → `OpsApi.registerPatient()`; `409` → side-by-side candidate compare ("use existing" vs override-if-permitted); `201` → offer immediate check-in chain (S-01). Crisis-lite path sends emergency anchor only (B-5) |
| B-3 | `GET /api/v1/patients/:id` | `[BOTH]` SecretSafe | Bearer | n/a | `200 SecretSafe<PatientDetailDto>`: identity + `pastVisitTimestamps: string[]` + `outstandingBalanceMinor: Minor` + `hasDebtAlert: boolean`. NO clinical | `OpsPatientBalancePanel` identity header + `OpsCheckInDialog` row expansion; `pastVisitTimestamps` rendered as dates only (no encounter linkage — ZK-4, no composite visit card) |
| B-4 | `PATCH /api/v1/patients/:id` | `[BOTH]` | Bearer | `{ phone?: string; nationalId?: string; physicalAddress?: string; emergencyContact?: { name: string; phone: string; relation: string }; adminNotes?: string }` — contact/address/adminNotes ONLY | `200 SecretSafe<PatientDetailDto>` (same shape as B-3) | Crisis completion + identity correction surface → `OpsApi.patchPatient()`; clinical fields are not in schema — sending them is a defect |
| B-5 | `GET /api/v1/patients/:id/balance` | `[BOTH]` SecretSafe — **canonical `toSecretPatientBalanceDto` for BOTH roles** (verified `billing.dto.ts:392`, `billing.service.ts:761`) | Bearer | n/a | `200 SecretSafe<PatientBalanceDto>`: `{ patientId: string; outstandingMinor: Minor; hasDebtAlert: boolean; lines: { invoiceId: string; date: string; dueMinor: Minor; collectedMinor: Minor; writeOffMinor: Minor; status: InvoiceStatus }[] }`. **E-4:** complimentary invoices auto-sync — a `COMPLIMENTARY` invoice contributes `0` due and is excluded from `outstandingMinor`; balance reflects the zero immediately (no manual refresh needed) | `BillingStore.balanceByPatient` via `OpsApi.getBalance()` → `OpsDebtSettlementSheet` / `OpsPatientBalancePanel` oldest-first orchestration (C-07). Both roles receive the IDENTICAL allowlisted shape; doctor gains nothing extra here (separation preserved) |
| B-6 | `POST /api/v1/patients/:id/settle` | `[BOTH]` (verified `billing.routes.ts:186` — convenience wrapper) | `Idempotency-Key: uuid-v4` REQUIRED | `{ amountMinor: Minor (>0); method?: 'CASH' \| 'OTHER' }` | `201 SecretSafe<SettleDto>`: `{ applied: { invoiceId: string; receiptId: string; collectedMinor: Minor }[]; remainderMinor: Minor }` (server-side oldest-first application) | `OpsDebtSettlementSheet` ALTERNATE path to per-invoice `pay` loop: `BillingStore.settlePatient()` single intent + single key; UI prefers this when available, falls back to sequential `pay` (D-orchestrator) if `404/501`. Remainder meter renders from `remainderMinor` |

### 1.3 Module C — Live Smart Queue Engine

OCC rule (code reality, verified `queue.routes.ts` + `queue.validators.ts` + `queue.service.ts:856,946`): version travels in the **request BODY as `lastSeenQueueVersion: number`**, NOT in an `If-Match` header. `If-Match` on queue routes is FORBIDDEN (would 400/ignore). Reorder + emergency additionally REQUIRE `Idempotency-Key`. Mismatch → `409 STALE_QUEUE` + current snapshot. Step-2 App. B's `If-Match` column for queue is SUPERSEDED by this section (Amendment Q-OCC-1; `occVersionInterceptor` MUST write the body field, and MUST NOT send `If-Match` on queue routes).

Queue route inventory (contract + code reality merged; code reality marked `[CODE]`):

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| C-1 | `POST /api/v1/queue/check-in` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED | `{ patientId: string; shiftId?: string; isEmergency?: boolean; emergencyReason?: string \| null; acknowledged?: boolean }` | `201 { entryId: string; status: 'IN_CONSULTATION'; position: number; estimatedWaitMin: number; queueVersion: number; debtAlert: { amountMinor: Minor; since: string } \| null }` OR debt gate `200 { requiresAck: true; debtAlert: { amountMinor: Minor; since: string } }` (no entry created). `409` duplicate open entry + `existingEntryId` | `QueueStore.checkIn()` ← `OpsCheckInDialog` / wizard chain / `OpsCrisisIntakeDialog` (with `isEmergency:true`). Debt `200` is NOT an error — dialog pivots to ack step and retries with `acknowledged:true` + SAME key (pre-agreed same-intent transition). `409` → "jump to queue" action |
| C-2 | `GET /api/v1/queue?shiftId=&status=` | `[BOTH]` SecretSafe | Bearer | query `{ shiftId?: string; status?: QueueStatus }` | `200 SecretSafe<QueueListDto>`: `{ queueVersion: number; shiftId: string; data: { entryId: string; patientId: string; displayName: string; status: QueueStatus; position: number; isEmergency: boolean; checkedInAt: string; estimatedWaitMin: number }[] }` | `QueueStore.loadSnapshot()` bootstrap + `resync` path (version-jump) → `OpsWaitingRoomBoard` + `DoctorCommandDeck`. ONLY writer of order/positions alongside WS `queue.updated` |
| C-3 | `POST /api/v1/queue/call-next` `[CODE]` (global, body-driven) | `[DOCTOR]` | Bearer | `{ shiftId?: string; force?: boolean }` (`force` requires explicit confirm + audit on single-consult `409`) | `200 { entryId: string; status: 'IN_CONSULTATION'; queueVersion: number }` + `409` single-consult (`uq_queue_single_consult`) unless `force` + doctor + audit | `QueueStore.callNext()` ← `DoctorDirectivesWidget` / `DoctorCommandDeck` / `Alt+N`. Desk `Alt+N` sends a REQUEST notice only (intercom), never this route (guard) |
| C-4 | `POST /api/v1/queue/:entryId/call` `[CODE]` (per-entry call) | `[DOCTOR]` | Bearer | `{ force?: boolean }` | `200` entry + `queueVersion` (same shape as C-3) | `QueueStore.callNext(entryId)` per-row "Call" on board (doctor only; secretary sees read-only state + actor attribution) |
| C-5 | `POST /api/v1/queue/:entryId/skip` | `[DOCTOR]` | Bearer | n/a (`{}`) | `200 { entryId: string; status: 'SKIPPED'; queueVersion: number }` + audit `QUEUE_SKIP` | `QueueStore.skip()` doctor command; board renders `SKIPPED` lane; reversible via C-6 |
| C-6 | `POST /api/v1/queue/:entryId/requeue` | `[BOTH]` | Bearer | `{ lastSeenQueueVersion?: number }` (optional ticket body; when present and stale → `409 STALE_QUEUE`; client SHOULD always send current version) | `200 { entryId: string; status: 'IN_CONSULTATION'; position: number; queueVersion: number }` | `QueueStore.requeue()` — the ONLY secretary-visible queue transition (SKIPPED→WAITING); board action + follow-up completion path |
| C-7 | `POST /api/v1/queue/:entryId/complete` | `[DOCTOR]` | Bearer | n/a | `200 { entryId: string; status: 'COMPLETED'; queueVersion: number }` + **auto-creates Invoice shell** (UNPAID). `400` if not `IN_CONSULTATION` | `QueueStore.complete()` → triggers `BillingStore` shell-sync (`GET /billing?queueEntryId=` or `billing.invoiceUpdated` frame). Checkout sheet tolerates both "shell exists" and "no shell yet" |
| C-8 | `POST /api/v1/queue/:entryId/undo-complete` | `[DOCTOR]` + reason + key | `Idempotency-Key: uuid-v4` REQUIRED | `{ reason: string (non-blank); lastSeenQueueVersion?: number }` | `200 { entryId: string; status: 'IN_CONSULTATION'; queueVersion: number }` (single hop, windowed ~15 min, audited `QUEUE_UNDO_COMPLETE`; invoice NOT deleted (retained; re-completion reuses it)) | `QueueStore.undoComplete()` ← command deck windowed action + local countdown from own `complete` (GAP-11). `400` expired/second-use; `403` secretary |
| C-9 | `POST /api/v1/queue/reorder` | `[BOTH]` WAITING-only | `Idempotency-Key: uuid-v4` REQUIRED. **NO `If-Match`** (Amendment Q-OCC-1) | `{ orderedEntryIds: string[]; lastSeenQueueVersion: number }` (body version REQUIRED; covers WAITING set; burying emergency or including non-WAITING → `422`) | `200 { queueVersion: number; order: string[]; waitTimes: { entryId: string; estimatedWaitMin: number }[] }`. `409 STALE_QUEUE + snapshot` | `QueueStore.reorder()` ← board DnD drop (ghost optimistic, C-01). `occVersionInterceptor` injects `lastSeenQueueVersion` from store; no-snapshot (`-1`) blocks dispatch → `loadSnapshot()` first. `409` → `revertToSnapshot` + "review and retry", NEVER auto-retry |
| C-10 | `POST /api/v1/queue/:entryId/emergency` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED. **NO `If-Match`** (Amendment Q-OCC-1) | `{ isEmergency: boolean; reason: string (required BOTH directions); lastSeenQueueVersion: number }` | `200 { entryId: string; isEmergency: boolean; position: number (0 when flagged); queueVersion: number }` + audit `EMERGENCY_FLAG/UNFLAG` | `QueueStore.flagEmergency()` ← per-row flag dialog (reason-required both ways). Flagged row pins at 0; reorder-below disabled structurally |
| C-11 | `GET /api/v1/queue/wait-times?shiftId=` | `[BOTH]` | Bearer | query `{ shiftId?: string }` | `200 { avgConsultDurationMin: number; queueVersion: number; items: { entryId: string; precedingCount: number; estimatedWaitMin: number }[] }` | Board header + row estimates; rendered verbatim, never recomputed (C-20/P-09) |
| C-12 | `POST /api/v1/queue/:entryId/no-show` `[CODE]` | `[BOTH]` | Bearer | `{ lastSeenQueueVersion?: number; reason?: string }` | `200` entry terminal `SKIPPED`-family + `queueVersion` | Board "No-show" action (desk-enabled); renders as skipped lane with attribution |
| C-13 | `POST /api/v1/queue/:entryId/abandon` `[CODE]` | `[DOCTOR]` | Bearer | `{ reason: string }` | `200` entry terminal + `queueVersion` | Doctor-only walk-out path; desk sees read-only terminal state |
| C-14 | `POST /api/v1/queue/:entryId/debt-ack` `[CODE]` | `[BOTH]` | Bearer | n/a | `200 { entryId: string; acknowledged: boolean; queueVersion: number }` | Alternate explicit debt-ack record (alongside check-in `acknowledged:true` retry); dialog ack step MAY call either — both converge to entry creation |

### 1.4 Module D — Billing, Cashier & Shift Desk

`lockShift` is server-side on every cash mutation (checkout, pay, reverse, write-off, settle, petty, close). Contention → `409 SHIFT_LOCKED` (bounded same-key retry, §3). All money rows are append-only (INV-3/INV-4/INV-7); NO edit affordance exists on any surface.

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| D-1 | `POST /api/v1/billing/checkout` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED | `{ queueEntryId: string; collectedMinor: Minor; finalFeeMinor?: Minor (default standard); discountReason?: string; method?: 'CASH' \| 'OTHER' }` — `discountReason` REQUIRED non-blank when `finalFeeMinor < standardFeeMinor` (non-complimentary) | `201 SecretSafe<CheckoutDto>`: `{ invoiceId: string; receiptId: string; receiptType: 'CHARGE'; status: InvoiceStatus; finalFeeMinor: Minor; collectedMinor: Minor; outstandingMinor: Minor; queueVersion?: number }`. `409 already invoiced` returns existing shell | `BillingStore.checkout()` ← `OpsBillingCheckoutSheet` (fee → reason → floor meter → method → collect). `409` pivots sheet to pay-down mode (preserves amounts, swaps CTA). Floor breach blocked pre-dispatch; server `403 FLOOR_VIOLATION` → same guidance + audit notice |
| D-2 | `POST /api/v1/billing/complimentary` | `[DOCTOR]` | `Idempotency-Key: uuid-v4` REQUIRED | `{ queueEntryId: string; note?: string (operational, capped) }` | `201 SecretSafe<ComplimentaryDto>`: `{ invoiceId: string; receiptId: string; status: 'COMPLIMENTARY'; finalFeeMinor: 0; collectedMinor: 0; outstandingMinor: 0 }` + zero CHARGE receipt. `403` secretary | `BillingStore.complimentary()` ← `DoctorDirectivesWidget` ONLY (+ `intercom.send DOCTOR_COMPLIMENTARY` path). Desk NEVER offers it — renders effect via `billing.invoiceUpdated` + directive receipt. **E-4:** patient balance auto-syncs (complimentary contributes zero due) |
| D-3 | `POST /api/v1/billing/invoices/:id/pay` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED (per-invoice key) | `{ collectedMinor: Minor (>0); method?: 'CASH' \| 'OTHER' }` — never changes `finalFee` | `201 SecretSafe<PayResultDto>`: `{ invoiceId: string; receiptId: string; receiptType: 'CHARGE'; status: InvoiceStatus; collectedMinor: Minor; outstandingMinor: Minor }`. `400` on PAID/COMPLIMENTARY/**WRITTEN_OFF** (E-3: nothing due); `422` amount ≤ 0 | `BillingStore.payInvoice()` ← `OpsDebtSettlementSheet` / `OpsPatientBalancePanel` sequential oldest-first loop (C-07), each line its OWN key; OR single-call `settle` (B-6) where adopted. `400 WRITTEN_OFF` → terminal banner (§4) |
| D-4 | `POST /api/v1/billing/invoices/:id/write-off` | `[DOCTOR]` — **E-1: `Idempotency-Key` MANDATORY** (verified `billing.routes.ts:131-149` + `idempotency('billing.writeOff')`) | `Idempotency-Key: uuid-v4` REQUIRED | `{ writeOffMinor: Minor (>0); writeOffReason: string (non-blank) }` | `200 SecretSafe<WriteOffDto>`: `{ invoiceId: string; status: InvoiceStatus; writeOffMinor: Minor; outstandingMinor: Minor }`. Outstanding EXCLUDES write-off. **E-2:** audit action canonical `WRITE_OFF` (verified `billing.service.ts:693`). **E-3:** sticky terminal `WRITTEN_OFF`: re-checkout/re-pay on it → `400 INVOICE_ALREADY_WRITTEN_OFF` (verified `billing.service.ts:93,152,388,656`) | `BillingStore.writeOff()` ← doctor uncollectible flow (dual-tap/typed confirm sheet). Replay same key → `200 + Idempotent-Replayed: true`, zero duplicate rows. Post-write-off invoice renders terminal banner; pay/reverse controls disabled with forward guidance |
| D-5 | `POST /api/v1/billing/receipts/:id/reverse` | `[DOCTOR]` (financial reversal doctor-only) | `Idempotency-Key: uuid-v4` REQUIRED | `{ reason: string (non-blank) }` | `201 SecretSafe<ReverseDto>`: `{ reversalReceiptId: string; receiptType: 'REVERSAL'; invoiceId: string; amountMinor: Minor; outstandingMinor: Minor }`. Original CHARGE retained, linked via `reversalOfReceiptId` plain id. `400` already-reversed; `403` secretary; `422` missing reason | Doctor correction flow → `BillingStore.reverseReceipt()`; receipt chain UI shows linkage; double-reverse unreachable (action disabled after first REVERSAL) |
| D-6 | `GET /api/v1/billing?shiftId=&patientId=&status=&limit=&cursor=` | `[BOTH]` SecretSafe financial | Bearer | query `{ shiftId?: string; patientId?: string; status?: InvoiceStatus; limit?: number; cursor?: string }` | `200 SecretSafe<InvoiceListDto>`: `{ data: { invoiceId: string; patientId: string; queueEntryId: string; standardFeeMinor: Minor; finalFeeMinor: Minor; discountMinor: Minor; discountReason: string \| null; status: InvoiceStatus; collectedMinor: Minor; writeOffMinor: Minor; outstandingMinor: Minor }[]; nextCursor: string \| null }` | `BillingStore` invoice map sync → ledger views, shell detection (`GET` filtered by `queueEntryId` client-side after list, or direct shell id from complete response). Reconcile displayed `collected` to server (INV-1), never local sums |
| D-7 | `GET /api/v1/receipts?patientId=&shiftId=&invoiceId=` + `GET /api/v1/receipts/:id` | `[BOTH]` SecretSafe | Bearer | query filters (all optional) | `200 SecretSafe<ReceiptDto / ReceiptListDto>`: `{ receiptId: string; invoiceId: string; type: ReceiptType; amountMinor: Minor; method: 'CASH' \| 'OTHER'; reversalOfReceiptId: string \| null; reason: string \| null; createdAt: string }`. NO update/delete (DB REVOKE — F-7) | `BillingStore.receipts` → `OpsReceiptArchivePage` (**closed shifts only**; open-shift archive nav suppressed for secretary — GAP-03 client rule). No edit/delete affordance; reversal linkage rendered |
| D-8 | `POST /api/v1/shifts/open` | `[BOTH]` | Bearer | `{ openingFloatMinor?: Minor; businessDate?: string (YYYY-MM-DD) }` | `201 { shiftId: string; status: 'OPEN'; businessDate: string; openingFloatMinor: Minor; queueVersion: number }`. `409` one OPEN per date | `ShiftStore.open()` ← `OpsShiftOpenDialog`; float top-ups happen ONLY here in Phase 1 (no petty INJECTION — GAP-04). Success sets current shift + subscribes WS `queue.subscribe { shiftId }` |
| D-9 | `POST /api/v1/shifts/:id/petty` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED | `{ amountMinor: Minor (>0); purpose: string (non-blank) }` — EXPENSE-only (all petty deducts, INV-8) | `201 { pettyId: string; shiftId: string; amountMinor: Minor; purpose: string; createdAt: string }`. `422` empty; `400` CLOSED; `409 SHIFT_LOCKED` | `ShiftStore` petty ← `OpsPettyCashSheet`; disabled on CLOSED shift (INV-9); no delete affordance (INV-7) |
| D-10 | `GET /api/v1/shifts/:id/petty` | `[BOTH]` | Bearer | n/a | `200 { data: { pettyId: string; amountMinor: Minor; purpose: string; createdAt: string }[] }` | Petty list in sheet + day summary `pettyItems[]` |
| D-11 | `POST /api/v1/shifts/:id/close` | `[BOTH]` | `Idempotency-Key: uuid-v4` REQUIRED | `{ actualCountedMinor: Minor }` — submitter has NOT seen expected (blind two-phase) | `200 ClosedShiftReveal`: `{ shiftId: string; status: 'CLOSED'; expectedCashMinor: Minor; actualCountedMinor: Minor; differenceMinor: number; result: ShiftResult; queueVersion: number }` — expected revealed ONLY here, after persist. `422` open WAITING/IN_CONSULTATION remain (unless force+doctor+audit); `400` already CLOSED; `409 SHIFT_LOCKED`; `409 INVARIANT_VIOLATION + discrepancies[]` (BE-306 gate) | `ShiftStore.closeBlind()` ← `OpsBlindDrawerCloseDialog` phase 1 (bare input, NO expected field in state type — FT-5) → phase 2 reveal renders triplet + result word from persisted response ONLY. `actualCountedMinor` draft NEVER persisted (re-entry after reload) |
| D-12 | `GET /api/v1/shifts/:id/summary` | `[BOTH]` SecretSafe operational (blind-aware: pre-close hides expected from closer) | Bearer | n/a | `200 SecretSafe<ShiftSummaryDto>`: `{ shiftId: string; totalServed: number; grossCollectedMinor: Minor; pettyTotalMinor: Minor; pettyItems: { pettyId: string; amountMinor: Minor; purpose: string }[]; netTotalMinor: Minor; discountTotalMinor: Minor; discountCount: number; newDebtTotalMinor: Minor; writeOffTotalMinor: Minor; complimentaryCount: number; reversalCount: number; result: ShiftResult \| null; differenceMinor: number \| null; queueVersion: number }` — pre-close `result/differenceMinor` are `null` (rendered absent, never `0`) | `ShiftStore.loadSummary()` → `OpsDaySummaryPage`. Pre-close slots structurally absent (P-04/C-12). Post-close full triplet. Client MUST NOT compute `openingFloat + ΣCASH CHARGE − ΣCASH REVERSAL − Σpetty` as preview |

### 1.5 Module E — Real-time Intercom & Follow-ups

Type-ownership: role derives allowable `type` (forging → `403` error frame, no broadcast). `CUSTOM_TEXT` requires non-blank capped text + ZK-5 operational-only hint.

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| E-1 | `GET /api/v1/intercom?limit&cursor` | `[BOTH]` SecretSafe | Bearer | query `{ limit?: number; cursor?: string }` | `200 SecretSafe<IntercomListDto>`: `{ data: { id: string; fromRole: Role; type: IntercomType; text: string \| null; relatedQueueEntryId: string \| null; createdAt: string }[]; nextCursor: string \| null }` | `IntercomStore` history gap-fill (reconnect) → `OpsIntercomDock` feed + `DoctorDirectivesWidget` listener |
| E-2 | `POST /api/v1/intercom` | `[BOTH]` type-ownership | `Idempotency-Key: uuid-v4` REQUIRED **iff** `type === 'DOCTOR_COMPLIMENTARY'` (REST and WS alike) | `{ type: IntercomType; text?: string (REQUIRED non-blank iff CUSTOM_TEXT, capped); relatedQueueEntryId?: string }` | `201 SecretSafe<IntercomMsg>` (same shape as E-1 row). `DOCTOR_COMPLIMENTARY` additionally executes idempotent complimentary billing + emits `billing.invoiceUpdated` + audit; `403` forging; `422` empty CUSTOM_TEXT | `IntercomStore.send()` ← dock composer + fast-action pills (role-derived, never user-selected type). Complimentary pill mints key client-side even over WS (`idempotencyKey` in `intercom.send` payload). Every directive renders effect receipt (C-23): invoice id / task id / new `queueVersion` |
| E-3 | `GET /api/v1/followups?patientId=&status=` | `[BOTH]` | Bearer | query `{ patientId?: string; status?: 'REQUESTED' \| 'SCHEDULED' \| 'DONE' }` | `200 { data: { id: string; patientId: string; relatedQueueEntryId: string \| null; status: 'REQUESTED' \| 'SCHEDULED' \| 'DONE'; note: string \| null; createdAt: string }[] }` | `FollowUpStore.load()/transition()` → `OpsFollowUpBoard` (`REQUESTED → SCHEDULED|DONE|CANCELLED (DONE/CANCELLED terminal; SECRETARY schedules/completes, DOCTOR cancels)`); `DOCTOR_FOLLOWUP` intercom type closes the D-13 loop by creating a `REQUESTED` task |

### 1.6 Module F — Clinical EHR & Encrypted Vault (Doctor Exclusive)

ALL routes `[DOCTOR]`. SECRETARY → `403` generic (no existence oracle). NO `SecretSafe` variant exists — the frontend MUST NOT register these paths in the secretary chunk/bundle (FT-1/FT-6) and `ClinicalApi` is cockpit-scoped (ZK-3). Encounter OCC (code reality, verified `encounter.routes.ts:38-48,93-113` + `encounter.service.ts:176-218,290-302`): `PATCH /ehr/encounters/:id` REQUIRES header `If-Match: <rowVersion>` (positive integer). Missing → `428 PRECONDITION_REQUIRED`; stale → `409 STALE_ROW_VERSION`. This SUPERSEDES Step-1 GAP-01's "no If-Match" posture — GAP-01 is CLOSED by code reality (Amendment E-OCC-1). `sign` carries `rowVersion` in BODY (not header).

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| F-1 | `POST /api/v1/ehr/encounters` | `[DOCTOR]` (manual path, NO queue required, `source: MANUAL`) | Bearer | `{ patientId: string; queueEntryRef?: string \| null (plain id, no FK); source?: 'MANUAL' (default); soap?: { S?: string; O?: string; A?: string; P?: string } (draft may be partial); mse: { appearance: MSEValue; behavior: MSEValue; speechCoherence: MSEValue; moodAffect: MSEValue } (each explicit incl. NOT_PERFORMED, missing rejected); diagnoses?: string[] }` | `201 { encounterId: string; status: 'DRAFT'; source: 'MANUAL'; rowVersion: number }`. `422 MSE_REQUIRED` (missing vs NOT_PERFORMED distinguished in `details`); `404` patient | `ConsultationStore.startManual()` ← `DoctorEncounterEditor` / consult room. Phone follow-ups + chart corrections path |
| F-2 | `GET /api/v1/ehr/patients/:id/chart?limit&cursor` | `[DOCTOR]` | Bearer | query `{ limit?: number; cursor?: string }` | `200 { patientId: string; encounters: { encounterId: string; source: 'MANUAL' \| 'SCRIBE'; status: 'SIGNED'; signedAt: string; diagnoses: string[]; soap: { S: string; O: string; A: string; P: string }; mse: ExplicitMse; addendumCount: number }[] }` — SIGNED-only desc; drafts NEVER appear here | `ConsultationStore` chart `resource` (patientId-keyed) → `DoctorChartTimeline` reverse-chron cards; `NOT_PERFORMED` rendered as "not performed", never blank |
| F-3 | `GET /api/v1/ehr/encounters/:id` | `[DOCTOR]` | Bearer | n/a | `200` full incl. `queueEntryRef` plain, `originScribeDraftRef` plain, `addendumCount`, `rowVersion`, partial SOAP/MSE/diagnoses + `status: 'DRAFT' \| 'SIGNED'` | Consult room draft hydration + sign-off review; `rowVersion` cached for subsequent PATCH `If-Match` / sign body |
| F-4 | `PATCH /api/v1/ehr/encounters/:id` | `[DOCTOR]` draft-only | **`If-Match: <rowVersion>` REQUIRED** (Amendment E-OCC-1) | `{ soapPatch?: Partial<Soap>; msePatch?: Partial<ExplicitMse>; diagnoses?: string[] }` (partial; draft-only) | `200 { encounterId: string; status: 'DRAFT' \| 'EDITED'; rowVersion: n+1 }`. `400 SIGNED` (use addendum); `422 MSE_REQUIRED`; `428 PRECONDITION_REQUIRED` (missing/malformed header); `409 STALE_ROW_VERSION` (concurrent bump) | `ConsultationStore.patchDraft()` ← `DoctorEncounterEditor`. `400/409 SIGNED` → reload + route edits to addendum (F-6), never forced PATCH |
| F-5 | `POST /api/v1/ehr/encounters/:id/sign` | `[DOCTOR]` explicit sign (split from PATCH) | Bearer | `{ finalSoap?: { S: string; O: string; A: string; P: string } (optional if draft complete); rowVersion: number (current, REQUIRED — OCC body)}` | `200 { encounterId: string; status: 'SIGNED'; signedAt: string; rowVersion: number }`. `409` already SIGNED (+ `STALE_ROW_VERSION` on concurrent sign); `422` incomplete SOAP/MSE | `ConsultationStore.sign()` ← sign-off review (`Alt+S`); button disabled until MSE explicit + draft non-empty. Currency conflict → reload → addendum path |
| F-6 | `POST /api/v1/ehr/encounters/:id/addenda` `[CODE]` (plural; contract prose `…/append` is an ALIAS — code wins) | `[DOCTOR]` SIGNED-only, append-only | Bearer | `{ addendumText: string (non-blank) }` | `201 { addendumId: string; encounterId: string; version: number; createdAt: string }`. Original preserved; `addendumCount` increments | `ConsultationStore.appendAddendum()` ← "Add addendum" on SIGNED encounters; editor locks post-sign ("signed — addendum only") |
| F-7 | `POST /api/v1/ehr/encounters/:id/discard` `[CODE]` | `[DOCTOR]` DRAFT-only | Bearer | n/a | `200 { encounterId: string; status: 'DISCARDED' }` | Consult room draft abandon (typed confirm); unsigned-roster entry removed |
| F-8 | `POST /api/v1/ehr/patients/:id/medications` | `[DOCTOR]` | Bearer | `{ drugName: string; dosage: string; frequency: string; instructions: string; encounterRef?: string \| null (plain, no FK) }` | `201 { medicationId: string; status: 'ACTIVE'; startedAt: string }`. `422` missing fields | `MedicationStore.create()` ← `DoctorMedicationTracker`; new-row (never reactivate — history retained) |
| F-9 | `POST /api/v1/ehr/medications/:id/discontinue` | `[DOCTOR]` | Bearer | `{ cessationReason: string (non-blank) }` | `200 { medicationId: string; status: 'DISCONTINUED'; stoppedAt: string }`. `422` missing reason; `400` already discontinued | `MedicationStore.discontinue()`; titration saga step 2 (`titrateSaga`: create-new-ACTIVE then discontinue-old with guarded half-failure repair — copy states "two-step, not atomic") |
| F-10 | `GET /api/v1/ehr/patients/:id/medications?status=` | `[DOCTOR]` | Bearer | query `{ status?: 'ACTIVE' \| 'DISCONTINUED' }` | `200 { data: { medicationId: string; drugName: string; dosage: string; frequency: string; instructions: string; status: 'ACTIVE' \| 'DISCONTINUED'; cessationReason: string \| null; startedAt: string; stoppedAt: string \| null }[] }` | `MedicationStore` Active vs Discontinued lists + client-side overlap advisories (advisory-only, labeled, never blocking — D-12/C-22) |
| F-11 | `POST /api/v1/ehr/vault/patients/:id/notes` (contract shape; code mounts equivalent under vault router — either path resolves to the same segregated service) | `[DOCTOR]` segregated | Bearer | `{ content: string (non-blank); noteDate?: string \| null }` | `201 { noteId: string; createdAt: string; keyId: string }` — ciphertext at rest, plaintext NEVER echoed. `422` empty | `VaultHolder.writeNote()` (ephemeral) ← `DoctorVaultPage`; `keyId` displayed per Appendix B custody checklist |
| F-12 | `GET /api/v1/ehr/vault/patients/:id/notes` | `[DOCTOR]` segregated | Bearer | n/a | `200` decrypted in memory: `{ data: { noteId: string; createdAt: string; keyId: string; content: string }[] }` (plaintext ONLY into `VaultHolder` map; `VAULT_ACCESS` id+timestamp audit) | `VaultHolder.readEphemeral()` → single-note reading pane; scrub on lock/logout/route-exit/tab-hide/idle (ZK-6/C-15/FT-8) |
| F-13 | `POST /api/v1/ehr/vault/notes/:id/shred` `[CODE]` (verified `vault.routes.ts:53-61` + `vault.service.ts:160-186` — tombstone, no recovery) — contract alias `…/patients/:id/notes/:noteId/shred` resolves here | `[DOCTOR]` segregated | Bearer | n/a (tombstone; typed `SHRED` confirm is CLIENT-side friction) | `200 { noteId: string; shreddedAt: string }` (ciphertext/wrappedDek/nonce nulled; idempotent re-shred returns existing tombstone). GAP-05 is CLOSED by code reality (Amendment V-SHRED-1) | `DoctorVaultPage` shred modal (Step-3 §3.6 pattern activates VERBATIM — typed `SHRED` + tombstone preview); post-shred row renders tombstone (`noteId · shreddedAt · actor`), never plaintext |

### 1.7 Module G — Multimodal AI Scribe Studio (Doctor Exclusive)

GEN-2 IS THE CANONICAL AND ONLY WORKFLOW (Decision 4 — re-baselined): consent → session →
`cycle-1-consultation` → `cycle-2-doctor-decision` → review → `commit` (+ `purge-audio` /
`withdraw-consent`). The "Gen-1" endpoints (`/audio`, `/stop`, `/transcribe`, `/drafts`,
`/drafts/:id/sign-off`) never existed in the backend and the client fallbacks were removed
(Amendment S-DUAL-1 is retired). Audio travels INLINE as base64 JSON (`{audioBase64,
mimeType?}` strict, ≤15 MB). Typed dictation in the studio is a client-side editing
affordance only — never transmitted. Consent gate: `AMBIENT_LIVE` without
`consentConfirmed:true` → `422 CONSENT_REQUIRED` (DICTATION_60S exempt). Withdrawal locks
the full surface (`403 WITHDRAWN_GONE`; repeat `409 CONFLICT`; `410 GONE` after purge).
Manual note corrections are a LOCAL lane (status EDITED, version n+1) — the corrected note
lands server-side at commit.

| # | Method & Path | Roles | Headers | Request Body Interface | Response DTO Interface | Binding Target |
|---|---------------|-------|---------|------------------------|------------------------|----------------|
| G-1 | `POST /api/v1/scribe/sessions` | `[DOCTOR]` | Bearer | `{ patientId: string; queueEntryId?: string; mode: 'AMBIENT_LIVE' \| 'DICTATION_60S' (default AMBIENT_LIVE); consentConfirmed?: boolean }` | `201 { sessionId: string; status: 'UPLOADED'; mode: ScribeMode; consentStatus: 'GRANTED'; audioRetentionUntil: string }` — FULL canonical session shape (client hydrates consent + retention from the create response alone). `422 CONSENT_REQUIRED` when `mode === 'AMBIENT_LIVE' && consentConfirmed !== true` | `ScribeStore.createSession()` ← consent-gate studio step; consent chip + retention countdown render from response |
| G-2b | `POST /api/v1/scribe/sessions/:id/cycle-1-consultation` (Gemini CYCLE_1 over consultation audio) | `[DOCTOR]` | Bearer | `{ audioBase64: string (≤15 MB, base64); mimeType?: string }` strict | `200 { sessionId: string; analysis: { chiefComplaint: string; symptoms: string[]; moodAndAffect: string; suggestions: { text: string; provenance: 'AI' }[] } }`. Errors: `409` COMMITTED; `403 WITHDRAWN_GONE` / `410 GONE`; `500 GEMINI_KEY_MISSING`; `422` non-JSON; `504 GEMINI_TIMEOUT` | `ScribeStore.runCycle1Analyze()` ← Pass-1 review (dialogue analysis panel, violet AI chips + provenance) |
| G-2c | `POST /api/v1/scribe/sessions/:id/cycle-2-doctor-decision` (Gemini CYCLE_2 prioritizing doctor speech) | `[DOCTOR]` | Bearer | `{ audioBase64: string; mimeType?: string }` strict (the typed note is client-only) | `200 { sessionId: string; soap: { S; O; A; P }; prescriptions: { drugName; dosage; frequency; instructions }[]; finalDiagnosis: string }`. `422` before cycle-1 | `ScribeStore.runCycle2Synthesis()` ← Pass-2 review (SOAP synthesis + diff highlights + MSE panel feed) |
| G-5 | `POST /api/v1/scribe/sessions/:id/withdraw-consent` | `[DOCTOR]` | Bearer | `{ reason?: string (operational note, no clinical) }` | `200 { sessionId: string; status: 'WITHDRAWN'; withdrawnAt: string \| null; retentionUntil: string \| null; audioPurged: true }` + audit `CONSENT_WITHDRAWN` (ids only). `400` already WITHDRAWN/PURGED | `ScribeStore.withdrawConsent()` ← deliberate confirmed audited action (dual-tap); purges local + server audio; full-surface lock UI with "Start new session" path (C-13) |
| G-6 | `POST /api/v1/scribe/sessions/:id/commit` (Gen-2 atomic commit) | `[DOCTOR]` | Bearer | `{ soap: { S; O; A; P } (each 1..10000); mse?: ExplicitMse (BE-501 canonical shape, NOT_PERFORMED sentinel allowed); prescriptions?: { drugName; dosage; frequency; instructions }[] (≤30); diagnoses?: string[] (≤20) }` strict | `200 { encounterId: string; status: 'COMMITTED' }` — ONE transaction creates Encounter `source: SCRIBE` (SIGNED, finalContentHash, originScribeDraftRef plain id) + linked Medication rows + flips the session COMMITTED; the doctor's MSE lands on the encounter (omitted → NOT_PERFORMED per domain) | `ScribeStore.commitScribeSession()` ← 1-click atomic commit (disabled until MSE explicit + consent + complete SOAP); double-commit guarded; navigates to chart card |
| G-7 | `POST /api/v1/scribe/sessions/:id/purge-audio` | `[DOCTOR]` | Bearer | n/a | `200 { sessionId: string; purged: true; status }` (bytes deleted, records kept) | Retention hygiene action + worker-driven TTL path share this result shape |

## 2. WebSocket Gateway Real-Time Ingestion Protocol

### 2.1 Connection lifecycle (normative)

1. **Handshake:** `io(API_HOST, { transports: ['websocket', 'polling'], withCredentials: true, auth: { token: <accessJWT> } })`. Invalid token → `connect_error` `401` → `refreshTokenInterceptor`-style refresh-once then reconnect with fresh Bearer. Deactivated → `403` → fail-closed `AuthStore.logout()` incl. WS teardown (C-24). No token in URL.
2. **Room subscription rules (server-enforced, client-requested):**
   - Both roles: `clinic:queue` (SecretSafe queue frames) + `clinic:intercom` (operational-only intercom frames).
   - Doctor only: `supervision.discrepancy` channel (server rejects secretary join; client MUST NOT attempt it — secretary bundle contains no handler, FT-1).
   - On connect/reconnect: emit `queue.subscribe { shiftId }` (current shift from `ShiftStore`; `sessionStorage` shift id fallback) → server replies with immediate `queue.updated` snapshot (authoritative bootstrap alongside REST `GET /queue`).
3. **Heartbeat & link states:** client `ping` 25 s; server `pong` timeout 10 s → `linkState: DEGRADED`. Lifecycle `DISCONNECTED → CONNECTING → LIVE → DEGRADED → RECONNECTING → LIVE` exposed as `linkState` signal. All transitions logged (ids + versions only).
4. **Reconnect (jittered exponential backoff 500 ms → 1 s → 2 s → 5 s → 15 s cap, reset on LIVE):** (a) fresh Bearer, (b) `queue.subscribe { shiftId }` → snapshot, (c) `BillingStore` resync of open invoices for visible patients (`GET /billing?shiftId=` + `GET /patients/:id/balance` for open drawers), (d) `IntercomStore` gap-fill from last `createdAt` cursor (`GET /intercom`). Convergence target < 1 s broadband. During partition: staleness badges + 15 s REST poll fallback (P-09); NEVER extrapolate positions/balances (C-09).

### 2.2 `queue.snapshot` ingestion specification (wire frame `queue.updated`)

There is NO frame literally named `queue.snapshot` — the Charter term is realized as **`queue.updated`** (authoritative snapshot) + REST `GET /queue` + `queue.subscribe` handshake snapshot. All frames carry `queueVersion`; `serverAt` accompanies order-affecting frames.

**Ops snapshot (`SecretSafe<QueueOpsSnapshotDto>`) vs Doctor snapshot (`QueueDoctorSnapshotDto`):**

| Aspect | Secretary (`clinic:queue` frame) | Doctor (`clinic:queue` frame + supervision channel) |
|--------|----------------------------------|------------------------------------------------------|
| Frame | `queue.updated: { queueVersion: number; shiftId: string; avgConsultDurationMin: number; serverAt: string; entries: { entryId: string; patientId: string; displayName: string; status: QueueStatus; position: number; isEmergency: boolean; checkedInAt: string; estimatedWaitMin: number }[] }` — built server-side from `toSecretQueueDto` array + `queueVersion` (CONV-02/05) | IDENTICAL `queue.updated` shape (channel rule, NOT payload fork — Step-1 §4.1). Doctor additionally receives `supervision.discrepancy` frames on the doctor-only channel |
| Frontend type | `SecretSafe<QueueOpsSnapshot>` → `OpsQueueEntry[]` (no clinical keys; `?include=clinical` fuzz yields nothing — FT-1/FT-2) | Same `OpsQueueEntry[]` for the board/command deck + separate `SupervisionStore` discrepancy state (never merged into queue entries — ZK-4) |
| Transformation | **Direct assignment, no normalization cache:** `entries[]` order = render order; `position` rendered never recomputed; `estimatedWaitMin` rendered never recomputed. Lane grouping preserves `position` order within lanes. Fixed-width mono columns prevent jitter | Same + `queue.called` flash wash on called row (1200 ms) + `queueVersion` chip update on every frame |
| Atomic assignment | `QueueStore.applySnapshot(snap)`: **version-gated replace** — `if (snap.queueVersion <= current) drop-stale; else replace entries + queueVersion + serverAt + avgConsultDurationMin` in ONE signal transaction (no torn renders). Jump (`> cur+1`) → `resync` via `GET /queue` first, then apply (never apply targeted deltas across a jump) | Same gate (`gateFrameVersion`: `apply | drop-stale | resync`, Step-2 §4.4). Targeted frames (`queue.called/reordered/emergency/undoComplete`) apply as targeted patch ONLY when contiguous (`cur+1`); otherwise resync |

**Frame routing table (all server→client include versioning):**

| Frame | Payload essence | Handler → Store write |
|-------|-----------------|-----------------------|
| `queue.updated` | `{ queueVersion, shiftId, avgConsultDurationMin, serverAt, entries[] }` SecretSafe | `QueueStore.applySnapshot` (full replace) |
| `queue.called` | `{ queueVersion, entryId, patientId, displayName, calledAt }` | version-check → contiguous: targeted patch + bump; jump: resync |
| `queue.reordered` | `{ queueVersion, orderedEntryIds, actorId, serverAt }` | same gate; ghost reorder reconciled |
| `queue.emergency` | `{ queueVersion, entryId, isEmergency, position, serverAt }` | same gate; pin/unpin + badge |
| `queue.undoComplete` | `{ queueVersion, entryId, status: 'IN_CONSULTATION', serverAt }` | same gate; secretary renders read-only |
| `billing.invoiceUpdated` | `{ shiftId, invoiceId, status, collectedMinor, outstandingMinor, serverAt }` totals-only SecretSafe | `BillingStore.applyInvoiceTotals` (invoice map patch; reconcile, never local-sum — INV-1) |
| `intercom.received` | `{ id, fromRole, type, text, relatedQueueEntryId, createdAt }` | `IntercomStore.applyReceived` + effect-receipt enrichment (invoice/task/`queueVersion`) + `unreadCount++` |
| `supervision.discrepancy` | `{ shiftId, inv, detail, serverAt }` doctor-room-only | `SupervisionStore.applyDiscrepancy` → non-blocking alert (never a toast with clinical/financial detail) |

**Client→server:**

| Message | Payload | Rules |
|---------|---------|-------|
| `queue.subscribe` | `{ shiftId: string }` | join + immediate snapshot. REST-only mutations (`queue.reorder` has NO WS mutation path — avoids version races) |
| `intercom.send` | `{ type: IntercomType; text?: string; relatedQueueEntryId?: string \| null; idempotencyKey?: string (REQUIRED iff DOCTOR_COMPLIMENTARY) }` | Zod-validated, type-ownership enforced. Forging → `FORBIDDEN` error frame, no broadcast. `DOCTOR_COMPLIMENTARY` executes idempotent complimentary + emits `billing.invoiceUpdated` + audit |

### 2.3 Intercom event ingestion & discrepancy feed

- **`intercom.received`:** `IntercomStore.applyReceived(msg)`: append (cap 200, paginate history), `unreadCount++` unless drawer focused/composer open, badge pulse (1600 ms, reduced-motion static), `aria-live=polite` ("1 unread intercom message"). Directive types enrich with effect receipts: `DOCTOR_COMPLIMENTARY` → zeroed invoice chip (`invoiceId · v{N}`); `DOCTOR_NEXT` → new `IN_CONSULTATION` entry + `queueVersion`; `DOCTOR_FOLLOWUP` → created task id. Text rendered with ZK-5 hint intact; no clinical pre-fill accepted.
- **`supervision.discrepancy`:** `SupervisionStore.applyDiscrepancy({ shiftId, inv, detail, serverAt })`: append to `discrepancies.invViolations` (dedupe by `(inv, detail)`), non-blocking banner "1 discrepancy — review" → supervision route. Secretary injector has no subscription, no handler, no state field for this channel.

---

## 3. Concurrency, OCC & Financial Protocol Enforcement

### 3.1 Queue concurrency (OCC) — body-version protocol [AMENDED]

- **Send:** every `POST /queue/reorder` and `POST /queue/:entryId/emergency` body MUST carry `lastSeenQueueVersion: number` sourced from `QueueStore.queueVersion()` at intent time (`occVersionInterceptor` injects/validates; `requeue` SHOULD also send it when available). `If-Match` MUST NOT be sent on ANY queue route. No-snapshot (`queueVersion === -1`) → block dispatch → `loadSnapshot()` first.
- **Server check (verified `queue.service.ts:856,946`):** `input.lastSeenQueueVersion !== shift.queueVersion` → `409 STALE_QUEUE` **with current snapshot attached**.
- **Client handling (`409 STALE_QUEUE`):** (1) `QueueStore.revertToSnapshot(attachedSnapshot)` — snap back ghost instantly (no animation masking); (2) warning toast "Queue changed under you (v{old} → v{new}). Review and retry." + [Review board] focusing changed rows; (3) NEVER auto-retry the drag/flag (C-01). Retry re-issues intent with the NEW version; reorder retry MAY reuse the SAME `Idempotency-Key` iff payload hash is identical (same order), else mint new.
- **`428 PRECONDITION_REQUIRED` on queue:** not emitted by queue routes (no `If-Match` contract). If ever received (proxy/misconfig), treat as `STALE_QUEUE`-class: reload snapshot, prompt retry. The Step-3 toast row for `PRECONDITION_REQUIRED` applies to ENCOUNTER PATCH (below), not queue.

### 3.2 Encounter concurrency (OCC) — `If-Match` + body-`rowVersion` [AMENDED, GAP-01 CLOSED]

- **PATCH `/ehr/encounters/:id`:** header `If-Match: <rowVersion>` (positive integer, REQUIRED — verified `encounter.routes.ts:38-48`). Client sources it from the hydrated encounter (`GET …/:id` / create response `rowVersion`). Missing/malformed → `428 PRECONDITION_REQUIRED` → handler forces `getEncounter()` refresh, re-arms editor with fresh `rowVersion`, toast "Encounter changed — refreshed. Review and retry." (info, [Reload] action). Stale (`If-Match` ≠ current) → `409 STALE_ROW_VERSION` → same refresh + route further edits to addendum if now SIGNED.
- **`POST /ehr/encounters/:id/sign`:** body `rowVersion: number` (current, REQUIRED). Concurrent sign/patch bump → `409 STALE_ROW_VERSION` → reload encounter; if now SIGNED → show signed state (no second sign); if still DRAFT → re-issue sign with new `rowVersion` after user confirm.
- **Scribe drafts:** integer `version` chain (`n+1`, superseded retained). Version-mismatch on `PATCH /scribe/drafts/:id` → reload draft → re-apply patch onto latest (manual merge UI for conflicting SOAP edits; MSE chips re-select).
- **Interceptor binding:** `occVersionInterceptor` MUST attach `If-Match` on `PATCH /ehr/encounters/:id` (sourced from `ConsultationStore` draft `rowVersion`) and MUST NOT attach it on any `/scribe/*`, `/ehr/**/medications`, or vault route (GAP-01 remainder: forbidden — draft/version semantics instead).

### 3.3 Idempotency outbox table (normative; full table in Appendix A)

- **Endpoints requiring UUIDv4 `Idempotency-Key`:** `POST /billing/checkout`, `POST /billing/invoices/:id/pay`, `POST /billing/receipts/:id/reverse`, **`POST /billing/invoices/:id/write-off` (E-1)**, `POST /billing/complimentary`, `POST /patients/:id/settle`, `POST /shifts/:id/petty`, `POST /shifts/:id/close`, `POST /queue/check-in`, `POST /queue/reorder`, `POST /queue/:entryId/emergency`, `POST /queue/:entryId/undo-complete`, `POST /intercom` iff `DOCTOR_COMPLIMENTARY` (REST + `intercom.send` WS `idempotencyKey`).
- **Client protocol (`OutboxStore` + `idempotencyInterceptor`, Step-2 §2.5/§3.4):** mint UUIDv4 at user-intent time (dialog confirm), persist `{ key, route, payloadHash (SHA-256 canonical JSON), entityId, shiftId, createdAt, state: PENDING }` BEFORE dispatch; attach header; terminal `2xx` (incl. `200 + Idempotent-Replayed: true`) → `markReplied` + remove + single success toast + reconcile to returned original (no double navigation — replay banner "Already recorded — showing current state." where the design system calls for it); `422 IDEMPOTENCY_KEY_REQUIRED` → attach + retry ONCE; `422 IDEMPOTENCY_KEY_REUSE` (same key, different payload hash) → HARD STOP + discard key + "Start fresh" (new UUID, fresh confirm); transport failure / `409 SHIFT_LOCKED` → retain PENDING + bounded same-key retry (250/750/2000 ms ×3) + resume-on-reload ("1 unsent payment — Resume / Discard"). Keys scoped per `(actor, shift, entity)` — cross-shift reuse forbidden. Outbox holds Ops payloads ONLY — clinical (SOAP/MSE/vault/scribe) MUST NEVER enter it (C-18/FT-7).
- **Cached-200 replay handling (`Idempotent-Replayed: true` banner):** every money/subscribed surface treats the replay header as success-with-notice: checkout/pay/petty/close/check-in/complimentary sheets show inline chip "Safe replay — original receipt restored (no duplicate charge)." + reconcile amounts/ids to the returned original. No error styling, no second audit row expected client-side (server writes `IDEMPOTENT_REPLAY`).

### 3.4 Blind cash drawer close contract (front-desk UI rules, normative)

1. **Type-level absence (P-04/C-12/FT-5):** the close-dialog state type and pre-close `ShiftSummary` type contain NO `expectedCashMinor` / `differenceMinor` field (not optional, not nullable — absent; reveal lives on a SEPARATE `ClosedShiftReveal` type returned only by `closeBlind()` post-persist). Pre-close `result/differenceMinor` are `null` and render as absent (`—`), never `0`.
2. **`expectedCashMinor` is `null` while OPEN:** `GET /shifts/:id/summary` pre-close carries no expected value for the closer (`toSecretShiftDto` blind-aware); the client MUST NOT fetch, derive, or display any drawer projection pre-reveal. The client MUST NOT compute `openingFloat + ΣCASH CHARGE − ΣCASH REVERSAL − Σpetty` (INV-8) as a preview — it holds all inputs, so this is a deliberate omission enforced by review + FT-5.
3. **Reveal strictly from the 200 close response:** `{ expectedCashMinor, actualCountedMinor, differenceMinor, result }` are extracted ONLY from the persisted `POST /shifts/:id/close` `200` payload, rendered in the reveal panel (BALANCED emerald / SURPLUS sky / DEFICIT amber + Display result word + next-step guidance). `actualCountedMinor` draft is NEVER persisted (re-entry required after reload).
4. **Gates:** close requires zero open `WAITING/IN_CONSULTATION` entries unless doctor force-with-reason (audited `FORCE_CLOSE`); `409 INVARIANT_VIOLATION + discrepancies[]` halts close → blocking dialog with resolve-or-escalate paths (resolve queue / open supervision / doctor force). `CLOSED` is terminal (INV-9) — post-close corrections go through a new-business-date adjustment invoice (doctor), never reopen; all mutation controls disable on CLOSED.

---

## 4. Master Error Envelope Translation Catalogue

Failure envelope `{ error: { code, message, details } }`. UI keys off `(HTTP status, code)`; `message` is debug-only. Unknown codes → safe generic + incident id, never retry loops. Toast/banner copy is operational-only (DS-03/ZK-7: no SOAP/diagnoses/drug names/vault excerpts/MSE values/expected-cash in copy). This catalogue EXTENDS Step-2 App. C and Step-3 §4.2 with contract-exact frontend behavior; where Step-3 copy differs, the copy here (with version chips/amounts formatted, never raw minor) is normative for Step 5.

| # | Backend code (HTTP) | Trigger (contract-exact) | User-facing feedback (exact behavior + copy) | Visual + Actions | Owner surface / Store |
|---|---------------------|--------------------------|----------------------------------------------|------------------|----------------------|
| 4-1 | `DISCOUNT_BELOW_FLOOR` (422) — same family as `FLOOR_VIOLATION` (403 floor breach) | `finalFeeMinor` below floor (`min(secretaryMaxDiscountMinor, standard*pct/100)`, tighter wins) or missing `discountReason` when `final < standard` | Toast/dialog-inline: **"Discount exceeds your floor."** "Max allowed {maxAllowed} on a {standard} fee. Collect at floor or hand to the doctor — complimentary / write-off needs doctor approval." + floor meter focus | Warning card (amber) in sheet; focus floor meter; CTA swap | `OpsBillingCheckoutSheet` / `BillingStore` |
| 4-2 | `FLOOR_VIOLATION` (403) | SECRETARY breaches `secretaryMaxDiscountMinor/Pct` (DB-09, server-side) | Same copy as 4-1 + audit notice. **"Requires doctor — discount exceeds secretary floor."** Route to doctor path; no retry, no silent escalation | Warning dialog-inline + [Collect at floor] [Request doctor] | Checkout → complimentary/write-off path |
| 4-3 | `CONSENT_REQUIRED` (422) | `POST /scribe/sessions` with `mode: AMBIENT_LIVE` and `consentConfirmed !== true` | **Prompt modal (blocking sheet, NOT a toast):** "Consent needed before recording." "Confirm explicit patient consent to start ambient capture." Requires acknowledgment checkbox + [Confirm consent] before session create; blocking until granted | Consent-capture step in studio; consent chip flips on grant | `DoctorScribeStudio` / `ScribeStore.createSession()` |
| 4-4 | `STALE_QUEUE` (409 + snapshot) | `lastSeenQueueVersion` ≠ current on reorder/emergency/(optional) requeue | Warning toast + board snap-back (ghost reverts instantly): **"Queue changed under you (v{old} → v{new})."** "Your reorder/flag was not applied. Review the board and retry." | Warning toast + [Review board] (focuses changed rows). NEVER auto-retry | Board / reorder / emergency / `QueueStore` |
| 4-5 | `PRECONDITION_REQUIRED` (428) | Missing/malformed `If-Match` on `PATCH /ehr/encounters/:id` | Info toast + version chip flashes amber: **"Encounter version missing — refreshing."** "Reloading the latest draft, then you can retry safely." | Info toast + [Reload draft] (forces `getEncounter()`; dispatch blocked until `rowVersion ≥ 1`) | `DoctorEncounterEditor` / `ConsultationStore` |
| 4-6 | `STALE_ROW_VERSION` (409) | Stale `If-Match` (PATCH) or stale body `rowVersion` (sign) on encounters | Warning toast: **"Encounter changed elsewhere — refreshed."** If now SIGNED → route to addendum ("Signed — addendum only"); else re-arm editor with new `rowVersion` for explicit retry | Warning + [Open addendum] / [Retry with latest] | Editor / sign-off review |
| 4-7 | `SHIFT_LOCKED` (409) | `lockShift` contention on checkout/pay/reverse/write-off/settle/petty/close | Info toast + "Drawer busy" chip: **"Drawer busy — safe to retry."** "Same receipt key held. Retrying…" (auto ×3: 250/750/2000 ms same-key) | Info + [Retry now] (same key) after exhaustion | All money surfaces / outbox |
| 4-8 | `INVOICE_ALREADY_WRITTEN_OFF` (400) | Any collect/reverse/checkout attempt on a `WRITTEN_OFF` invoice (E-3 sticky terminal) | **Blocking banner on the invoice panel (persistent, crimson-accented, NOT dismissible while invoice selected):** "Written off — terminal. No further collection, pay-down, or reversal is permitted on this invoice. Open a new-business-date adjustment invoice for corrections." | Banner + [View write-off audit] [Open balance] (pay/reverse/collect CTAs disabled with reason tooltips) | Invoice panel / pay-down / `BillingStore` |
| 4-9 | `IDEMPOTENCY_KEY_REQUIRED` (422) | Missing key on required route | Silent: interceptor attaches key + retries ONCE → success toast only. Second failure → hard error + Report | None on auto-recovery | Outbox / interceptor |
| 4-10 | `IDEMPOTENCY_KEY_REUSE` (422) | Same key, different payload hash | Error toast (persistent) + idem chip flips: **"Receipt key already used for a different amount."** "Start a fresh intent — the old key is retired." | Error + [Start fresh] (new UUID) | All money surfaces |
| 4-11 | `INVARIANT_VIOLATION` (409 + `discrepancies[]`) | BE-306 INV-1…INV-10 gate on close | **Blocking dialog:** "Close blocked — {n} discrepancies." Per-row `{inv, detail}` + resolve-or-escalate path | Modal + [Resolve queue] [Open supervision] [Force with reason — doctor] (audited) | Close → supervision |
| 4-12 | Reason / `DISCOUNT` / `MSE_REQUIRED` 422s | Blank justification / missing-vs-`NOT_PERFORMED` confusion | Inline field error (crimson helper + ring) + preserve amounts: **"A reason is required."** / **"MSE incomplete — {row} needs a finding. Select a finding or mark Not performed."** Focus first missing control | Inline + auto-focus + scroll | Checkout/reversal/write-off/petty/emergency/undo/MSE |
| 4-13 | `WITHDRAWN_GONE` (403) / `GONE` (410) | Audio/transcribe/synthesize/draft on WITHDRAWN/PURGED session | **Full-surface lock (NOT a toast):** "Session withdrawn/purged." "Transcribe and upload are locked. Start a new session to continue." | Lock screen + [Start new session] | Scribe studio |
| 4-14 | `ILLEGAL_TRANSITION` (400) | Illegal queue/clinical transition (unreachable by design — buttons disabled) | Silent converge to snapshot (log only) | None | Queue command |
| 4-15 | `ALREADY_REVERSED` (400) / pay-on-PAID-or-COMPLIMENTARY (400) / `409 already invoiced` / `409 duplicate open entry` | Correction/collection on settled state | Info toast + pivot (never error page): **"Already recorded — showing current state."** | [View receipt] [Open pay-down] [Jump to queue] | Receipts / pay / checkout / check-in |
| 4-16 | `UNAUTHORIZED` (401) | Expired/invalid access JWT | Transient "Session refreshing…" chip → replay; refresh failure → "Signed out — please sign in." | [Sign in] (`/login?reason=session`) | Session / guards / WS |
| 4-17 | `FORBIDDEN` (403) incl. deactivated + secretary→clinical | Deactivation / role denial | Lockout screen + scrub: **"Account deactivated — contact the doctor."** / **"Not permitted for your role."** Zero clinical fetch (FT-6) | `/403?reason=…` + [Back to desk] | Session / guards |
| 4-18 | `NOT_FOUND` (404) | Stale entity reference | Info toast: **"No longer available — list refreshed."** Remove reference, resync list | [Dismiss] | All entity views |
| 4-19 | `INTERNAL` (500 + incident id) | Server fault | Error toast: **"Something went wrong (ref {id})."** "Your work is safe. Report includes the reference only — never clinical content." | [Copy ref] [Report] | Global boundary |

**Required-section spot-responses (verbatim compliance):**
- `422 DISCOUNT_BELOW_FLOOR` → floor-percentage/minor violation toast + doctor-override guidance (row 4-1).
- `422 CONSENT_REQUIRED` → explicit-consent prompt modal before ambient scribe activation (row 4-3).
- `409 STALE_QUEUE` → automatic queue refresh (snapshot adoption) banner with zero data loss — user intent preserved as re-issuable draft, never silently dropped (row 4-4).
- `409 SHIFT_LOCKED` → transient lock retry prompt with same-key bounded retry (row 4-7).
- `400 INVOICE_ALREADY_WRITTEN_OFF` → terminal written-off banner blocking mutation (row 4-8).
- `403 FLOOR_VIOLATION` → secretary discount-limit warning + doctor path (row 4-2).
- `410 WITHDRAWN_GONE` (and `403 WITHDRAWN_GONE` / `410 GONE` family) → audio upload blocked due to consent withdrawal → new-session path (row 4-13).

---

## Appendix A — Idempotency Outbox Route Table (normative)

Chain position: `idempotencyInterceptor` (3rd, after `auth` + `occVersion`, before `refresh` + `errorEnvelope` — Step-2 App. B order retained; only the OCC mechanism changed per §3.1/§3.2).

| Route (client → server) | `Idempotency-Key` | OCC material | Notes |
|---|---|---|---|
| `POST /auth/login`, `POST /auth/refresh`, `GET /health` | never | never | public; excluded from Bearer |
| `GET /auth/me`, `GET /settings`, all `GET *` | never | never | reads are keyless |
| `PUT /api/v1/settings` | never | never | doctor-only config write; not cash-critical |
| `POST /queue/check-in` | REQUIRED (mint/reuse) | body has NO version (entry creation) | debt-ack retry reuses SAME key (same intent; `acknowledged:true` transition pre-agreed in payload hash) |
| `POST /queue/reorder` | REQUIRED | REQUIRED body `lastSeenQueueVersion` (NO `If-Match`) | version from `QueueStore`; `-1` blocks dispatch |
| `POST /queue/:id/emergency` | REQUIRED | REQUIRED body `lastSeenQueueVersion` (NO `If-Match`) | reason required both directions |
| `POST /queue/:id/call-next` variants, `/skip`, `/requeue`, `/complete`, `/no-show`, `/abandon`, `/debt-ack` | never (no server key requirement) | `requeue`/`no-show` SHOULD send body `lastSeenQueueVersion` when available (soft OCC) | `force` confirm + audit on single-consult 409; undo separate row |
| `POST /queue/:id/undo-complete` | REQUIRED (`{reason}` + key) | optional body `lastSeenQueueVersion` | single-hop, windowed; invoice NOT deleted |
| `POST /billing/checkout` | REQUIRED | never (`lockShift` server-side; `SHIFT_LOCKED` → bounded same-key retry) | `409 already invoiced` pivots to pay-down |
| `POST /billing/invoices/:id/pay` | REQUIRED (per-invoice key) | never | oldest-first orchestrator mints one key per line; or single `settle` key |
| `POST /patients/:id/settle` | REQUIRED (single key for the batch) | never | server-side oldest-first; remainder meter from response |
| `POST /billing/receipts/:id/reverse` | REQUIRED | never | doctor-only; reason required |
| `POST /billing/invoices/:id/write-off` | REQUIRED (E-1) | never | doctor-only; reason + amount required; replay = original, zero dup rows |
| `POST /billing/complimentary` | REQUIRED | never | doctor-only |
| `POST /shifts/:id/petty` | REQUIRED | never | EXPENSE-only; OPEN shift only |
| `POST /shifts/:id/close` | REQUIRED | never | `{actualCountedMinor}` only; reveal type separate |
| `POST /intercom` | REQUIRED iff `type === DOCTOR_COMPLIMENTARY` (REST and `intercom.send` WS `idempotencyKey`) | never | type-ownership enforced |
| `POST /ehr/*`, `POST /scribe/*`, vault routes | never | `PATCH /ehr/encounters/:id` header `If-Match` REQUIRED; `POST …/sign` body `rowVersion` REQUIRED; all other clinical routes NEVER carry version keys | draft/version semantics (E-OCC-1) |

---

## Appendix B — SecretSafe Mapper & Store Subscription Index

| Backend mapper (CONV-02, allowlist-first) | Frontend consumer (Ops model) | Subscribed stores → surfaces |
|---|---|---|
| `toSecretPatientDto` / search projection | `OpsPatientIdentity` | `QueueStore` (check-in rows), search lists → `OpsCheckInDialog`, wizard |
| `toSecretQueueDto` (+ `queueVersion`) | `OpsQueueEntry[]` + `queueVersion` | `QueueStore` → `OpsWaitingRoomBoard`, `DoctorCommandDeck`, `OpsHome` |
| `toSecretInvoiceDto` | `OpsInvoice` | `BillingStore.invoices` → checkout sheet, ledger, balance lines |
| `toSecretReceiptDto` | `OpsReceipt` | `BillingStore.receipts` → archive, chains |
| `toSecretPatientBalanceDto` (BOTH roles identical — E-4) | `PatientBalance { outstandingMinor, hasDebtAlert, lines[] oldest-first }` | `BillingStore.balanceByPatient` → debt sheet, balance panel, check-in ack step |
| `toSecretShiftDto` (blind-aware: omits expected pre-close for closer) | `OpsShift` + `ShiftSummary` (no expected field) / `ClosedShiftReveal` (post-persist only) | `ShiftStore` → open dialog, petty sheet, blind close, day summary |
| `toSecretIntercomDto` | `IntercomMsg` | `IntercomStore` → dock, widget listener, history |
| `toSecretAuditDto` (role-filtered: secretary own-ops only) | `AuditEvent` (operational) | `SupervisionStore` (doctor) → activity/cash/discrepancy/readiness; secretary audit view (presentation only) |
| NO mapper for clinical types (hard 403) | `Clinical*` family (cockpit-only) | `ConsultationStore`, `ScribeStore`, `MedicationStore`, `VaultHolder` — never in secretary injector/chunk (FT-1/FT-6/FT-8) |

---

## Appendix C — Backend Code-Reality Reconciliation Log (E-1…E-4 + drift)

| ID | Subject | Contract prose said | Code on disk says (verified) | Frontend posture (this map) |
|----|---------|---------------------|-------------------------------|-----------------------------|
| E-1 | `Idempotency-Key` on write-off | Required (API Part 0 list) | MANDATORY: `idempotency('billing.writeOff')` + `readIdempotencyKey` guard (`billing.routes.ts:131-149`) | §1 D-4 + App. A: key REQUIRED; replay = `200 + Idempotent-Replayed: true`, zero dup rows |
| E-2 | Audit action canon | `WRITE_OFF` (contract) | Canonical `action: 'WRITE_OFF'` (`billing.service.ts:693`; supervision filter `supervision.service.ts:139`) | §1 H-1 audit `action` enum carries `WRITE_OFF`; write-off rows queryable by it |
| E-3 | `WRITTEN_OFF` terminality | Sticky terminal rejecting re-checkout with 400 | Enforced at 4 call sites: checkout/pay guards (`billing.service.ts:93,152,388,401,656`) + `nextStatus` pin (`billing.support.ts:70-85`) → `400 INVOICE_ALREADY_WRITTEN_OFF` | §1 D-3/D-4 + §4 row 4-8: terminal banner, disabled pay/reverse/collect with forward guidance |
| E-4 | Complimentary balance sync | Auto-sync of patient balance | `toSecretPatientBalanceDto` served identically to BOTH roles (`billing.dto.ts:392`, `billing.service.ts:761`); complimentary contributes zero due | §1 B-5: identical shape both roles; no manual refresh; `hasDebtAlert` derives from server `outstandingMinor` only |
| E-5 | Verified spec endpoints | `/billing/invoices/:id/write-off`, `GET /patients/:id/balance`, `GET /billing`, `GET /api/v1/audit`, `PUT /api/v1/settings` | All mounted and role-guarded (`billing.routes.ts`, `audit.routes.ts`, `settings.routes.ts`, `app.ts:64`) | Full rows: D-4, B-5, D-6, H-1, A-11 |
| E-6 | Scribe DB lifecycle | `ScribeSession`/`ScribeDraft`, consent gate, withdrawal, encrypted audio, retention worker | Verified: `scribe.service.ts` (consent `422 CONSENT_REQUIRED`, `audioRetentionUntil`, `WITHDRAWN` lock, TTL purge nulling `audioReference`), validators, retention worker, `withdraw-consent` route | §1 Module G (dual-gen G-1…G-11) + §4 rows 4-3/4-13 |
| Q-OCC-1 | Queue OCC mechanism | Step-2 App. B said `If-Match` header + body version | Body `lastSeenQueueVersion` ONLY; NO `If-Match` on queue (`queue.routes.ts`, `queue.validators.ts:97,127`, `queue.service.ts:856,946`) | §1 Module C + §3.1: body-version protocol; `If-Match` on queue FORBIDDEN |
| E-OCC-1 | Encounter OCC (GAP-01) | Step-1 GAP-01 said "no If-Match; never send" | `If-Match: <rowVersion>` REQUIRED on PATCH (428/409) (`encounter.routes.ts:38-48,93-113`); `rowVersion` in sign body (`encounter.service.ts`) | §1 F-4/F-5 + §3.2: header + body protocol; GAP-01 CLOSED |
| V-SHRED-1 | Vault shred (GAP-05) | "No endpoint; must not fake shred" | `POST /ehr/vault/notes/:id/shred` EXISTS — tombstone, idempotent (`vault.routes.ts:53-61`, `vault.service.ts:160-186`) | §1 F-13: Step-3 §3.6 shred modal ACTIVATES verbatim; GAP-05 CLOSED |
| S-DUAL-1 | Scribe generations | Contract Gen-1 only (`/audio`, `/stop`, `/transcribe`, `/drafts…`) | Code Gen-2 live (`/cycle-1-consultation`, `/cycle-2-doctor-decision`, `/commit`, `/purge-audio`) alongside `withdraw-consent` | §1 Module G: dual-gen support, probe Gen-2 first, exactly one commit per session |
| Q-EXTRA-1 | Queue extras | `/call-next`, `/skip`, `/requeue`, `/complete` only | Code adds `POST /queue/call-next` (global), `/:entryId/call`, `/no-show`, `/abandon`, `/debt-ack` | §1 C-3/C-4/C-12/C-13/C-14 rows added; none leak to secretary beyond RBAC |
| E-APPEND-1 | Addendum path | `POST …/append` (singular) | Code: `POST …/addenda` (plural) (`encounter.routes.ts:144-157`) | §1 F-6: plural is canonical; singular treated as alias |
| B-SETTLE-1 | Settle convenience | Balance + per-invoice `pay` only | `POST /patients/:id/settle` + `GET /patients/:id/balance` on `patientSettleRouter` (`billing.routes.ts:180-212`) | §1 B-6 + D-orchestrator fallback rule |

---

## Appendix D — Traceability (S-*/D-* → Endpoints → Stores)

| Feature(s) | Endpoints (§1) | Primary store binding |
|---|---|---|
| S-01 check-in + debt-ack | B-1, B-3, B-5, C-1, C-14 | `QueueStore` + `BillingStore.balanceByPatient` + `OutboxStore` |
| S-02 registration + duplicate | B-1, B-2 | R-1 search stream + `OpsApi` guards |
| S-03 crisis intake | B-2 (lite), C-1 (emergency), B-4 (completion) | `QueueStore.checkIn` + crisis dialog |
| S-04 queue lanes | C-2 + `queue.updated` | `QueueStore` snapshot discipline |
| S-05 DnD reorder (OCC) | C-9 | `QueueStore.reorder` + `occVersionInterceptor` + §3.1 |
| S-06 emergency flag | C-10 | `QueueStore.flagEmergency` |
| S-07 wait times | C-11 + `queue.updated` | `QueueStore.headWaitMin()` (server values only) |
| S-08/S-09/S-10 fee/reason/floor | A-10, D-1 | `SettingsStore.floorMeterFor` + `BillingStore.checkout` |
| S-11 methods | D-1, D-3 | preset→`CASH\|OTHER` map; chips |
| S-12 debt oldest-first | B-5, B-6, D-3 | `BillingStore.allocateOldestFirst` / `settlePatient` |
| S-13 receipts archive | D-7 | `BillingStore.receipts` (closed-only nav, GAP-03) |
| S-14 intercom dock | E-1, E-2 | `IntercomStore` + effect receipts |
| S-15 petty | D-9, D-10 | `ShiftStore` petty (EXPENSE-only) |
| S-16 blind close | D-11 | `ShiftStore.closeBlind` → `ClosedShiftReveal` |
| S-17 day summary | D-12 | `ShiftStore.summary` (null-slots absent) |
| S-18 ZK isolation | all (role-filtered) | FT-1/FT-2/FT-6/FT-8 + injector scoping |
| D-01 oversight | H-1…H-5 + `supervision.discrepancy` | `SupervisionStore` (doctor scope) |
| D-02 queue command | C-3…C-8 | `QueueStore` intents + machine |
| D-03 audio ingest | G-1, G-2a/b | `ScribeStore` + 60 s cap countdown |
| D-04 MSE chips | F-1, G-8, F-5 (MSE payloads) | `ExplicitMse` + FT-4 guards |
| D-05 scribe 3-pass | G-1…G-11 | `ScribeStore` dual-gen machine |
| D-06 timeline | F-2 | chart `resource` (SIGNED-only) |
| D-07 manual SOAP | F-1, F-3, F-4, F-5 | `ConsultationStore` + E-OCC-1 |
| D-08 addenda | F-6 | version display |
| D-09 vault | F-11, F-12, F-13 | `VaultHolder` + `vaultGuard` |
| D-10 meds | F-8, F-9, F-10 | `MedicationStore` |
| D-11 titration | F-8 + F-9 (saga) | `titrateSaga` + repair screen |
| D-12 overlap flags | F-10 (read) | client advisory badges |
| D-13 directives widget | E-2, D-2, C-3 | pills + effect receipts + complimentary key rule |

Deferred F-01…F-10 / excluded X-01/X-02: NO bindings by design (§5.3 gate in Step 1). No row, token, or copy string in this map implies them.

---

## Appendix E — Step-5 Entry Criteria

**SPEC-API-E.1 — Gates (all MUST hold before Step 5 writes service/store code):** (1) this map approved; (2) Amendments Q-OCC-1 (queue body-version, no `If-Match`), E-OCC-1 (encounter `If-Match` + sign `rowVersion`, GAP-01 closed), V-SHRED-1 (vault shred live, GAP-05 closed), S-DUAL-1 (scribe dual-gen) recorded in `occVersionInterceptor` + `frame-guards` + FT-3/FT-4 skeletons; (3) `OpsApi` (root) / `ClinicalApi` (cockpit-scoped) facades stubbed with EVERY §1 row present as a typed method signature (no bodies yet) + `OutboxStore` + blind-aware shift types (`ShiftSummary` without expected / `ClosedShiftReveal` separate); (4) `SocketService` + `queue-ingest` version gate + `supervision.discrepancy` doctor-only channel stubbed; (5) error-catalogue (§4 rows 4-1…4-19) encoded as a copy+behavior table in `core/errors/error-catalogue.ts` stub with the seven required-section behaviors covered by red tests; (6) FT-1…FT-8 tripwire mirror green on stubs (import-graph, allowlist snapshot incl. `toSecretPatientBalanceDto` both-roles identity, OCC header/body assertions per the AMENDED mechanisms, MSE `NOT_PERFORMED` literal, blindness absence, navigation zero-fetch, outbox replay/REUSE, memory hygiene).

**SPEC-API-E.2 — Amendment rule:** any new endpoint, header, WS frame, error code, or RBAC change requires an integration-map amendment (method + path + RBAC + headers + request/response interfaces + binding target + error-catalogue row + Appendix C entry). Ad-hoc fetches, unlisted headers, or silent wire extensions in Step-5 code are defects regardless of functional merit.

---

*End of Step 4 specification. Next: Step 5 service/store implementation per §§1–4 and Appendices A–C, bound by the contract-exact endpoint matrix, the amended OCC mechanisms, the blind-close null discipline, and the FT-1…FT-8 gates. No Step-5 code is authorized outside this map's endpoint rows, interceptor/queue-ingest rules, SecretSafe index, and error catalogue.*
