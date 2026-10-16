# Backend Technical Specification & Developer WBS — Psychiatric Practice Management System (RPS-2 Applied)

> **Status:** APPROVED — RPS-2 APPLIED. RPS-2 WINS over pre-RPS-2 text. Mutable-receipt, direct-collected-edit, relation-join, and denylist tasks are DELETED and replaced below.
> **Stack:** Node.js (TypeScript Strict) modular monolith, single Prisma client, single schema file, Express + Zod + Socket.io
> **RBAC:** DOCTOR full+supervisory vs SECRETARY operational allowlisted SecretSafe only
> **Build order (official RPS-2):** BE-101 → 102 → 103 → 104 → 201 → 202 → 203 → 301 → 302 → 303 → 304 → 305 → 306 → 401 → 402 → 701 → 501 → 502 → 503 → 601 → 602 → 603 → 604 → 702 → hardening

## 0. Governing Architecture (RPS-2)

- Single Prisma client via `src/common/prisma.ts`; single `schema.prisma`. Per-module clients or second schema forbidden (tripwire C-1/C-2).
- Operational→clinical Prisma relations DELETED (DB-02). Correlation via plain indexed string refs, explicit DOCTOR-only second queries. `include: { encounter }` from operational code is a compile error.
- Canon SQL: exactly 3 statements (Appendix A in DATABASE_SCHEMA_SPEC §14): uq_queue_single_consult, uq_queue_one_open_per_patient, REVOKE UPDATE/DELETE ON receipts/audit_events. No fourth statement without new RPS.
- Allowlist-first DTOs: `toSecret<X>Dto → SecretSafe<T>` (CONV-02). No denylist stripping.
- Cash concurrency: `lockShift(tx, shiftId)` on all cash mutations; `queueVersion` OCC on queue mutations (CONV-04/05).
- Financial: CHARGE/REVERSAL receipts, pay split (`/pay`), reverse (`/reverse`), write-off (doctor), Idempotency-Key everywhere cash, secretary floor, blind close.
- Clinical/AI: manual encounter path, NOT_PERFORMED MSE, consent withdraw + 30d purge.
- Global: error envelope `{ error: { code, message, details: [] } }`; money minor units; UTC; `?limit&cursor`.

### Part 4 — RPS-2 Task Deltas (applied to tickets below)
- BE-101: single client + single schema + tripwire scaffolding (C-1/C-2/C-3/C-11).
- BE-103: replace denylist sanitizer with allowlist SecretSafe mappers + SecretSafe type tests (F-1/F-2).
- BE-202: add DB partial uniques + one-open-per-patient + undo-complete + queueVersion plumbing.
- BE-203: require If-Match queueVersion + idempotency on reorder/emergency; STALE_QUEUE handling.
- BE-301: split checkout (create) vs pay (collect); floor check; idempotency; lockShift.
- BE-302: pay endpoint owns collections; write-off owns uncollectible (no silent deletes).
- BE-303: CHARGE/REVERSAL + reversal endpoint + REVOKE + no update/delete paths.
- BE-305: blind close + INV gate (delegates math to BE-306) + idempotency + lockShift.
- BE-401/402: versioned snapshots (queueVersion) + idempotent complimentary + SecretSafe frames.
- BE-501: manual POST + explicit sign + NOT_PERFORMED MSE + plain refs (no FK).
- BE-502: encounterRef plain string (no FK).
- BE-503: keyId + custody checklist linkage.
- BE-601/602/603: consent lock + purge TTL + NOT_PERFORMED + plain signedEncounterRef.
- BE-701: operational-only audit + requestId dedup + IDEMPOTENT_REPLAY.
- NEW BE-306, BE-604, BE-702 defined below.

---

## EPIC 1: Foundation, Security & RBAC (RPS-2)

### BE-101 — Scaffold, Single Client, Single Schema, Tripwires
- Objective: Modular skeleton + one Prisma client + one schema + CI tripwires C-1/C-2/C-3/C-11.
- Ownership: common. Depends: none.
- Schema: ClinicSettings incl. secretaryMaxDiscountMinor/Pct, audioRetentionDays=30.
- Endpoints: GET /health 200; GET /api/v1/settings [BOTH] SecretSafe (incl. floor + TTL).
- Logic: No cross-module persistence imports. Cross-domain via id-only events.
- Security: All /api/v1/* behind authenticate except login/refresh/health.
- Acceptance: Boots; 401 unauth; second-client/second-schema/operational→clinical-relation greps fail CI if introduced.

### BE-102 — Auth JWT Access+Refresh, Hashing, Sessions
- Objective: Login/rotation/logout. Ownership: auth-users. Depends: BE-101.
- Entity User + RefreshTokenFamily (Cascade here ONLY).
- Endpoints: POST /auth/login →200+cookie /401/403; POST /auth/refresh →200/401 reuse-revokes; POST /auth/logout →200; GET /auth/me →200.
- Acceptance: Reuse revokes family; deactivated blocked incl. WS.

### BE-103 — RBAC + Allowlist SecretSafe Layer (RPS-2 replaces denylist)
- Objective: SECRETARY sees ONLY allowlisted SecretSafe DTOs; clinical has NO SecretSafe type (hard 403).
- Ownership: common/allowlist. Depends: BE-102.
- Logic: Implement `SecretSafe<T>` brand + `toSecretPatientDto/QueueDto/InvoiceDto/ReceiptDto/ShiftDto (blind-aware)/IntercomDto/AuditDto`. SECRETARY handlers MUST return SecretSafe (type error otherwise). EHR/scribe/vault requireRole DOCTOR before service. Audit write-time allowlist. DELETE old sanitize-strip code.
- Acceptance: F-1/F-2 green: SECRETARY snapshots contain only allowlisted keys; `?include=clinical` 403 or SecretSafe-clean; schema grep for severed relations clean.

### BE-104 — Seeded DOCTOR + Secretary Management
- Objective: Single owner + dynamic staff. Ownership: auth-users. Depends: BE-102/103.
- Endpoints: POST /users/secretaries [DOCTOR] 201/409/422; GET /users [DOCTOR]; PATCH /users/:id/deactivate|activate [DOCTOR]; POST /auth/change-password [BOTH].
- Acceptance: Idempotent seed; SECRETARY create 403; deactivation revokes refresh+WS.

---

## EPIC 2: Identity & Queue (RPS-2: constraints + OCC + undo)

### BE-201 — Patient Registration & Fast Search (Allowlisted)
- Entity Patient (outstanding derived cache, adminNotes ≤500 chars).
- Endpoints: GET /patients/search?q= [BOTH] SecretSafe + hasDebtAlert; POST /patients →201/422/409 with candidate; GET /patients/:id SecretSafe + pastVisitTimestamps; PATCH /patients/:id contact-only.
- Acceptance: <300ms indexed; debt flag; duplicate 409; no clinical keys (none exist to leak).

### BE-202 — Queue Engine FIFO + State Machine + DB Constraints + Undo
- Entity QueueEntry (status machine + clinicalEncounterRef PLAIN string nullable indexed NO FK + idempotencyKey unique scope + undoWindowUntil nullable) + Shift.queueVersion.
- Endpoints: POST /queue/check-in (Idempotency-Key) →201 + queueVersion /200 requiresAck when debt /409 one-open-per-patient; GET /queue →200 with queueVersion SecretSafe; POST /queue/:id/call-next [DOCTOR] 409 single-consult; /skip [DOCTOR]; /requeue [BOTH]; /complete [DOCTOR] → auto-invoice; POST /queue/:id/undo-complete [DOCTOR] `{reason, lastSeenQueueVersion?}` + Idempotency-Key (middleware-enforced) →200 single-hop COMPLETED→IN_CONSULTATION (API-06) within window + audit QUEUE_COMPLETE_UNDO + invoice retained /400 expired /403 /409 blocked|stale|active-consult.
- Machine: WAITING→IN_CONSULTATION→COMPLETED (+undo back once); WAITING↔SKIPPED. No WAITING→COMPLETED.
- Acceptance: FIFO stable; DB uniques hit under race (409, no double); undo preserves invoice (no delete); WS emits versioned frames.

### BE-203 — Reorder + Emergency + Wait-Time + OCC
- Endpoints: POST /queue/reorder `{orderedEntryIds, expectedQueueVersion}` + If-Match + Idempotency-Key →200 queueVersion n+1 /422 non-WAITING or burying emergency /409 STALE_QUEUE with snapshot; POST /queue/:id/emergency `{isEmergency, reason}` + version + idempotency →200 position 0; GET /queue/wait-times →200 with queueVersion.
- Logic: wait = precedingWAITING × avgDuration (excludes active/completed/skipped). Emergency top; multi-emergency by flag time. Every mutation bumps queueVersion in transaction + audit.
- Acceptance: Stale loser gets 409 + snapshot; emergency cannot be buried; wait recomputed + broadcast.

---

## EPIC 3: Cashier, Balances & Reconciliation (RPS-2: CHARGE/REVERSAL, pay split, floor, blind)

### BE-301 — Fee Billing Create + Floor + Idempotency + lockShift
- Entity Invoice (standard/final/discount derived + discountReason iff down + isComplimentary+doctor + collected DERIVED + writeOff + outstanding derived + status incl. WRITTEN_OFF + idempotencyKey unique).
- Endpoints: POST /billing/checkout (Idempotency-Key, lockShift) `{queueEntryId, collectedMinor, finalFeeMinor?, discountReason?, method?}` →201 CHARGE + invoice /422 no-reason /403 FLOOR_VIOLATION (secretary breach) /409 invoiced /409 SHIFT_LOCKED; POST /billing/complimentary [DOCTOR] (Idempotency-Key, lockShift) →201 COMPLIMENTARY; GET /billing SecretSafe.
- Logic: Checkout = create only. Floor: tighter of absolute + pct wins. Up override free; down needs reason + floor pass.
- Acceptance: No-reason 422; floor breach 403 + audit; complimentary SECRETARY 403; replay idempotent.

### BE-302 — Debt Pay-Down + Write-Off (uncollectible fix)
- Logic: outstanding = max(0, final−collected−writeOff). Patient outstanding = sum UNPAID/PARTIAL.
- Endpoints: GET /patients/:id/balance [BOTH]; POST /billing/invoices/:id/pay [BOTH] (Idempotency-Key, lockShift) `{collectedMinor>0, method?}` →201 CHARGE /400 nothing-due; POST /billing/invoices/:id/write-off [DOCTOR] (lockShift) `{writeOffMinor>0, writeOffReason}` →200; check-in debtAlert ADVISORY-ONLY (Decision 1 — strict schema with NO acknowledged field; entry always 201; optional POST /queue/:id/debt-ack advisory record).
- Acceptance: Multi-visit pay-down works; uncollectible via write-off (never delete); next-visit alert.

### BE-303 — Immutable Receipts CHARGE/REVERSAL + Reverse Endpoint
- Entity Receipt (type CHARGE|REVERSAL + reversalOfReceiptId PLAIN string + reason iff REVERSAL + idempotencyKey unique, no updatedAt) + DB REVOKE.
- Endpoints: GET /receipts*, GET /receipts/:id SecretSafe; POST /billing/receipts/:id/reverse [DOCTOR] (Idempotency-Key, lockShift) `{reason}` →201 REVERSAL /403 SECRETARY /400 already-reversed. No update/delete routes (REVOKE).
- Rule: collected = ΣCHARGE − ΣREVERSAL per invoice. Zero CHARGE allowed once for UNPAID traceability.
- Acceptance: F-7 green (direct UPDATE/DELETE as app role rejected); double-reverse 400; replay idempotent.

### BE-304 — Petty Cash (lockShift + idempotency)
- Entity PettyExpense (shift FK + amount>0 + purpose + idempotencyKey unique).
- Endpoints: POST /shifts/:id/petty (Idempotency-Key, lockShift) →201 /422 /400 CLOSED; GET list.
- Acceptance: OPEN-only; reduces expected; idempotent replay.

### BE-305 — Blind Shift Close + Summary (delegates math to BE-306)
- Entity Shift (businessDate unique + status + queueVersion + expected NULLABLE withheld + actual + difference + result + closeIdempotencyKey).
- Endpoints: POST /shifts/open →201/409; POST /shifts/:id/close (Idempotency-Key, lockShift, blind) `{actualCountedMinor}` →200 reveals expected/difference/result + queueVersion /422 open entries unless force+doctor /400 CLOSED /409 INVARIANT_VIOLATION with discrepancies[] /409 SHIFT_LOCKED; GET /shifts/:id/summary SecretSafe (pre-close hides expected from closer).
- Formula (via BE-306): expected = openingFloat + ΣCASH CHARGE − ΣCASH REVERSAL − Σpetty; difference = actual−expected.
- Acceptance: Blind (no pre-leak); closed immutable; force requires doctor+reason+audit.

### BE-306 — Reconciliation Invariants Service INV-1..10 (NEW, P0)
- Objective: Single place computing expected/collected/outstanding + gating close + feeding discrepancy views. Ownership: cashier-shift. Depends: BE-301..305.
- Logic: Implement INV-1 collected, INV-2 outstanding, INV-3 discount/write-off separation, INV-4 reversal linkage, INV-5 idempotency, INV-6 floor, INV-7 petty containment, INV-8 blind expected, INV-9 closed freeze, INV-10 audit coverage. Expose `checkShiftInvariants(shiftId)` returning violations[]; close calls it in lockShift transaction and rejects with 409 + violations unless doctor-forced with reason (still audited, still listed in discrepancies as forced).
- Endpoints: (internal service + consumed by BE-305/BE-702; no direct public route except via supervision views).
- Acceptance: F-8 green: seeded violations (mismatched collected, double reversal, missing audit, floor breach) all detected; close blocked until resolved/forced.

---

## EPIC 4: Realtime Intercom & Sync (RPS-2 versioned)

### BE-401 — WS Gateway Auth + Versioned Queue Sync
- Events in clinic:queue (SecretSafe): queue.updated (full snapshot + queueVersion + shiftId), queue.called, queue.reordered, queue.emergency, queue.undoComplete, billing.invoiceUpdated (totals only). All include queueVersion/serverAt. Reconnect replays snapshot.
- Acceptance: Converge <1s; SECRETARY frames SecretSafe-only + versioned; unauth rejected; stale client recovers via STALE_QUEUE snapshot.

### BE-402 — Intercom Channel (idempotent complimentary)
- Entity IntercomMessage (operational FKs only; clinicalRef ABSENT; idempotencyKey for complimentary) + FollowUpTask.
- Transport: WS intercom.send → intercom.received + POST /intercom fallback (Idempotency-Key iff COMPLIMENTARY) + GET history SecretSafe.
- Mapping: COMPLIMENTARY idempotent zeroes (DOCTOR); NEXT request; FOLLOWUP creates task; DISRUPTION/PHARMACY_LAB + capped CUSTOM_TEXT (warning on clinical-like text).
- Acceptance: 6 triggers round-trip; complimentary idempotent; forging 403.

---

## EPIC 5: EHR & Vault (Doctor-Only, RPS-2 manual + plain refs)

### BE-501 — Chart / Encounter Service (manual path + NOT_PERFORMED + explicit sign)
- Entity Encounter (patient FK ONLY; queueEntryRef PLAIN string NO FK; source MANUAL|SCRIBE; soap S/O/A/P; mse ×4 each explicit incl. NOT_PERFORMED; diagnoses; DRAFT/SIGNED; originScribeDraftRef PLAIN NO FK).
- Endpoints [DOCTOR]: POST /ehr/encounters (MANUAL, no queue required) →201 DRAFT /422 MSE missing (distinguish missing vs NOT_PERFORMED); GET /ehr/patients/:id/chart (SIGNED desc); GET /ehr/encounters/:id; PATCH /ehr/encounters/:id draft-only; POST /ehr/encounters/:id/sign `{finalSoap?}` →200 SIGNED /409 signed /422 incomplete; POST /ehr/encounters/:id/append `{addendumText}` →201 versioned.
- Acceptance: Manual without queue succeeds; MSE missing 422 vs NOT_PERFORMED ok; unsigned invisible in timeline; SECRETARY 403 everywhere; no FK to queue (plain ref).

### BE-502 — Medication Tracker (plain encounterRef)
- Entity Medication (patient FK; encounterRef PLAIN NO FK; drug/dose/freq/instructions; ACTIVE/DISCONTINUED + cessationReason + stoppedAt).
- Endpoints [DOCTOR]: POST /ehr/patients/:id/medications →201; POST /ehr/medications/:id/discontinue `{cessationReason}` →200/422/400; GET list.
- Acceptance: No-reason 422; SECRETARY 403.

### BE-503 — Vault (ciphertext + keyId + custody)
- Entity TherapyNote (patient FK ONLY; encounterRef PLAIN NO FK; ciphertext; keyId; DOCTOR; no FKs to operational).
- Endpoints [DOCTOR] segregated: POST /ehr/vault/patients/:id/notes `{content}` →201 `{noteId, createdAt, keyId}` (never echoes plaintext); GET list (decrypt in memory).
- Acceptance: SECRETARY 403; at-rest ciphertext + keyId; audit id-only; custody checklist (App. B) followed on rotation.

---

## EPIC 6: Scribe Pipeline (RPS-2 consent + purge + plain refs)

### BE-601..604 — AI Scribe (SUPERSEDED BY THE GEN-2 IMPLEMENTATION, Decision 4)

The original plan below described a Gen-1 pipeline (binary upload → stop → transcribe →
drafts → sign-off). The implementation and this document now standardize on the Gen-2
Gemini 2-cycle workflow: consent gate (AMBIENT requires consentConfirmed) →
`POST /scribe/sessions` (full canonical session shape) → `cycle-1-consultation` →
`cycle-2-doctor-decision` → `commit` ({soap, mse?, prescriptions?, diagnoses?} strict;
Encounter source SCRIBE + Medications atomically; MSE reaches the encounter) →
`purge-audio` / `withdraw-consent` (+ retention worker). No Gen-1 endpoint exists.
Historical plan retained verbatim below for traceability.

### BE-601 (historical plan) — Audio Ingestion (consent gate)
- Entity ScribeSession (patient FK; encounterRef PLAIN NO FK; mode; audioReference NULLABLE post-purge; durationSec; consentStatus GRANTED default; consentedAt; withdrawnAt/withdrawalReason nullable; status incl. WITHDRAWN/PURGED; audioRetentionUntil = created+30d; transcriptReference nullable).
- Endpoints [DOCTOR]: POST /scribe/sessions →201 GRANTED + retentionUntil /422 AMBIENT w/o consent; POST .../:id/audio →200 /422 cap /410 withdrawn (use new session); POST .../:id/stop →200 partial.
- Acceptance: No-consent 422; withdrawn blocks upload/transcribe.

### BE-602 — STT/LLM Adapter (MSE-explicit, never writes chart)
- Interface ScribeAdapter {transcribe, synthesize} pluggable/mocked.
- Entity ScribeDraft (session FK clinical-side retained; patient FK; mseSnapshot explicit incl. NOT_PERFORMED; transcriptReference; soapDraft S/O/A/P AI-suggested; confidence; version; DRAFT; signedEncounterRef PLAIN NO FK).
- Endpoints [DOCTOR]: POST /scribe/sessions/:id/transcribe →202 (blocked if WITHDRAWN/PURGED 409/410); POST /scribe/drafts `{scribeSessionId, mse explicit}` →201 /422 MSE missing; GET /scribe/drafts/:id.
- Acceptance: NOT_PERFORMED accepted, missing rejected; Assessment/Plan marked suggested; no direct chart write.

### BE-603 — Review State Machine (scribe-origin sign)
- States DRAFT→EDITED→SIGNED (+ADDENDUM). No auto-sign.
- Endpoints [DOCTOR]: PATCH /scribe/drafts/:id →EDITED n+1; POST /scribe/drafts/:id/sign-off `{finalSoap?}` →201 creates Encounter source SCRIBE + sets signedEncounterRef plain id (no FK) /409 signed /422 incomplete; append via EHR.
- Acceptance: Unsigned invisible; sign-once; SECRETARY 403.

### BE-604 — Consent & Audio Retention Lifecycle (NEW, P0)
- Objective: Withdraw locks + 30d purge deletes bytes + nulls refs + status PURGED + audits. Ownership: ai-scribe. Depends: BE-601..603.
- Endpoints [DOCTOR]: POST /scribe/sessions/:id/withdraw-consent `{reason?}` →200 WITHDRAWN + retentionUntil + audit CONSENT_WITHDRAWN (ids only); purge job (scheduled, uses retentionUntil) → nulls audioReference, deletes bytes, status PURGED where applicable + audit AUDIO_PURGED.
- Logic: Post-withdraw transcribe/synthesize/upload blocked (409/410). Transcript retention per policy (detached, never to SECRETARY). Legal-hold flag (if ever needed) would extend retentionUntil with doctor audit — default 30d.
- Acceptance: F-6 green: withdraw→blocked ops; TTL job purges bytes + nulls ref; SECRETARY never sees refs.

---

## EPIC 7: Audit & Supervision (RPS-2 operational-only + discrepancies)

### BE-701 — Immutable Audit (grant-protected + deduped)
- Entity AuditEvent (actor FK; role snapshot; extended action incl. REVERSAL/INVOICE_PAY/UNDO_COMPLETE/CONSENT_WITHDRAWN/AUDIO_PURGED/WRITE_OFF/IDEMPOTENT_REPLAY; entityType + entityId opaque NO FK; before/after operational allowlist ONLY; reason required for sensitive; requestId/idempotencyKey unique) + DB REVOKE.
- Endpoints: GET /audit [DOCTOR full; SECRETARY own operational, vault/scribe filtered] SecretSafe; supervision feeds under BE-702.
- Acceptance: Every sensitive mutation exactly one event with matching requestId; replay logs IDEMPOTENT_REPLAY without dup; vault/scribe content never in snapshots; direct UPDATE/DELETE as app role rejected.

### BE-702 — Supervision & Discrepancy Views (NEW, P0)
- Objective: Doctor oversight closing the loop on INV-1..10 + readiness. Ownership: audit-supervision + cashier-shift (BE-306). Depends: BE-306 + BE-701.
- Endpoints [DOCTOR]: GET /supervision/front-desk-activity?shiftId= (queue+cash feed); GET /supervision/cash-summary?shiftId= (summary + auditCoverage); GET /supervision/discrepancies?shiftId= →200 `{shiftId, invViolations:[{inv, detail, entities}], missingAudit:[...], staleQueue}`; GET /supervision/shift-readiness?shiftId= →200 `{canClose, blockers[], queueVersion, openEntries}`.
- WS: supervision.discrepancy → DOCTOR room only on new violation.
- Acceptance: Seeded INV violations appear with correct INV codes; missing audit blocks readiness; forced close still listed as forced discrepancy.

---

## Build Order (Official RPS-2 — Enforced)

BE-101 → 102 → 103 → 104 → 201 → 202 → 203 → 301 → 302 → 303 → 304 → 305 → 306 → 401 → 402 → 701 → 501 → 502 → 503 → 601 → 602 → 603 → 604 → 702 → hardening (F-1..F-10 + tripwires C-1..C-12 + INV-1..10 + canon-count check).

*End of RPS-2 WBS. Coding Agent: implement in this order. Do not reintroduce deleted patterns (mutable receipts, direct collected writes, operational→clinical relations, denylist sanitizer, fourth SQL statement).*
