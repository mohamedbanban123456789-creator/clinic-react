# API Contracts — REST + WebSocket (BE-101 through BE-702, RPS-2 Applied)

> **Status:** RPS-2 APPLIED. Where this file conflicts with pre-RPS-2 contracts, RPS-2 WINS. Old mutable-receipt, direct-collected-edit, and relation-join contracts are DELETED.
> Base URL `/api/v1`. Auth `Authorization: Bearer <accessJWT>` unless noted. Money integer minor units. Time ISO-8601 UTC. Pagination `?limit&cursor`.
> RBAC: [DOCTOR], [SECRETARY], [BOTH]. SECRETARY payloads are allowlisted `SecretSafe<T>` DTOs only — no clinical keys exist to leak.

## Part 0 — Idempotency Headers (Normative, RPS-2)

- Cash-critical POSTs REQUIRE `Idempotency-Key: <uuid-v4>` header: `POST /billing/checkout`, `POST /billing/invoices/:id/pay`, `POST /billing/receipts/:id/reverse`, `POST /billing/invoices/:id/write-off`, `POST /shifts/:id/petty`, `POST /shifts/:id/close`, `POST /queue/check-in`, `POST /intercom` with DOCTOR_COMPLIMENTARY.
- Scope is actor + shift/entity + key. Replay with same key returns ORIGINAL result with `Idempotent-Replayed: true` header + `IDEMPOTENT_REPLAY` audit, status 200 (not 201), zero duplicate rows.
- Missing key on required routes → 422 `IDEMPOTENCY_KEY_REQUIRED`. Reuse across different payload hash → 422 `IDEMPOTENCY_KEY_REUSE`.

Shared primitives:

```ts
type Role = 'DOCTOR' | 'SECRETARY';
type QueueStatus = 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'SKIPPED';
type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'COMPLIMENTARY' | 'WRITTEN_OFF';
type ReceiptType = 'CHARGE' | 'REVERSAL';
type ShiftResult = 'BALANCED' | 'SURPLUS' | 'DEFICIT';
type IntercomType = 'DOCTOR_COMPLIMENTARY' | 'DOCTOR_NEXT' | 'DOCTOR_FOLLOWUP' | 'SEC_DISRUPTION' | 'SEC_PHARMACY_LAB' | 'CUSTOM_TEXT';
type ScribeMode = 'AMBIENT_LIVE' | 'DICTATION_60S';
type MSEValue = string | 'NOT_PERFORMED'; // each selector explicit; missing rejected
type SecretSafe<T> = T & { readonly __secretSafe: unique symbol };
```

## RPS-2 API Amendments API-01..API-09 (applied below)

- API-01 Idempotency-Key mandatory (Part 0) + `Idempotent-Replayed` handling.
- API-02 Pay separation: `POST /billing/invoices/:id/pay` creates additional CHARGE; checkout never edited for collections.
- API-03 Reversal: `POST /billing/receipts/:id/reverse` creates REVERSAL (doctor-only financial reversal, requires reason, lockShift).
- API-04 Manual encounter: `POST /ehr/encounters` (source MANUAL, no queue required) + explicit `POST /ehr/encounters/:id/sign` split from PATCH.
- API-05 Consent lifecycle: `POST /scribe/sessions/:id/withdraw-consent` locks session; transcribe/synthesize blocked after; purge at 30d TTL.
- API-06 Undo-complete: `POST /queue/:entryId/undo-complete` COMPLETED→IN_CONSULTATION within window, doctor-only, audited, single hop.
- API-07 Concurrency: `If-Match: queueVersion` required on reorder/emergency; `lockShift` on all cash mutations (server-side, surfaced as 409 STALE_QUEUE / 409 SHIFT_LOCKED on contention); blind close two-phase.
- API-08 Discount floor: secretary below `secretaryMaxDiscountMinor/Pct` → 403 FLOOR_VIOLATION; write-off doctor-only separate endpoint.
- API-09 Supervision/discrepancy + versioned WS snapshots (queueVersion in every queue frame; shiftVersion/queueVersion echo).

---

## EPIC 1 — Foundation / Auth / Users / Settings

### GET /health — public — 200 `{ status: "ok" }`

### POST /api/v1/auth/login — public — `{ identifier, password }` → 200 + refresh cookie; 401; 403 deactivated.
### POST /api/v1/auth/refresh — cookie — 200 `{ accessToken }`; 401 reuse revokes family.
### POST /api/v1/auth/logout — [BOTH] — 200 `{ ok: true }`.
### GET /api/v1/auth/me — [BOTH] — 200 `{ id, name, role, lastLoginAt: string | null, passwordMustChange: boolean }`.
- `passwordMustChange` is ALWAYS present (explicit boolean). GET /auth/me is the canonical
  session-state source so the password-rotation gate survives browser reload / cold-boot
  session restoration; server-side enforcement stays fail-closed via `requireFreshPassword`
  (403 PASSWORD_CHANGE_REQUIRED on every non-/auth route until changed).
### POST /api/v1/users/secretaries — [DOCTOR] — `{ name, identifier, password }` → 201; 403; 409 duplicate; 422.
### GET /api/v1/users — [DOCTOR] — 200 list.
### PATCH /api/v1/users/:id/deactivate | /activate — [DOCTOR] — 200 `{ id, isActive }`.
### POST /api/v1/auth/change-password — [BOTH] — `{ oldPassword, newPassword }` → 200.
### GET /api/v1/settings — [BOTH] SecretSafe — 200 `{ standardFeeMinor, currency, avgConsultDurationMin, openingFloatMinor, secretaryMaxDiscountMinor, secretaryMaxDiscountPct, audioRetentionDays }` (RPS-2 floor + TTL visible to both; no secrets).

---

## EPIC 2 — Identity / Queue (RPS-2: idempotency + OCC + undo)

### GET /api/v1/patients/search?q= — [BOTH] SecretSafe — 200 `{ data: [{ id, fullName, phone: string|null, nationalId: string|null, emergencyContact: {name,phone,relation}, lastVisitAt: string|null, outstandingBalanceMinor, hasDebtAlert }] }`
### POST /api/v1/patients — [BOTH] — `{ fullName, age, phone?, nationalId?, emergencyContact:{name,phone,relation}, physicalAddress, adminNotes? (≤500 chars) }` → 201; 422; 409 with candidate.
### GET /api/v1/patients/:id — [BOTH] SecretSafe — identity + `pastVisitTimestamps: string[]` + outstanding. No clinical.
### PATCH /api/v1/patients/:id — [BOTH] — contact/address/adminNotes only → 200.

### POST /api/v1/queue/check-in — [BOTH] — Headers: Idempotency-Key REQUIRED.
- Request: `{ patientId: string; isEmergency?: boolean; emergencyReasonCode?: string }` (strict — no acknowledgement field exists; DEBT IS ADVISORY, Decision 1).
- Success 201: `{ entryId, status:"WAITING", position, estimatedWaitMin, queueVersion, debtAlert: { outstandingMinor, oldestInvoiceDate } | null }`
- Debt flow (advisory-only, Decision 1): outstanding debt NEVER blocks check-in and NEVER
  requires acknowledgement. The entry is always created; `debtAlert` is an informational
  warning (Σ outstanding over UNPAID/PARTIAL + oldest invoice date).
  `POST /queue/:entryId/debt-ack` remains an OPTIONAL advisory record (who acknowledged,
  audit CHECKIN_DEBT_ACK) — never a precondition for any clinical workflow.
- Errors: 422; 404; 409 duplicate open entry (uq_queue_one_open_per_patient) with existing entryId.

### GET /api/v1/queue?shiftId=&status= — [BOTH] SecretSafe — 200 `{ queueVersion, data: [{ entryId, patientId, displayName, status, position, isEmergency, checkedInAt, estimatedWaitMin }] }`

### POST /api/v1/queue/:entryId/call-next — [DOCTOR] — `{ force?: boolean }` → 200 entry + queueVersion. 409 single-consult (uq_queue_single_consult) unless force+doctor+audit. 400 illegal transition.

### POST /api/v1/queue/:entryId/skip — [DOCTOR] — 200 SKIPPED + queueVersion. Audit QUEUE_SKIP.
### POST /api/v1/queue/:entryId/requeue — [BOTH] — 200 WAITING reinserted + queueVersion.
### POST /api/v1/queue/:entryId/complete — [DOCTOR] — 200 COMPLETED + queueVersion. 400 if not IN_CONSULTATION.
- Decision 2 (INV-5): the SAME transaction atomically creates the patient's UNPAID invoice
  shell when none exists — `source:"COMPLETION_AUTO"`, deterministic idempotency key
  `completion:{entryId}`, `standardFeeMinor` snapshot from clinic settings via the SAME
  `loadClinicFees` rules as checkout (finalFee = standard, discount 0, collected 0; NO
  financial value is invented). A non-positive/missing fee is a clear 422 FEE_NOT_CONFIGURED
  failure — never a fabricated invoice. Re-checkout (POST /billing/checkout) reuses this
  invoice; retries / double-submits / undo→re-complete reuse it too (exactly-one-invoice-
  per-COMPLETED-entry holds, so shift-close INV-5 cannot trip). The QUEUE_COMPLETE audit's
  afterState records `{invoiceId, invoiceCreated}`.

### POST /api/v1/queue/:entryId/undo-complete — [DOCTOR] (RPS-2 API-06, NEW)
- Purpose: NORMAL reversal of a premature completion (Decision 3) — NOT a visit cancellation.
  Single hop COMPLETED→IN_CONSULTATION within undoWindow (~15 min); the encounter/audit trail
  stays; `calledAt` and queue `position` are preserved.
- Request: `{ reason: string (non-blank, ≤300); lastSeenQueueVersion?: number }` — strict.
  Headers: Idempotency-Key REQUIRED (enforced by idempotency middleware: identical replays
  return the cached 200 with `Idempotent-Replayed: true`; key reuse with a different payload
  is 409 IDEMPOTENCY_KEY_CONFLICT).
- Guards: window (400 UNDO_WINDOW_EXPIRED); no linked SIGNED encounter (409 UNDO_BLOCKED);
  linked invoice must be UNPAID with zero receipts (409 UNDO_BLOCKED — no money has moved);
  single-consultation partial unique is the race authority (409 ACTIVE_CONSULTATION_EXISTS if
  another consultation is active). OCC: `lastSeenQueueVersion` when present is re-checked
  under the shift lock (409 STALE_QUEUE).
- Success 200 entry IN_CONSULTATION + queueVersion. Audit QUEUE_COMPLETE_UNDO with
  `{status, position, retainedInvoiceId}` + reasonText. The invoice is NEVER deleted
  (zero-hard-delete): re-completion reuses it. Errors: 400 window expired; 403 SECRETARY;
  404; 409 stale/blocked/active-consult.

### POST /api/v1/queue/reorder — [BOTH] WAITING only — Headers: `If-Match: <queueVersion>` REQUIRED + Idempotency-Key REQUIRED.
- Request: `{ orderedEntryIds: string[]; expectedQueueVersion: number }` (header and body must match).
- Success 200 `{ queueVersion: n+1, order: string[], waitTimes }`. Errors: 422 includes non-WAITING / burying emergency; 409 STALE_QUEUE with current snapshot.

### POST /api/v1/queue/:entryId/emergency — [BOTH] — Headers: If-Match queueVersion + Idempotency-Key.
- Request: `{ isEmergency: boolean; reason?: string }` reason required when true, and required on unflag. Success 200 entry position 0 + queueVersion. Audit EMERGENCY_FLAG/UNFLAG.

### GET /api/v1/queue/wait-times?shiftId= — [BOTH] — 200 `{ avgConsultDurationMin, queueVersion, items: [{entryId, precedingCount, estimatedWaitMin}] }`

---

## EPIC 3 — Cashier / Shift (RPS-2: CHARGE/REVERSAL, pay split, floor, blind close)

### POST /api/v1/billing/checkout — [BOTH] — Headers: Idempotency-Key REQUIRED. Runs in lockShift.
- Request: `{ queueEntryId: string; collectedMinor: number; finalFeeMinor?: number; discountReason?: string; method?: "CASH"|"OTHER" }`
- Creates Invoice (once, unique queueEntryId) + initial CHARGE Receipt. collectedMinor derived, never directly patched.
- Success 201: `{ invoiceId, receiptId, receiptType:"CHARGE", status, finalFeeMinor, collectedMinor, outstandingMinor, queueVersion? }`
- Errors: 422 missing discountReason when final<standard (non-complimentary); 403 FLOOR_VIOLATION when SECRETARY breaches floor (DB-09); 404 entry; 409 already invoiced (return existing + Idempotent-Replayed where applicable); 409 SHIFT_LOCKED on contention.

### POST /api/v1/billing/complimentary — [DOCTOR] — Headers: Idempotency-Key REQUIRED. lockShift.
- Request: `{ queueEntryId: string; note?: string }` → 201 COMPLIMENTARY invoice (final 0, authorizedBy doctor) + zero CHARGE receipt. 403 SECRETARY.

### POST /api/v1/billing/invoices/:id/pay — [BOTH] (RPS-2 API-02, NEW — debt-settlement fix)
- Purpose: collect against existing UNPAID/PARTIAL invoice (including return-visit debt). Never changes finalFee. Creates additional CHARGE receipt. Fixes uncollectible-debt flaw (pay down over multiple visits).
- Headers: Idempotency-Key REQUIRED. lockShift.
- Request: `{ collectedMinor: number (>0); method?: "CASH"|"OTHER" }`
- Success 201: `{ invoiceId, receiptId, receiptType:"CHARGE", status, collectedMinor, outstandingMinor }`
- Errors: 400 invoice PAID/COMPLIMENTARY/WRITTEN_OFF (nothing due); 404; 422 amount ≤0.

### POST /api/v1/billing/receipts/:id/reverse — [DOCTOR] (RPS-2 API-03, NEW)
- Purpose: correct erroneous CHARGE. Creates REVERSAL linked via reversalOfReceiptId plain id. Original CHARGE retained.
- Headers: Idempotency-Key REQUIRED. lockShift.
- Request: `{ reason: string }` required non-blank.
- Success 201: `{ reversalReceiptId, receiptType:"REVERSAL", invoiceId, amountMinor, outstandingMinor }`
- Errors: 403 SECRETARY (financial reversal doctor-only); 400 already reversed; 422 missing reason.

### POST /api/v1/billing/invoices/:id/write-off — [DOCTOR] (RPS-2 DB-17)
- Request: `{ writeOffMinor: number (>0); writeOffReason: string }` required. lockShift.
- Success 200: `{ invoiceId, status, writeOffMinor, outstandingMinor }`. Outstanding excludes write-off. Audit WRITE_OFF.

### GET /api/v1/billing?shiftId=&patientId= — [BOTH] SecretSafe financial — 200 list `{ invoiceId, patientId, queueEntryId, standardFeeMinor, finalFeeMinor, discountMinor, discountReason:null|string, status, collectedMinor, writeOffMinor, outstandingMinor }`
### GET /api/v1/patients/:id/balance — [BOTH] — 200 `{ outstandingMinor, lines:[{invoiceId,date,dueMinor,collectedMinor,writeOffMinor}] }`
### GET /api/v1/receipts?patientId=&shiftId= and GET /api/v1/receipts/:id — [BOTH] SecretSafe — 200 `{ receiptId, invoiceId, type:ReceiptType, amountMinor, method, reversalOfReceiptId:string|null, reason:string|null, createdAt }`. No update/delete (DB REVOKE).

### POST /api/v1/shifts/open — [BOTH] — `{ openingFloatMinor?, businessDate? }` → 201 OPEN. 409 one OPEN per date.
### POST /api/v1/shifts/:id/petty — [BOTH] — Headers: Idempotency-Key REQUIRED. lockShift. `{ amountMinor>0, purpose }` → 201. 422 empty; 400 CLOSED.
### GET /api/v1/shifts/:id/petty — [BOTH] — 200 list.

### POST /api/v1/shifts/:id/close — [BOTH] — Headers: Idempotency-Key REQUIRED. lockShift. Blind two-phase (RPS-2 DB-10/API-07).
- Request: `{ actualCountedMinor: number }` (submitter has NOT seen expected).
- Success 200: `{ shiftId, status:"CLOSED", expectedCashMinor, actualCountedMinor, differenceMinor, result, queueVersion }` (expected revealed ONLY here, after persist).
- Errors: 422 open WAITING/IN_CONSULTATION entries remain unless force+doctor+audit (INV-10 audit coverage checked); 400 already CLOSED; 409 SHIFT_LOCKED; 409 INVARIANT_VIOLATION with `discrepancies[]` (BE-306) blocking close until resolved or doctor-forced with reason.

### GET /api/v1/shifts/:id/summary — [BOTH] SecretSafe operational (pre-close hides expected from closer; post-close full) — 200 `{ shiftId, totalServed, grossCollectedMinor, pettyTotalMinor, pettyItems[], netTotalMinor, discountTotalMinor, discountCount, newDebtTotalMinor, writeOffTotalMinor, complimentaryCount, reversalCount, result:null|ShiftResult, differenceMinor:null|number, queueVersion }`

---

## EPIC 4 — Intercom REST (WS below)

### GET /api/v1/intercom?limit&cursor — [BOTH] SecretSafe — 200 list `{ id, fromRole, type:IntercomType, text:null|string, relatedQueueEntryId:null|string, createdAt }`
### POST /api/v1/intercom — [BOTH] type-ownership — Headers: Idempotency-Key REQUIRED when type DOCTOR_COMPLIMENTARY.
- Request: `{ type:IntercomType; text?: string; relatedQueueEntryId?: string; followUp?: { followUpType: "GENERAL"; window: "NEXT_VISIT" } }`
  CUSTOM_TEXT requires non-blank text (capped). `followUp` is REQUIRED iff type = DOCTOR_FOLLOWUP
  and uses the CANONICAL vocabulary (Decision 5): closed enums — extension requires schema +
  validator + DTO + UI change. DOCTOR_FOLLOWUP creates one FollowUpTask in the SAME transaction
  (status REQUESTED); the patient resolves from `relatedQueueEntryId`; the doctor's `text` is
  preserved verbatim as the task's note (the actionable instruction).
  Errors: 403 forging; 422 empty CUSTOM_TEXT / missing or non-canonical followUp / missing relatedQueueEntryId.
### GET /api/v1/followups?patientId=&status= — [BOTH] — 200 list.
- Rows: `{ id, patientId, requestedByUserId, note, followUpType:"GENERAL", window:"NEXT_VISIT",
  status: "REQUESTED"|"SCHEDULED"|"DONE"|"CANCELLED", sourceMessageId, requestedAt, resolvedAt }`.

### PATCH /api/v1/followups/:id — [BOTH] — `{ status }` → 200 updated row.
- Canonical status machine (Decision 5): REQUESTED → SCHEDULED|DONE|CANCELLED;
  SCHEDULED → DONE|CANCELLED; DONE/CANCELLED are TERMINAL (400 ILLEGAL_TRANSITION).
  Role matrix: SECRETARY sets SCHEDULED|DONE; DOCTOR sets CANCELLED (403 otherwise).
  Audit action FOLLOWUP_UPDATE (FOLLOWUP_CREATE on creation). UI labels are human words
  ("Requested/Scheduled/Done/Cancelled", "General follow-up · Next visit"); internal enum
  values never render to users.

---

## EPIC 5 — EHR / Vault (Doctor Exclusive, RPS-2 manual path + NOT_PERFORMED)

All [DOCTOR]. SECRETARY → 403. No SecretSafe variant exists.

### POST /api/v1/ehr/encounters — [DOCTOR] (RPS-2 API-04, NEW — manual-encounter fix)
- Independent path, NO queue required. `source: MANUAL`.
- Request: `{ patientId: string; queueEntryRef?: string|null (plain id, no FK); source?: "MANUAL" (default); soap?: {S?,O?,A?,P?} (draft may be partial); mse: { appearance:MSEValue; behavior:MSEValue; speechCoherence:MSEValue; moodAffect:MSEValue } (each explicit incl. NOT_PERFORMED, missing rejected); diagnoses?: string[] }`
- Success 201: `{ encounterId, status:"DRAFT", source:"MANUAL" }`. Errors: 422 MSE missing (not NOT_PERFORMED confusion); 404 patient.

### GET /api/v1/ehr/patients/:id/chart?limit&cursor — [DOCTOR] — 200 SIGNED-only desc `{ patientId, encounters:[{encounterId, source, signedAt, diagnoses, soap:{S,O,A,P}, mse:{appearance,behavior,speechCoherence,moodAffect}}] }`
### GET /api/v1/ehr/encounters/:id — [DOCTOR] — 200 full (incl. queueEntryRef plain, originScribeDraftRef plain, addendumCount).
### PATCH /api/v1/ehr/encounters/:id — [DOCTOR] draft-only — partial soap/mse/diagnoses → 200 EDITED DRAFT. 400 SIGNED (use append); 422 MSE missing.
### POST /api/v1/ehr/encounters/:id/sign — [DOCTOR] (RPS-2 API-04 split, NEW — explicit sign)
- Request: `{ finalSoap?: {S,O,A,P} }` (optional if draft already complete). Validates complete SOAP + explicit MSE (NOT_PERFORMED allowed).
- Success 200: `{ encounterId, status:"SIGNED", signedAt }`. Errors: 409 already SIGNED; 422 incomplete.
### POST /api/v1/ehr/encounters/:id/append — [DOCTOR] — `{ addendumText }` → 201 versioned. Original preserved.
### POST /api/v1/ehr/patients/:id/medications — [DOCTOR] — `{ drugName, dosage, frequency, instructions, encounterRef?: string|null (plain, no FK) }` → 201 ACTIVE. 422 missing.
### POST /api/v1/ehr/medications/:id/discontinue — [DOCTOR] — `{ cessationReason }` required → 200 DISCONTINUED + stoppedAt. 422 missing; 400 already.
### GET /api/v1/ehr/patients/:id/medications?status= — [DOCTOR] — 200 list.
### POST /api/v1/ehr/vault/patients/:id/notes — [DOCTOR] segregated — `{ content }` → 201 `{ noteId, createdAt, keyId }` (ciphertext at rest, never echoed). 422 empty.
### GET /api/v1/ehr/vault/patients/:id/notes — [DOCTOR] — 200 decrypted in memory.

Scribe-origin encounters are created exclusively by the Gen-2 commit (EPIC 6) — the legacy
Gen-1 `POST /scribe/drafts/:id/sign-off` route does NOT exist.

---

## EPIC 6 — AI Scribe (Doctor Exclusive, RPS-2 consent + purge)

GEN-2 IS THE CANONICAL AND ONLY WORKFLOW (Decision 4): consent → session → cycle-1 →
cycle-2 → review → commit (+ purge-audio / withdraw-consent). The earlier "Gen-1"
draft/audio/stop/transcribe/sign-off endpoints NEVER existed in the backend and their
client fallbacks were removed. Typed dictation in the studio is a client-side editing
affordance ONLY — it is never transmitted; the server analyzes spoken dictation audio.
Audio travels INLINE as base64 JSON. Coherent size budget (R7): raw recording ≤11 MB
(frontend gate) → ≤14,666,668 base64 chars, inside the authoritative validator cap of
15,000,000 chars (422) and the 15mb scribe body-parser limit (413) with envelope headroom.

### POST /api/v1/scribe/sessions — [DOCTOR] — `{ patientId, queueEntryId?, mode:"AMBIENT_LIVE"|"DICTATION_60S" (default AMBIENT_LIVE), consentConfirmed?: boolean }` → 201 `{ sessionId, status:"UPLOADED", mode, consentStatus:"GRANTED", audioRetentionUntil }` (FULL canonical session shape — clients hydrate consent + retention from the create response alone). 422 CONSENT_REQUIRED when AMBIENT_LIVE without consentConfirmed:true (DICTATION_60S exempt).

### POST /api/v1/scribe/sessions/:id/cycle-1-consultation — [DOCTOR] — `{ audioBase64, mimeType? }` strict → 200 `{ sessionId, analysis: { chiefComplaint, symptoms[], moodAffect, suggestions: [{ text, provenance:"AI" }] } }` (canonical wire name `moodAffect`; the Gemini provider's internal `moodAndAffect` key is normalized once in the service layer and never leaks). Session → TRANSCRIBING; ScribeDraft v(n+1) persisted. 409 if COMMITTED; 403 WITHDRAWN_GONE / 410 GONE if locked; 500 GEMINI_KEY_MISSING / 422 non-JSON / 504 GEMINI_TIMEOUT.

### POST /api/v1/scribe/sessions/:id/cycle-2-doctor-decision — [DOCTOR] — `{ audioBase64, mimeType? }` strict → 200 `{ sessionId, soap:{S,O,A,P}, prescriptions[], finalDiagnosis }`. Requires cycle-1 first (422 UNPROCESSABLE). Session → TRANSCRIBED; draft v(n+1).

### POST /api/v1/scribe/sessions/:id/commit — [DOCTOR] — `{ soap:{S,O,A,P} (each 1..10000), mse?: { appearance|behavior|speechCoherence|moodAffect: MSEValue (explicit finding or NOT_PERFORMED) }, prescriptions? (≤30), diagnoses? (≤20) }` strict → 200 `{ encounterId, status:"COMMITTED" }`. ONE transaction claims the session with a conditional status UPDATE (TRANSCRIBING|TRANSCRIBED → COMMITTED), then creates Encounter (source SCRIBE, SIGNED, finalContentHash, originScribeDraftRef = session id) + Medication rows. Race authority is DB-backed twice: the conditional claim (loser gets a precise conflict) and the UNIQUE index on `encounters.origin_scribe_draft_ref` (migration 0012) — at most one signed encounter per session, and a commit racing a successful withdrawal can never create an encounter. The doctor's explicit MSE findings land on the encounter; an omitted mse records NOT_PERFORMED for every domain (exam matrix skipped — never invented). 409 double-commit / withdrawn-claim; 410 GONE if purged; 422 before cycle-1.

### POST /api/v1/scribe/sessions/:id/purge-audio — [DOCTOR] — deletes audio bytes, keeps records → 200 `{ sessionId, purged:true, status }`. Audit AUDIO_PURGED.

### POST /api/v1/scribe/sessions/:id/withdraw-consent — [DOCTOR] (RPS-2 API-05, NEW)
- Request: `{ reason?: string }` optional note (operational, no clinical).
- Success 200: `{ sessionId, status:"WITHDRAWN", withdrawnAt, retentionUntil, audioPurged: true }`. Purges stored audio and flips the session WITHDRAWN via a conditional status UPDATE (atomic against a racing commit — a commit can never create an encounter after a successful withdrawal). Locks cycles/commit (403 WITHDRAWN_GONE / 410 GONE if purged). Audit CONSENT_WITHDRAWN (ids only).
- Errors: 409 CONFLICT on repeat (already WITHDRAWN/PURGED — the frontend converges on 409); 404.
- Retention worker (no route): deletes ciphertext past `audioRetentionUntil` (30d default); in-flight sessions → PURGED (conditional flip), COMMITTED stays.

---

## EPIC 7 — Audit / Supervision (RPS-2: discrepancy views)

### GET /api/v1/audit?shiftId=&actorId=&action=&limit&cursor — [DOCTOR] full; [SECRETARY] own operational only, vault/scribe rows filtered — 200 allowlisted list (operational structs only).
### GET /api/v1/supervision/front-desk-activity?shiftId= — [DOCTOR] — 200 queue+cash feed.
### GET /api/v1/supervision/cash-summary?shiftId= — [DOCTOR] — shift summary + auditCoverage.
### GET /api/v1/supervision/discrepancies?shiftId= — [DOCTOR] (RPS-2 BE-702, NEW) — 200 `{ shiftId, invViolations: [{inv:"INV-1", detail, entities}], missingAudit: [...], staleQueue: boolean }` backing INV-1..10 gate on close.
### GET /api/v1/supervision/shift-readiness?shiftId= — [DOCTOR] (NEW) — 200 `{ canClose: boolean, blockers: string[], queueVersion, openEntries }`.

---

## WebSocket Contract (Socket.io, RPS-2 versioned snapshots)

### Handshake — `auth:{token}` JWT. Invalid → connect_error 401. Deactivated → 403. Joins clinic:queue + clinic:intercom by role. Reconnect replays queue.updated snapshot.
### Rooms — clinic:queue (both, SecretSafe frames), clinic:intercom (both, operational only).

### Server→Client (all include versioning)
- `queue.updated`: `{ queueVersion:number, shiftId:string, avgConsultDurationMin:number, serverAt:string, entries:[{entryId,patientId,displayName,status,position,isEmergency,checkedInAt,estimatedWaitMin}] }`
- `queue.called`: `{ queueVersion, entryId, patientId, displayName, calledAt }`
- `queue.reordered`: `{ queueVersion, orderedEntryIds:string[], actorId, serverAt }`
- `queue.emergency`: `{ queueVersion, entryId, isEmergency, position, serverAt }`
- `queue.undoComplete`: `{ queueVersion, entryId, status:"IN_CONSULTATION", serverAt }` (NEW)
- `billing.invoiceUpdated`: `{ shiftId, invoiceId, status, collectedMinor, outstandingMinor, serverAt }` (financial totals only, NEW — SecretSafe)
- `intercom.received`: `{ id, fromRole, type:IntercomType, text:null|string, relatedQueueEntryId:null|string, createdAt }`
- `supervision.discrepancy`: `{ shiftId, inv:string, detail:string, serverAt }` ([DOCTOR] room only, NEW)

### Client→Server
- `intercom.send`: `{ type:IntercomType; text?:string; relatedQueueEntryId?:string|null; idempotencyKey?:string (required iff DOCTOR_COMPLIMENTARY) }` Zod-validated, type-ownership enforced. Forging → FORBIDDEN error frame, no broadcast. DOCTOR_COMPLIMENTARY executes idempotent complimentary + emits billing.invoiceUpdated + audit.
- `queue.subscribe`: `{ shiftId }` join + immediate snapshot. `queue.reorder` via REST only (OCC header required) — no WS reorder to avoid version races.

*End of RPS-2 contracts. New endpoints/events require RBAC tag, Zod schema, idempotency note, SecretSafe note, and tripwire test before merge.*
