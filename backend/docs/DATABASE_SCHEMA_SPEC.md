# Architectural Data Model Specification — Psychiatric Practice Management System

> **Target:** PostgreSQL-targeted logical model — RPS-2 Lean Edition
> **Status:** APPROVED — RPS-2 APPLIED
> **Companion:** `docs/BACKEND_TASKS_WBS.md` (BE-101 through BE-702, RPS-2 build order), `docs/API_CONTRACTS.md` (RPS-2), `docs/PROJECT_CONVENTIONS.md` (RPS-2)
> **Precedence:** Where this file conflicts with pre-RPS-2 text, RPS-2 WINS. Old relational text (operational→clinical Prisma relations, naive denylist sanitizer, mutable receipts, direct collected edits) is DELETED and replaced below.
> **Note:** Appendix A (§14) is the sole authorized executable SQL in this repo (exactly 3 canon statements). All other sections remain logical specification.

---

## §0. RPS-2 Amendment Register (Normative)

### Part 0 — Enum Extensions (P0)
- ReceiptType: CHARGE, REVERSAL (replaces implicit mutable receipt).
- ConsentStatus: GRANTED, WITHDRAWN.
- EncounterSource: MANUAL, SCRIBE.
- MSE selector value set: each of appearance / behavior / speechCoherence / moodAffect supports its clinical values PLUS NOT_PERFORMED (explicit skip, never null-implicit).
- ScribeSessionStatus extended: UPLOADED, TRANSCRIBING, TRANSCRIBED, FAILED, WITHDRAWN, PURGED.
- ScribeDraftStatus unchanged: DRAFT, EDITED, SIGNED, SUPERSEDED.
- AuditAction extended: adds REVERSAL, INVOICE_PAY, UNDO_COMPLETE, CONSENT_WITHDRAWN, AUDIO_PURGED, WRITE_OFF, IDEMPOTENT_REPLAY.
- Shift close result unchanged but blind-count procedure applies.

### Part 1 — DB Amendments DB-01..DB-19 (all P0, all applied below)
- DB-01 Single Prisma client, single schema file. One client instance shared via common persistence accessor. No per-module clients.
- DB-02 Sever ALL operational→clinical relations. No Prisma relation fields from QueueEntry, Invoice, Receipt, IntercomMessage, FollowUpTask, AuditEvent to Encounter, Medication, TherapyNote, ScribeSession, ScribeDraft. Replace with plain indexed UUID/string reference columns (e.g. clinicalEncounterRef, encounterRef) with NO foreign-key constraint and NO join. Reverse direction also severed except Patient FK (identity hub, allowed). Encounter.queueEntryRef becomes plain string, not FK.
- DB-03 Partial unique uq_queue_single_consult (one IN_CONSULTATION per shift) — see Appendix A.
- DB-04 Partial unique uq_queue_one_open_per_patient (one open WAITING/IN_CONSULTATION/SKIPPED entry per patient per shift) — see Appendix A.
- DB-05 Runtime grant immutability: REVOKE UPDATE, DELETE on receipts and audit_events from app role — see Appendix A. Application enforces immutability; DB enforces it even on bug.
- DB-06 Receipt types CHARGE/REVERSAL + reversalOfReceiptId self-reference (plain id, no FK cascade) + immutable. Corrections only via REVERSAL (doctor-only for financial reversals).
- DB-07 Invoice pay-down separation: checkout creates Invoice + initial CHARGE receipt; later collections via pay endpoint creating additional CHARGE receipts; Invoice.collectedMinor is derived sum, never directly written.
- DB-08 Idempotency keys: idempotencyKey text on Invoice creation, Receipt, PettyExpense, Shift-close attempt. Unique per scope (actor + shift + key). Replay returns original without duplicate side effects.
- DB-09 Secretary discount floor: ClinicSettings.secretaryMaxDiscountMinor and secretaryMaxDiscountPct. Secretary final below floor → reject, doctor required.
- DB-10 Blind drawer counts: Shift.expectedCashMinor computed server-side but WITHHELD from close submitter until actualCountedMinor persisted; two-phase reveal prevents anchoring.
- DB-11 lockShift(tx, shiftId) row lock (SELECT FOR UPDATE on shifts row) required on ALL cash-critical mutations: checkout, pay, reverse, petty, close.
- DB-12 queueVersion optimistic locking: Shift.queueVersion integer increments on every queue mutation (check-in, call, skip, requeue, complete, undo-complete, reorder, emergency). Reorder/emergency mutations require expected queueVersion, else 409 STALE.
- DB-13 Manual encounter path: Encounter.source MANUAL|SCRIBE, queueEntryRef plain string nullable (no FK), patientId FK retained. Encounters may exist with no queue entry (phone follow-up, chart correction, scribe-independent note).
- DB-14 MSE NOT_PERFORMED: each MSE attribute is discrete selector text supporting NOT_PERFORMED as explicit value. Missing/empty rejected; explicit NOT_PERFORMED accepted and surfaced in Objective as not performed.
- DB-15 Consent lifecycle: ScribeSession.consentStatus GRANTED|WITHDRAWN + consentedAt + withdrawnAt + withdrawalReason. Withdraw locks session (no further transcribe/synthesize), marks status WITHDRAWN.
- DB-16 Audio retention purge TTL 30 days: ScribeSession.audioRetentionUntil timestamp + audioReference nullable (nulled after purge) + transcriptReference retention flag. Purge job nulls audio ref and deletes bytes; status PURGED when both purged and withdrawn/expired.
- DB-17 Debt collectibility: Invoice.writeOffMinor + writeOffReason (doctor-only) for uncollectible debt. Outstanding excludes write-off. Distinct from discount (discount at creation, write-off after).
- DB-18 Allowlist DTO support: schema shaped so SecretSafe views are trivially constructible without joins (no clinical FKs to accidentally include). Patient.adminNotes length-capped operational-only.
- DB-19 Audit operational-only + deduplication: AuditEvent.requestId/idempotencyKey unique per actor+action+entity; before/after are allowlisted operational structs only.

---

## 1. Global Conventions (RPS-2 Revised)

### 1.1 Identity and Time
- Every entity has system-generated unique identifier PK (`id`, UUID-string logical type).
- All timestamps timezone-aware UTC, ISO-8601 on wire. `createdAt` immutable. Lifecycle timestamps nullable until reached.
- Shift businessDate is calendar date, unique per day.

### 1.2 Money
- Integer minor units only. Never float. Non-negative. Currency code in ClinicSettings only.

### 1.3 Nullability
- Required = reject if absent. Nullable = legitimately absent until event. Empty string never satisfies required justification.

### 1.4 One-Way Integrity — RPS-2 Lean Rule (replaces old §1.4)
- Patient is the ONLY permitted FK hub into clinical tables (Patient 1:N Encounter/Medication/TherapyNote/ScribeSession).
- NO operational model holds a Prisma relation to a clinical model. Where correlation is needed (e.g. invoice for a visit that later got an encounter, intercom referencing a visit, audit referencing an encounter), store a PLAIN indexed UUID/string column (e.g. `clinicalEncounterRef`, `queueEntryRef`, `entityId`) with NO foreign-key constraint, NO cascade, NO Prisma include. Joins across the boundary are FORBIDDEN in code; correlation is by explicit second query under DOCTOR auth only.
- Audit entity refs are opaque type+id text, never FKs.

### 1.5 Zero Hard-Deletes + Grant Immutability
- No hard deletes for Patient, User (referenced), Shift (esp. CLOSED), QueueEntry, Invoice, Receipt, PettyExpense, Encounter, Medication, TherapyNote, ScribeSession, ScribeDraft, AuditEvent.
- Receipts and audit_events are additionally protected by DB REVOKE (Appendix A). Application has no update/delete path; corrections via new rows (REVERSAL, addendum, write-off).
- Only RefreshTokenFamily purge and audio-bytes purge (not relational rows) may delete.

### 1.6 Derivation + Concurrency
- Derived caches (discountMinor, collectedMinor, outstandingBalanceMinor, expectedCashMinor, differenceMinor) recomputed inside `lockShift` transaction. Source rows are truth.
- Cash mutations MUST run in transaction holding `lockShift(tx, shiftId)`.
- Queue order mutations MUST check `queueVersion` (OCC). Mismatch → 409 STALE_QUEUE, client refetches snapshot.

### 1.7 Single Client
- Single Prisma client instance, single schema file (DB-01). Modules import the shared accessor; per-module clients or second schema files are forbidden and fail CI tripwire.

---

## 2. Enum Definitions (RPS-2 Canon)

- UserRole: DOCTOR, SECRETARY
- QueueStatus: WAITING, IN_CONSULTATION, COMPLETED, SKIPPED
- ShiftStatus: OPEN, CLOSED
- ShiftResult: BALANCED, SURPLUS, DEFICIT (null until close)
- InvoiceStatus: UNPAID, PARTIAL, PAID, COMPLIMENTARY, WRITTEN_OFF (partially, when writeOff covers remainder)
- PaymentMethod: CASH, OTHER
- ReceiptType: CHARGE, REVERSAL
- IntercomMessageType: DOCTOR_COMPLIMENTARY, DOCTOR_NEXT, DOCTOR_FOLLOWUP, SEC_DISRUPTION, SEC_PHARMACY_LAB, CUSTOM_TEXT
- FollowUpTaskStatus: REQUESTED, SCHEDULED, DONE, CANCELLED (CANCELLED = doctor-set terminal; canonical machine REQUESTED→SCHEDULED|DONE|CANCELLED, SCHEDULED→DONE|CANCELLED — Decision 5)
- FollowUpTask descriptor columns (migration 0011): follow_up_type TEXT NOT NULL DEFAULT 'GENERAL', follow_up_window TEXT NOT NULL DEFAULT 'NEXT_VISIT' (canonical closed vocabulary; see intercom.validators.ts)
- EncounterStatus: DRAFT, SIGNED
- EncounterSource: MANUAL, SCRIBE
- MedicationStatus: ACTIVE, DISCONTINUED
- ScribeMode: AMBIENT_LIVE, DICTATION_60S
- ScribeSessionStatus: UPLOADED, TRANSCRIBING, TRANSCRIBED, FAILED, WITHDRAWN, PURGED
- ScribeDraftStatus: DRAFT, EDITED, SIGNED, SUPERSEDED
- ConsentStatus: GRANTED, WITHDRAWN
- MSE value: clinical selector values PLUS NOT_PERFORMED (explicit, per selector)
- AuditAction (canonical, prisma/schema.prisma enum): LOGIN, LOGIN_LOCKOUT, LOGOUT, REFRESH, USER_CREATE, USER_DEACTIVATE, USER_ACTIVATE, PASSWORD_CHANGE, PATIENT_CREATE, PATIENT_UPDATE, PATIENT_SEARCH, PATIENT_FLAGGED_DUPLICATE, QUEUE_CHECKIN, QUEUE_CALL, QUEUE_SKIP, QUEUE_REQUEUE, QUEUE_COMPLETE, QUEUE_COMPLETE_UNDO (alias QUEUE_UNDO_COMPLETE recognized), QUEUE_OUT_OF_ORDER_CALL, QUEUE_NO_SHOW, QUEUE_ABANDON, FORCED_CALLNEXT, CHECKIN_DEBT_ACK, QUEUE_REORDER, EMERGENCY_FLAG, EMERGENCY_UNFLAG, CHECKOUT, INVOICE_PAY, INVOICE_WRITE_OFF, COMPLIMENTARY, WRITE_OFF, REVERSAL, PETTY_CREATE, SHIFT_OPEN, SHIFT_CLOSE, INTERCOM_SEND, FOLLOWUP_CREATE, FOLLOWUP_UPDATE (migration 0011), ENCOUNTER_CREATE, ENCOUNTER_UPDATE, ENCOUNTER_SIGN, ENCOUNTER_DISCARD, ENCOUNTER_ADDENDUM, CHART_READ, MEDICATION_CREATE, MEDICATION_DISCONTINUE, MEDICATION_ADJUST, VAULT_ACCESS, SCRIBE_UPLOAD, SCRIBE_TRANSCRIBE, CONSENT_WITHDRAWN, AUDIO_PURGED, IDEMPOTENT_REPLAY, FLOOR_VIOLATION, DISCREPANCY_FLAG, DISCOUNT_FLOOR_BLOCKED, RECEIPT_REVERSAL, SHIFT_ACK, INTEGRITY_CHECK_FAILED

---

## 3. Domain 1 — Global Configuration

### Entity 3.1 ClinicSettings (singleton)
- Attributes: id (required); standardFeeMinor (integer >=0, required); currencyCode (short text, required); avgConsultDurationMin (integer 5..120, required); openingFloatMinor (integer >=0, required); secretaryMaxDiscountMinor (integer >=0, required, RPS-2 DB-09 — absolute floor); secretaryMaxDiscountPct (integer 0..100, required — percent floor, tighter of the two wins); audioRetentionDays (integer, default 30, required, DB-16); queueVersionSeed (integer default 0, informational); updatedByUserId (User ref nullable); updatedAt (required); idempotencyScopeNote (text informational).
- Relationships: No physical FKs in/out. Referenced logically by billing (fee + floor) and queue (avg duration).
- Constraints: Single-row invariant. secretaryMaxDiscountPct 0..100. audioRetentionDays fixed 30 unless policy change with audit.
- Indexes: PK only, cached in memory.
- Privacy: Read [BOTH], write [DOCTOR].

---

## 4. Domain 2 — Identity and Access

### Entity 4.1 User
- Attributes: id; displayName (text required); loginIdentifier (text required, unique case-insensitive); passwordHash (opaque, never returned); role (UserRole); isActive (boolean default true); createdByUserId (self-ref nullable); createdAt; lastLoginAt (nullable).
- Relationships: User 1:N created Users. On-Delete: Restrict. Referenced by openedBy/closedBy/actor/prescribedBy/signedBy (all Restrict, FK allowed — User is governance hub, not clinical).
- Constraints: Unique loginIdentifier. One active DOCTOR seeded (app check). Inactive blocks auth + WS.
- Indexes: Unique B-Tree lower(loginIdentifier). B-Tree role+isActive.
- Privacy: SECRETARY reads own only. List/activate [DOCTOR].

### Entity 4.2 RefreshTokenFamily
- Attributes: familyId; tokenId unique; userId (FK → User, Cascade allowed here ONLY); tokenHash; issuedAt; expiresAt; rotatedFromId nullable; isRevoked; reuseDetected default false.
- Constraints: One active per family; reuse revokes family; purge by job only.
- Indexes: B-Tree userId+isRevoked; B-Tree expiresAt.
- Privacy: Never exposed.

---

## 5. Domain 3 — Patient and Queue

### Entity 5.1 Patient
- Attributes: id; fullName (required); age (integer >=0); phone (nullable, unique if present, normalized); nationalId (nullable, unique if present); emergencyContactName/Phone/Relation (required); physicalAddress (required); adminNotes (nullable, length-capped e.g. 500 chars, operational-only); outstandingBalanceMinor (derived cache >=0 default 0, not writable); lastVisitAt nullable; createdAt; createdByUserId (FK Restrict).
- Relationships: Patient 1:N QueueEntry (Restrict); 1:N Invoice (Restrict); 1:N Encounter (Restrict, FK retained — sole clinical edge); 1:N Medication (Restrict); 1:N TherapyNote (Restrict); 1:N ScribeSession (Restrict); 1:N FollowUpTask (Restrict).
- Constraints: Search-first flow. Duplicate phone/nationalId → 409 with candidate, no auto-merge. outstanding recomputed from invoices minus write-offs, never set directly.
- Indexes: B-Tree phone exact/prefix; B-Tree nationalId exact; text-search-capable composite on fullName; B-Tree lastVisitAt; partial on outstandingBalanceMinor >0.
- Privacy: SECRETARY full read of THIS entity via allowlisted `toSecretPatientDto` (SecretSafe). No clinical joins in same DTO — impossible by construction (no relations to include).

### Entity 5.2 QueueEntry
- Attributes: id; patientId (FK → Patient Restrict); shiftId (FK → Shift Restrict); status (QueueStatus default WAITING); isEmergency (default false); emergencyReason (required iff isEmergency); position (integer); checkedInAt immutable; calledAt nullable; completedAt nullable; reorderCount default 0; clinicalEncounterRef (PLAIN string nullable, indexed, NO FK — DB-02: optional correlation to Encounter.id for DOCTOR-only second lookup, never a relation); idempotencyKey (text, required on check-in, unique per shift+patient+key, DB-08); undoWindowUntil nullable (undo-complete deadline, e.g. +15 min after complete).
- Relationships: Shift 1:N QueueEntry (Restrict); Patient 1:N QueueEntry (Restrict). NO relation to Encounter/Medication/Vault/Scribe (DELETED per DB-02). QueueEntry 1:1 Invoice enforced via Invoice.queueEntryId unique (operational→operational FK retained).
- Constraints: Machine WAITING→IN_CONSULTATION→COMPLETED; WAITING↔SKIPPED; COMPLETED→IN_CONSULTATION ONLY via undo-complete (doctor, within window, audited, single hop). No WAITING→COMPLETED. Emergency forces position 0; burying emergency without unflag rejected. Reorder WAITING-only. Debt ack is an OPTIONAL ADVISORY record (Decision 1): outstanding debt never blocks check-in and never requires acknowledgement. Single-consult and one-open-per-patient enforced by DB (Appendix A) PLUS app lock (409 on violation).
- Indexes: Composite B-Tree shiftId+status+position; B-Tree patientId+checkedInAt; partial shiftId WHERE status=WAITING; B-Tree clinicalEncounterRef (plain, for DOCTOR second lookup only); unique idempotencyKey per scope; queueVersion checked at Shift row (DB-12), not per-entry version.
- Privacy: Operational only. Both roles read via `toSecretQueueDto`. No clinical keys exist to leak.

### Entity 5.3 Shift queueVersion (stored on Shift, governs Queue)
- Shift.queueVersion integer default 0, increments inside lockShift transaction on EVERY queue mutation (check-in, call, skip, requeue, complete, undo-complete, reorder, emergency flag/unflag). Reorder/emergency callers supply expectedQueueVersion; mismatch → 409 STALE_QUEUE with current snapshot. WS `queue.updated` always carries queueVersion.

---

## 6. Domain 4 — Cashier and Financial

### Entity 6.1 Shift
- Attributes: id; businessDate (date unique); status (OPEN default); openingFloatMinor >=0; queueVersion (integer default 0, DB-12); expectedCashMinor (derived, nullable until close — WITHHELD pre-close per DB-10 blind rule); actualCountedMinor (nullable until close); differenceMinor (nullable until close); result (ShiftResult nullable); openedByUserId (FK); closedByUserId nullable; closedAt nullable; closeIdempotencyKey (text nullable, unique per shift, DB-08).
- Relationships: Shift 1:N QueueEntry/Invoice/Receipt/PettyExpense (all Restrict).
- Constraints: One OPEN per date (app + unique partial). Close requires lockShift + actualCounted + no open WAITING/IN_CONSULTATION entries unless force+doctor+audit. CLOSED immutable. Expected withheld from closer until actual persisted (blind, DB-10); server reveals diff after.
- Indexes: Unique businessDate; B-Tree status; B-Tree queueVersion (for OCC diagnostics).
- Privacy: Both roles read summary via allowlisted DTO (no expected pre-reveal to closer; doctor oversight sees full post-close).

### Entity 6.2 Invoice / Payable
- Attributes: id; patientId (FK Restrict); queueEntryId (FK → QueueEntry unique, Restrict — operational→operational retained); shiftId (FK Restrict, locked via lockShift); queueEntryRefPlain (redundant plain string copy for idempotency diagnostics, optional); standardFeeMinor (snapshot, required); finalFeeMinor (>=0, required); discountMinor (=max(0,standard-final), derived); discountReason (required iff final<standard and not complimentary); isComplimentary (default false); complimentaryAuthorizedByUserId (DOCTOR ref, required iff complimentary); collectedMinor (DERIVED sum of CHARGE minus REVERSAL, never directly written, DB-07); writeOffMinor (default 0, doctor-only, DB-17); writeOffReason (required iff writeOff>0); outstandingMinor (derived = max(0, final - collected - writeOff)); status (UNPAID default; PARTIAL; PAID; COMPLIMENTARY; WRITTEN_OFF when writeOff covers remainder); source (CHECKIN_AUTO default); idempotencyKey (required, unique per shift scope, DB-08); createdAt; createdByUserId.
- Relationships: QueueEntry 1:1 Invoice; Patient 1:N; Shift 1:N; Invoice 1:N Receipt (Restrict). NO relation to Encounter/Medication/Vault/Scribe (DELETED).
- Constraints: Downward override needs discountReason. Secretary floor: if actor is SECRETARY and (standard-final) exceeds secretaryMaxDiscountMinor OR pct exceeds secretaryMaxDiscountPct → 403 FLOOR_VIOLATION, doctor required (DB-09). Complimentary needs DOCTOR, final 0. Write-off needs DOCTOR + reason. Status derived, never set directly except via transitions. Uncollectible debt handled via write-off, NOT via deleting invoice (fixes uncollectible-debt flaw).
- Indexes: Unique queueEntryId; composite shiftId+status; composite patientId+status; B-Tree idempotencyKey unique scope; B-Tree clinicalEncounterRef explicitly ABSENT (no such column — correlation via separate DOCTOR query if needed).
- Privacy: Financial only, `toSecretInvoiceDto`. No clinical.

### Entity 6.3 Receipt (Immutable, Grant-Protected)
- Attributes: id; invoiceId (FK Restrict); patientId (FK Restrict, denormalized); shiftId (FK Restrict); actorUserId (FK); type (ReceiptType CHARGE|REVERSAL, required); amountMinor (>0 required; for REVERSAL equals negated original linkage amount logically, stored positive + type); paymentMethod (CASH|OTHER); reversalOfReceiptId (PLAIN string nullable, required iff type REVERSAL — references prior receipt id with NO FK cascade, DB-06); reason (required iff REVERSAL; optional note iff CHARGE); idempotencyKey (required, unique, DB-08); createdAt (no updatedAt — immutable).
- Relationships: Invoice 1:N Receipt (Restrict). Self-link is plain string, NOT a Prisma relation (avoids operational self-cascade complexity; resolved by service lookup).
- Constraints: Immutable row + DB REVOKE (Appendix A). Every checkout/pay creates CHARGE even if amount 0? Zero-amount CHARGE allowed once for unpaid traceability (amount 0, method OTHER, note UNPAID). Corrections ONLY via REVERSAL (doctor-only for financial reversals, requires reason + lockShift + audit). Sum rule: Invoice.collected = sum(CHARGE amounts) − sum(REVERSAL amounts linked to that invoice). No update/delete API.
- Indexes: B-Tree invoiceId+createdAt; composite shiftId+createdAt (+type); composite patientId+createdAt; unique idempotencyKey; B-Tree reversalOfReceiptId plain.
- Privacy: SECRETARY visible via allowlist (no clinical). REVERSAL list visible to both (operational).

### Entity 6.4 PettyExpense
- Attributes: id; shiftId (FK Restrict, lockShift); amountMinor (>0); purpose (required non-blank); actorUserId; idempotencyKey (required unique per shift, DB-08); createdAt.
- Constraints: OPEN shift only. lockShift required. No deletion.
- Indexes: B-Tree shiftId+createdAt; unique idempotencyKey scope.
- Privacy: Operational both roles.

### Derived 6.5 Debt Ledger (no table)
- Aggregation of Invoice outstandingMinor where status UNPAID/PARTIAL per patient. Patient.outstandingBalanceMinor cached sum. Write-offs excluded from outstanding. Served by Invoice patientId+status index. Uncollectible handled via writeOff, never via silent delete (RPS-2 fix).

---

## 7. Domain 5 — Intercom

### Entity 7.1 IntercomMessage
- Attributes: id; fromUserId (FK); fromRole; messageType; bodyText (required iff CUSTOM_TEXT, length-capped, else optional note); relatedQueueEntryId (FK → QueueEntry nullable Restrict — operational→operational retained); relatedInvoiceId (FK → Invoice nullable Restrict); clinicalRef EXPLICITLY ABSENT (no Encounter/Medication/Vault/Scribe FK — DELETED per DB-02; any clinical correlation forbidden); idempotencyKey (required for complimentary triggers, prevents double-zeroing); createdAt.
- Constraints: Type-ownership (DOCTOR_* by DOCTOR, SEC_* by SECRETARY). CUSTOM_TEXT length cap + clinical-pattern warning. DOCTOR_COMPLIMENTARY triggers billing complimentary under DOCTOR auth + idempotency. Append-only.
- Indexes: B-Tree createdAt desc; composite relatedQueueEntryId+createdAt.
- Privacy: Non-clinical only. `toSecretIntercomDto` allowlist. No clinical keys exist.

### Entity 7.2 FollowUpTask
- Attributes: id; patientId (FK Restrict); requestedByUserId (DOCTOR FK); note (scheduling only, length-capped); status REQUESTED default; requestedAt; resolvedAt nullable; sourceMessageId (FK → IntercomMessage nullable Restrict).
- Constraints: Created only via DOCTOR_FOLLOWUP. No clinical reason.
- Indexes: B-Tree patientId+status.
- Privacy: Operational both roles.

---

## 8. Domain 6 — Clinical EHR and Vault (Doctor Exclusive, Isolated)

### Entity 8.1 Encounter
- Attributes: id; patientId (FK → Patient Restrict — SOLE permitted inbound edge); queueEntryRef (PLAIN string nullable, indexed, NO FK — DB-02/DB-13: optional correlation, resolved by DOCTOR second query); source (EncounterSource MANUAL|SCRIBE, required — RPS-2 fix for missing manual path); soapSubjective/Objective/Assessment/Plan (long text, required at SIGNED; nullable/blank at DRAFT with explicit TBD marker policy); mseAppearance/Behavior/SpeechCoherence/MoodAffect (discrete selector text, each REQUIRED as explicit value INCLUDING NOT_PERFORMED — DB-14; never null-implicit); diagnoses (list, may be empty with explicit none-documented marker); status (DRAFT default, SIGNED); signedByUserId (DOCTOR ref nullable); signedAt nullable; createdAt; addendumCount default 0; originScribeDraftRef (PLAIN string nullable, NO FK — DB-02: correlates to ScribeDraft.id for provenance without relation).
- Relationships: Patient 1:N Encounter (Restrict). NO Prisma relations to QueueEntry/Invoice/Scribe/Medication as parent (all severed). Encounter 1:N Medication and 1:N TherapyNote are LOGICAL (via patientId+encounterRef plain columns on children), not Prisma relations from this side — enforced to keep single-schema but zero-include (services query children explicitly under DOCTOR auth).
- Constraints: SIGNED requires complete SOAP (or explicit NOT_PERFORMED MSE + documented rationale) + DOCTOR. DRAFT editable; SIGNED locked except addendum. Manual creation allowed with NO queueEntryRef (DB-13). One SIGNED per queue visit is policy (app check on queueEntryRef plain uniqueness per patient, NOT a DB FK unique — avoids cross-boundary constraint).
- Indexes: Composite patientId+signedAt desc; B-Tree status; B-Tree source; B-Tree queueEntryRef plain (DOCTOR lookup); B-Tree originScribeDraftRef plain.
- Privacy: DOCTOR-only. No SECRETARY DTO exists (no toSecret variant — hard 403). Never joined to operational responses.

### Entity 8.2 Medication
- Attributes: id; patientId (FK Restrict); encounterRef (PLAIN string nullable, NO FK — DB-02); drugName/dosage/frequency/instructions (required); status ACTIVE default; cessationReason (required iff DISCONTINUED); startedAt; stoppedAt (required iff DISCONTINUED); prescribedByUserId (DOCTOR).
- Relationships: Patient 1:N only as FK. Encounter linkage via plain encounterRef string.
- Constraints: Discontinue needs reason + stoppedAt. No reactivation (new row). History retained.
- Indexes: Composite patientId+status+startedAt; B-Tree drugName (DOCTOR); B-Tree encounterRef plain.
- Privacy: DOCTOR-only.

### Entity 8.3 TherapyNote — Vault (ciphertext-only)
- Attributes: id; patientId (FK Restrict — sole FK); encounterRef (PLAIN string nullable, NO FK); ciphertext (opaque large text, required; no plaintext column); keyId (text, required — references Vault Key Custody checklist key label, Appendix B); createdByUserId (DOCTOR); createdAt.
- Relationships: Patient 1:N only. NO FKs to Shift/Invoice/Receipt/QueueEntry/Intercom/Scribe (none ever existed; reaffirmed). Encounter via plain string only.
- Constraints: Encrypt-before-persist; decrypt in memory DOCTOR-only. Plaintext never logged/audited/indexed. Separate router + independent authz. Backup inherits ciphertext.
- Indexes: B-Tree patientId+createdAt desc ONLY. No content indexes.
- Privacy: Maximum. SECRETARY 403. Excluded from all operational aggregations and future integrations by default.

---

## 9. Domain 7 — AI Scribe (Doctor Exclusive)

### Entity 9.1 ScribeSession
- Attributes: id; patientId (FK Restrict); encounterRef (PLAIN string nullable, NO FK — DB-02); mode (AMBIENT_LIVE|DICTATION_60S); audioReference (opaque pointer nullable — nulled after purge, DB-16); durationSec; consentStatus (GRANTED|WITHDRAWN, default GRANTED at creation iff consentConfirmed); consentedAt (required); withdrawnAt nullable; withdrawalReason nullable (required iff WITHDRAWN); status (UPLOADED default; TRANSCRIBING; TRANSCRIBED; FAILED; WITHDRAWN; PURGED); audioRetentionUntil (timestamp = createdAt + 30d, DB-16); transcriptReference (opaque pointer nullable); createdByUserId (DOCTOR); createdAt; stoppedAt nullable.
- Relationships: Patient 1:N only as FK. No relations to Encounter/Medication/Vault.
- Constraints: AMBIENT requires consent GRANTED else reject. Dictation duration cap enforced. Withdraw (explicit endpoint) locks session: blocks transcribe/synthesize, sets WITHDRAWN, starts retention clock; bytes purged at TTL → audioReference nulled, status PURGED (if no further legal hold). Failed retained.
- Indexes: B-Tree patientId+createdAt (DOCTOR); B-Tree status; B-Tree audioRetentionUntil for purge job.
- Privacy: DOCTOR-only. Audio/transcript refs never to SECRETARY.

### Entity 9.2 ScribeDraft
- Attributes: id; scribeSessionId (FK → ScribeSession Restrict — scribe→scribe retained, both clinical-side); patientId (FK Restrict); mseSnapshot (compound appearance/behavior/speechCoherence/moodAffect, each explicit incl. NOT_PERFORMED, DB-14); transcriptReference (opaque, nullable after purge); soapDraftS/O/A/P (AI-suggested, required); confidenceScore nullable; version default 1; status DRAFT default; createdAt; signedEncounterRef (PLAIN string nullable, NO FK — DB-02: set at sign-off to Encounter.id without relation).
- Relationships: ScribeSession 1:N ScribeDraft (Restrict). No relation to Encounter (plain ref only).
- Constraints: MSE explicit (NOT_PERFORMED allowed, missing rejected). Draft never writes chart directly — sign-off creates/links SIGNED Encounter via service (two writes, no FK). Only latest signable; signed locked; superseded retained.
- Indexes: B-Tree scribeSessionId+version; B-Tree patientId+createdAt.
- Privacy: DOCTOR-only.

---

## 10. Domain 8 — Audit (Append-Only, Grant-Protected)

### Entity 10.1 AuditEvent
- Attributes: id; actorUserId (FK); actorRole snapshot; action (extended enum incl. REVERSAL/INVOICE_PAY/UNDO_COMPLETE/CONSENT_WITHDRAWN/AUDIO_PURGED/WRITE_OFF/IDEMPOTENT_REPLAY); entityType (text); entityId (opaque text, NO FK); beforeState/afterState (allowlisted operational structs ONLY — ids/amounts/positions/versions/reasons; never SOAP/MSE-drug/vault/transcript); reasonText (required for DISCOUNT/COMPLIMENTARY/EMERGENCY/REVERSAL/WRITE_OFF/FEE_OVERRIDE/PETTY); requestId/idempotencyKey (text, unique per actor+action+entity, DB-19 deduplication); createdAt.
- Relationships: User 1:N only. No clinical FKs.
- Constraints: Append-only + DB REVOKE. Write-time allowlist enforcement (tripwire fails build on new clinical key). Vault/scribe content never in snapshots (ids only). Idempotent replays log IDEMPOTENT_REPLAY without duplicate side effects.
- Indexes: Composite createdAt desc; composite entityType+entityId+createdAt; composite actorUserId+createdAt; partial per high-volume action; unique requestId scope.
- Privacy: DOCTOR full operational; SECRETARY own operational only, vault/scribe rows filtered.

---

## 11. Cardinality Map (RPS-2 Revised — Clinical Relations Severed)

- User 1:N User (created) — Restrict
- User 1:N RefreshTokenFamily — Cascade (auth hygiene ONLY exception)
- User 1:N Patient (createdBy) — Restrict
- Shift 1:N QueueEntry / Invoice / Receipt / PettyExpense — Restrict (operational→operational retained)
- Patient 1:N QueueEntry / Invoice / FollowUpTask — Restrict (operational retained)
- Patient 1:N Encounter / Medication / TherapyNote / ScribeSession / ScribeDraft (via patientId) — Restrict (sole permitted clinical edges)
- QueueEntry 1:1 Invoice (via Invoice.queueEntryId unique) — Restrict
- Invoice 1:N Receipt — Restrict
- ScribeSession 1:N ScribeDraft — Restrict (clinical→clinical retained)
- DELETED (RPS-2 DB-02, must not reappear): QueueEntry→Encounter relation; Invoice/Receipt/Intercom/Audit→Encounter/Medication/Vault/Scribe relations; Encounter→Medication/Vault/Scribe Prisma relations (replaced by plain indexed string refs + explicit DOCTOR-only second queries).
- All cross-boundary correlation uses plain indexed string columns with NO FK, NO include, NO cascade.

---

## 12. Zero-Knowledge Boundaries (RPS-2 Allowlist Normative — Replaces Denylist)

1. SECRETARY data is produced ONLY by allowlisted mappers `toSecretPatientDto / toSecretQueueDto / toSecretInvoiceDto / toSecretReceiptDto / toSecretShiftDto / toSecretIntercomDto / toSecretAuditDto` returning branded `SecretSafe<T>` types. There is NO generic sanitizer that strips keys by regex. If a field is not explicitly picked, it does not leave the server. Naive denylist code is DELETED.
2. No SECRETARY DTO exists for Encounter/Medication/TherapyNote/ScribeSession/ScribeDraft — hard 403 at router. Type system enforces: clinical services return types incompatible with SecretSafe.
3. Single-schema Prisma with severed relations (DB-02) makes accidental `include: { encounter }` from operational queries a COMPILE error (no such relation) + CI tripwire failure.
4. Vault: ciphertext-only, keyId-labeled, no content indexes, excluded from all operational aggregations and future integrations by default.
5. Audit/intercom free text: operational allowlist structs + length caps + clinical-pattern warning; write-time allowlist blocks clinical persistence.
6. Future extensions subscribe to operational events only. Clinical/vault release requires explicit DOCTOR action.

---

## 13. Index Summary (Logical)

- Intake: B-Tree phone, nationalId; text-search composite fullName; B-Tree lastVisitAt; partial outstanding>0.
- Queue: composite shiftId+status+position; partial WHERE WAITING; B-Tree patientId+checkedInAt; plain B-Tree clinicalEncounterRef/queueEntryRef strings (DOCTOR lookup); idempotencyKey unique scope; Shift.queueVersion OCC.
- Cash: unique businessDate; B-Tree status; composite Invoice shiftId+status and patientId+status; unique Invoice queueEntryId; B-Tree Receipt invoiceId+createdAt, shiftId+createdAt+type, patientId+createdAt; unique Receipt/Petty/Close idempotencyKey; B-Tree reversalOfReceiptId plain.
- Intercom: B-Tree createdAt desc; composite relatedQueueEntryId+createdAt.
- Chart: composite patientId+signedAt desc; B-Tree status/source; plain B-Tree queueEntryRef/originScribeDraftRef strings.
- Meds: composite patientId+status+startedAt; B-Tree drugName (DOCTOR); plain encounterRef.
- Vault: patientId+createdAt desc ONLY.
- Scribe: patientId+createdAt, status, audioRetentionUntil; draft scribeSessionId+version, patientId+createdAt.
- Audit: createdAt desc; entityType+entityId+createdAt; actorUserId+createdAt; partial per action; unique requestId scope.

---

## §14. Appendix A — Canon SQL (Exactly 3 Statements, Normative)

> These are the ONLY executable SQL statements authorized by RPS-2. They enforce load-bearing concurrency and runtime grant immutability that application code alone cannot guarantee. Apply via privileged migration; application role never holds DDL after.
> Count: exactly 3 statements (two partial unique indexes + one revoke).

```sql
CREATE UNIQUE INDEX uq_queue_single_consult ON queue_entries (shift_id) WHERE status = 'IN_CONSULTATION';
CREATE UNIQUE INDEX uq_queue_one_open_per_patient ON queue_entries (shift_id, patient_id) WHERE status IN ('WAITING','IN_CONSULTATION','SKIPPED');
REVOKE UPDATE, DELETE ON receipts, audit_events FROM clinic_app;
```

Operational notes (non-executable): `clinic_app` is the runtime role used by Prisma. Migration role (owner) retains full rights to evolve schema. If table names differ by Prisma map, substitute identical semantics preserving the three guarantees. No fourth statement permitted without new RPS version.

---

## §16. Migration Installation & Legacy Pre-Cleanse Runbook (verified procedure)

**PostgreSQL version prerequisite (R10):** PostgreSQL 15+ is the supported minimum. `provision.sql` additionally executes `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (and from `clinic_app`), so the runtime role's "no DDL rights" guarantee is version-independent; on clusters older than 15 the `public` schema is owned by the bootstrap superuser, so run provision.sql AS THE SUPERUSER there. `verify-runtime-role.mjs` fails closed (CREATE TABLE deny probe) if the revoke is not effective.

**Fresh install (repeatable, verified):**
1. Create roles: `clinic_migrate` (owner, CREATEROLE) + `clinic_app` (LOGIN runtime role).
2. `CREATE DATABASE <appdb> OWNER clinic_migrate;` (UTF8 encoding required — the migration chain contains UTF-8 text).
3. `DATABASE_URL=<migrate-url> npx prisma migrate deploy` — the full chain 0001→0013 applies from empty; `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma` reports `No difference detected` (schema == datamodel). Migration 0012 preflights duplicate `encounters.origin_scribe_draft_ref` values and FAILS CLOSED (naming the conflicting sessions) if the historical commit race ever fired — manual clinical review is required in that case; nothing is deleted automatically.
4. Provision the runtime role (Appendix A companion): `npx prisma db execute --url "$MIGRATION_DB_URL" --file scripts/db/provision.sql` — base grants + default privileges + the R10 schema-CREATE revokes + the two frozen partial uniques + the DB-05 REVOKE.
5. Verify the REAL role's effective permissions: `DATABASE_URL=<app-url> node scripts/db/verify-runtime-role.mjs` — probes base CRUD (allow), DDL (deny), UPDATE/DELETE on receipts/audit_events (deny), and both frozen uniques with KEY-SPECIFIC violation assertions plus index-existence pre-checks (R8: an unrelated 23505 can never pass the probe). Exit 0 = guarantees hold. Repeatability is itself verified: `npx tsx tests/db/run-verifier-twice.ts` runs the verifier twice against a disposable embedded cluster.

**Existing database upgrade with legacy multi-OPEN shifts (migration 0010 fails closed):**
0010 creates `uq_shifts_single_open ON shifts(status) WHERE status='OPEN'`. On a legacy DB with 2+ OPEN shifts the index creation FAILS (unique violation) — by design, never silently merging. The pre-cleanse (`scripts/db/legacy-pre-cleanse.sql`, EDIT the operator id first):
- keeps the NEWEST OPEN shift (by business_date, created_at, id) OPEN;
- archives every older OPEN shift as CLOSED **UNRECONCILED**: money fields (`expected_cash_minor`/`actual_counted_minor`/`difference_minor`/`result`) and `integrity_check_passed` stay NULL — NO amount is invented — and `review_note` records the archive + that supervision must manually reconcile;
- final-guards exactly 1 OPEN shift remains; idempotent (no-op at ≤1 OPEN).
Then re-run `migrate deploy` (0010→0013 apply) and `provision.sql`.

**Disposable-DB tooling (R9):** `scripts/db/e2e-reset.mjs` now FAILS CLOSED — it runs only when `CLINIC_E2E_RESET_CONFIRM=I-UNDERSTAND-THIS-DELETES-DATA` is set AND the target database name matches the disposable rule (contains `e2e`/`disposable`/`test`); connection secrets are never printed (redacted URLs only). The embedded-PostgreSQL harness (`tests/db/disposable-db.ts`) creates its cluster as `clinic_e2e` in a temp directory on a random port and deletes it on exit — it never contacts a persistent database.

Runtime verification evidence (2026-10-11, disposable PostgreSQL 18): fresh chain replay ✓; schema diff ✓; legacy fail-closed → pre-cleanse → convergence ✓; REVOKE + frozen uniques effective for `clinic_app` ✓; scribe commit/withdraw concurrency suite 8/8 ✓ (`tests/db/scribe-concurrency-verification.ts`); verifier twice-run green (`tests/db/run-verifier-twice.ts`) ✓.

---

## §15. Appendix D — Reconciliation Invariants INV-1..10 (Normative, enforced by BE-306)

- INV-1 Collected integrity: For every invoice, `collectedMinor = SUM(CHARGE receipt amounts for that invoice) − SUM(REVERSAL amounts linked to that invoice)`. Any deviation → supervision discrepancy, block shift close.
- INV-2 Outstanding integrity: `outstandingMinor = MAX(0, finalFeeMinor − collectedMinor − writeOffMinor)`. Never negative. Patient outstanding = SUM(invoice outstanding) over UNPAID/PARTIAL.
- INV-3 Discount vs write-off separation: `discountMinor = MAX(0, standard − final)` fixed at creation; `writeOffMinor` only post-creation by DOCTOR with reason. Discount never edited after creation; shortfalls handled via pay or write-off, never via silent final edits.
- INV-4 Reversal linkage: Every REVERSAL references exactly one prior CHARGE via reversalOfReceiptId plain id; reversal amount ≤ original CHARGE amount; double-reversal of same CHARGE rejected (idempotency + link check).
- INV-5 Idempotency: Same Idempotency-Key + scope (actor+shift+entity) returns original result with IDEMPOTENT_REPLAY audit, creates zero duplicate rows.
- INV-6 Floor enforcement: No SECRETARY-created invoice violates `secretaryMaxDiscountMinor/Pct`; violations are 403 + audit, never silently escalated.
- INV-7 Petty containment: Petty rows reference OPEN shift only, inside lockShift; sum(petty for shift) monotonically non-decreasing until close.
- INV-8 Blind close: `expectedCashMinor = openingFloat + SUM(CASH CHARGE) − SUM(CASH REVERSAL) − SUM(petty)` computed post-actual; expected never exposed pre-actual; `difference = actual − expected`; result BALANCED iff difference 0.
- INV-9 Closed-shift freeze: No invoice/receipt/petty/queue mutation for CLOSED shift passes (DB Restrict + service check + tripwire). Reopen is forbidden; corrections post-close via new businessDate adjustment invoice with doctor audit, never by editing closed rows.
- INV-10 Audit coverage: Every cash/queue sensitive mutation (checkout, pay, reversal, write-off, petty, close, reorder, emergency, skip, undo-complete, complimentary, consent-withdraw) has exactly one AuditEvent with matching requestId; missing audit blocks close (supervision discrepancy view).

---

*End of RPS-2 specification. Coding Agent: implement from updated WBS using this file as structural contract. Preserve DB-01..DB-19, the 3-statement canon, INV-1..10, and allowlist SecretSafe boundaries. Do not reintroduce operational→clinical relations or mutable receipts.*
