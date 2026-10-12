# Project Conventions — Psychiatric Practice Management System (RPS-2 Applied)

> **Status:** RPS-2 APPLIED. RPS-2 WINS over pre-RPS-2 text. Naive regex denylist sanitizer is DELETED and replaced by allowlist-first architecture below.
> Stack: Node.js v20+ LTS + TypeScript Strict + Express.js + Zod + Prisma ORM (single client) + Socket.io
> Companions: `docs/BACKEND_TASKS_WBS.md`, `docs/DATABASE_SCHEMA_SPEC.md` (§14 canon, §15 INV), `docs/API_CONTRACTS.md`

## RPS-2 Convention Amendments CONV-01..CONV-10 (all applied)

- CONV-01 Single Prisma client + single schema file. Shared accessor `src/common/prisma.ts` exports one instance. Per-module clients or second schema files forbidden — CI tripwire fails build on detection.
- CONV-02 Allowlist-first DTOs: every SECRETARY-visible response uses explicit `toSecret<X>Dto` mapper returning branded `SecretSafe<T>`. No generic key-stripping. No `delete obj.soap`. If not picked, it does not leave the server.
- CONV-03 Idempotency middleware: `Idempotency-Key` required on cash/queue-complimentary mutations; replay returns original + `Idempotent-Replayed` + IDEMPOTENT_REPLAY audit; cross-payload reuse → 422.
- CONV-04 `lockShift(tx, shiftId)` helper: `SELECT FOR UPDATE` on shifts row inside transaction for ALL cash mutations (checkout, pay, reverse, write-off, petty, close). Contention → 409 SHIFT_LOCKED with retry guidance.
- CONV-05 `queueVersion` OCC: Shift.queueVersion increments in same transaction as every queue mutation; reorder/emergency require `If-Match`/body version; mismatch → 409 STALE_QUEUE + current snapshot.
- CONV-06 Blind close: server withholds expectedCash until actualCounted persisted; expected revealed only in close response. Closer UI must not fetch expected pre-submit (tripwire asserts no pre-close expected leak to closer role in tests).
- CONV-07 Secretary discount floor: `secretaryMaxDiscountMinor/Pct` from settings enforced in billing service; breach → 403 FLOOR_VIOLATION + audit. Write-off is separate doctor-only path.
- CONV-08 Consent + audio purge: explicit withdraw endpoint locks session; purge job at 30d TTL nulls audioReference + deletes bytes; status WITHDRAWN→PURGED. Transcript handling per retention policy, never to SECRETARY.
- CONV-09 Manual encounter + NOT_PERFORMED MSE: `POST /ehr/encounters` source MANUAL with no queue required; every MSE selector explicit including NOT_PERFORMED; missing rejected with field-level 422 distinguishing missing vs NOT_PERFORMED.
- CONV-10 Tripwire + Test Matrix enforcement: Appendix C tripwires + Appendix F matrix run in CI; any failure blocks merge. New endpoint/event requires contract entry + Zod + SecretSafe note + tripwire test.

---

## 1. Environment & Language

- Node.js v20+ LTS pinned (`engines >=20`). Same major locally and in CI.
- TypeScript Strict: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` all true.
- Zero `any`: `@typescript-eslint/no-explicit-any: error`. Untyped boundaries wrapped in Zod adapters typed `unknown` until parsed.
- ESM (`type: module`), `.js` extensions in TS imports (NodeNext). Prettier + ESLint. No console.log (injected logger). Async handlers explicitly typed.

## 2. Framework & Tooling (RPS-2 Pinned)

- Express: HTTP only (route → validate → service → allowlisted DTO). No business logic in handlers. No Prisma `include` of severed relations (compile error by design — no such relation exists).
- Zod: sole validation + inference. Every body/query/WS payload has schema in `modules/<domain>/*.validator.ts`. Failure → 422 envelope, never 500. MSE schemas enumerate NOT_PERFORMED explicitly.
- Prisma: sole accessor via single shared client (CONV-01). Services never embed raw SQL except via privileged migration for Appendix A canon. `select` allowlists mirror `toSecret*Dto` picks. Severed relations (DB-02) must not be re-added — tripwire greps schema for `Encounter|Medication|TherapyNote|ScribeSession` inside operational models and fails on hit.
- Socket.io: sole realtime. JWT handshake, room broadcast, Zod on every client payload. SECRETARY frames are SecretSafe snapshots with queueVersion; no clinical keys exist in frame types.
- Auth: Access ~15m Bearer, Refresh ~7d rotating httpOnly secure cookie, reuse revokes family. Adaptive password hash with cost from env. Constant-time compare.
- Config: env via `src/config/env.ts` Zod fail-fast. No secrets in repo.

## 3. Project Layout (Modular Monolith, Single Schema)

- `src/server.ts` boot; `src/app.ts` Express factory; `src/ws-gateway.ts` Socket factory.
- `src/config/env.ts`, `auth.ts`, `roles.ts`, `floors.ts` (discount floor constants plumbing).
- `src/common/prisma.ts` (SINGLE client), `middleware/authenticate.ts`, `requireRole.ts`, `allowlist.ts` (SecretSafe + toSecret mappers), `validate.ts` (Zod + Idempotency-Key), `audit.ts`, `concurrency.ts` (`lockShift`, `bumpQueueVersion`, OCC check), `errors/AppError.ts`, `types/secretSafe.ts`, `utils/money.ts`, `utils/time.ts`, `logger.ts`.
- `src/modules/`: `auth-users/`, `clinic-settings/`, `identity-queue/` (patients, queue, queueVersion), `cashier-shift/` (shifts, invoices, receipts CHARGE/REVERSAL, petty, close, invariants BE-306), `intercom-realtime/`, `clinical-ehr/` (+`vault/` segregated), `ai-scribe/` (+ consent/purge BE-604), `audit-supervision/` (+ discrepancy BE-702). Each with `*.routes.ts`, `*.service.ts`, `*.validator.ts`, `*.dto.ts` (allowlisted). No cross-module persistence imports.
- Dependency rule: common has no domain imports. Domains import common + own files only. Cross-domain via internal id-only events (e.g. queue.completed → cashier; complimentary → cashier idempotent; scribe signed → EHR source SCRIBE). No clinical bodies in events except DOCTOR-only EHR-internal handoff.
- Naming: versioned `/api/v1/...`; rooms `clinic:queue`, `clinic:intercom`.

## 4. Error Handling Standard (RPS-2 Reconciled)

- Envelope: success = DTO or `{data}` (no error key). Failure = `{ error: { code, message, details: [{field?, issue, expected?}] } }`.
- Codes: 400 BAD_REQUEST / ILLEGAL_TRANSITION; 401 UNAUTHORIZED; 403 FORBIDDEN + FLOOR_VIOLATION (secretary discount breach) + WITHDRAWN_GONE (audio op on withdrawn); 404 NOT_FOUND; 409 CONFLICT + STALE_QUEUE (OCC) + SHIFT_LOCKED (lock contention) + ALREADY_REVERSED + INVARIANT_VIOLATION (close blocked, with discrepancies[]); 410 GONE (purged audio); 422 UNPROCESSABLE + IDEMPOTENCY_KEY_REQUIRED + IDEMPOTENCY_KEY_REUSE + MSE_REQUIRED (missing vs NOT_PERFORMED distinguished in details) + CONSENT_REQUIRED; 500 INTERNAL (generic + incident id).
- Idempotent replay: 200 + `Idempotent-Replayed: true` + IDEMPOTENT_REPLAY audit (not error).
- Error boundary last; AppError mapping; correlation id on 500s.

## 5. Allowlist-First Sanitizer Architecture (Replaces Denylist) + Appendix F Critical Test Matrix

### 5.1 Architecture (normative)
- Branded type: `type SecretSafe<T> = T & { readonly __secretSafe: unique symbol }`. Only `toSecret<X>Dto` functions in `allowlist.ts` / `*.dto.ts` may construct SecretSafe. Route handlers for SECRETARY-visible routes declare return type SecretSafe and MUST call the mapper; returning a raw Prisma row is a TYPE ERROR.
- Mappers: `toSecretPatientDto`, `toSecretQueueDto (incl. queueVersion)`, `toSecretInvoiceDto`, `toSecretReceiptDto`, `toSecretShiftDto (blind-aware: omits expected pre-close for closer)`, `toSecretIntercomDto`, `toSecretAuditDto`. Each is explicit pick (allowlist), never omit/strip. New fields default-hidden until mapper updated + test updated.
- No SECRETARY mapper exists for clinical types — hard 403 at router. Clinical services return non-SecretSafe types incompatible with SECRETARY handlers.
- WS frames use same mappers (queue.updated built from toSecretQueueDto array + queueVersion). Audit write path uses separate operational allowlist structs (no clinical).
- Old `sanitize.ts` regex/strip behavior DELETED. File replaced by `allowlist.ts`; any residual denylist import fails tripwire.

### Appendix F — Critical Test Matrix (CI-blocking, normative)
- F-1 Allowlist snapshot: every SECRETARY fixture (REST + WS) asserted to contain ONLY allowlisted keys; extra key → fail. Includes `?include=clinical` fuzz (must 403 or return SecretSafe with zero clinical keys).
- F-2 Relation-severance: schema grep for operational→clinical relation names fails build on hit; attempt to `include: { encounter }` from operational service fails typecheck test.
- F-3 Concurrency: parallel checkout/pay/petty on same shift under lockShift yields exactly-once sums (INV-1); concurrent reorders with stale queueVersion yield exactly one winner + STALE_QUEUE for loser; single-consult + one-open-per-patient DB constraints hit under race (409, no double).
- F-4 Financial: discount without reason 422; secretary floor breach 403; complimentary by SECRETARY 403; pay on PAID 400; double-reverse 400; idempotent replay returns original with zero duplicate rows; blind close never leaks expected pre-actual (assert response absence); closed-shift mutation rejected.
- F-5 Clinical: manual encounter without queue succeeds (MANUAL); scribe Gen-2 commit creates the SCRIBE encounter with plain ref (no FK); MSE missing 422 distinct from NOT_PERFORMED accepted; SECRETARY chart/meds/vault/scribe all 403.
- F-6 Consent/purge: withdraw locks cycles/commit (403 WITHDRAWN_GONE; repeat 409 CONFLICT; 410 GONE after purge); purge job at TTL nulls audioReference, status PURGED, bytes deleted; withdrawn session never returns audio.
- F-7 Immutability: direct UPDATE/DELETE on receipts/audit_events as app role rejected (grant test, mirrors Appendix A REVOKE); corrections only via REVERSAL/addendum/write-off.
- F-8 Invariants: BE-306 INV-1..10 suite green required to close shift in tests; discrepancy view lists violations; missing audit blocks close.
- F-9 Undo-complete (API-06, Decision 3): normal reversal to IN_CONSULTATION (never WAITING); `{reason}` required + Idempotency-Key enforced + optional OCC; within window succeeds single-hop with audit QUEUE_COMPLETE_UNDO; expired/second-undo 400; blocked when a signed encounter or receipts exist (409); SECRETARY 403; the invoice is retained, never deleted.
- F-10 Idempotency: same key+payload replay → single row + replay header; same key+different payload → 422 REUSE.

---

## 6. Environment Blueprint (`.env.example`)

- Required (fail fast): DATABASE_URL, JWT_SECRET (≥32 chars), JWT_REFRESH_SECRET (≥32, ≠ JWT_SECRET), JWT_ACCESS_TTL (15m), JWT_REFRESH_TTL (7d), PORT, CORS_ORIGIN (no wildcard prod), COOKIE_SECURE (true prod), PASSWORD_HASH_COST, CLINIC_DEFAULT_FEE_MINOR, CLINIC_AVG_CONSULT_MIN, CLINIC_CURRENCY, CLINIC_SECRETARY_MAX_DISCOUNT_MINOR, CLINIC_SECRETARY_MAX_DISCOUNT_PCT, AUDIO_RETENTION_DAYS (=30), SEED_DOCTOR_IDENTIFIER + SEED_DOCTOR_PASSWORD (rotate on first login), LOG_LEVEL, NODE_ENV, APP_DB_ROLE (must be `clinic_app` for REVOKE semantics), MIGRATION_DB_ROLE (owner, used only for Appendix A + migrations).
- Optional: SOCKET_CORS_ORIGIN, STT_ADAPTER/LLM_ADAPTER (mock in test), PURGE_JOB_CRON, UNDO_COMPLETE_WINDOW_MIN (=15).
- `.env` never committed. `.env.example` with placeholders + rotation impact comments.

---

## §7. Ops Runbook (RPS-2 Appendices B + C)

### Appendix B — Vault Key Custody Checklist (normative)
- B-1 Key per purpose: distinct encryption keys for vault ciphertext vs backups; key labels stored as TherapyNote.keyId, never key material alongside data.
- B-2 Custody: keys in managed secret store (env/MOUNT, never repo/DB); dual-control for rotation (doctor-owner ack + ops executor); rotation creates new keyId, re-encrypts on read (lazy) + explicit re-encrypt job; old key retained read-only until zero rows reference it.
- B-3 Access: only DOCTOR-role service identity may request decrypt; every decrypt logs VAULT_ACCESS (id+timestamp only); bulk export forbidden without break-glass procedure + second approver + audit.
- B-4 Backup/restore: backups contain ciphertext + keyId only; restore drill must prove decrypt with custody-held key; lost key = unrecoverable by design (accepted risk §8).
- B-5 Incident: suspected key leak → rotate immediately, re-encrypt, revoke old decrypt, file incident audit, notify practice owner. SECRETARY devices never hold keys.

### Appendix C — Tripwire Register (CI-blocking greps/checks, normative)
- C-1 No second Prisma client: fail on `new PrismaClient` outside `common/prisma.ts`.
- C-2 No second schema: fail on `schema*.prisma` count ≠ 1.
- C-3 No operational→clinical relation: fail on `Encounter|Medication|TherapyNote|ScribeSession|ScribeDraft` inside `model QueueEntry|Invoice|Receipt|IntercomMessage|FollowUpTask|AuditEvent` in schema.
- C-4 No denylist sanitizer: fail on `sanitize.ts` import or `delete .*soap|diagnos` strip patterns; require `toSecret*Dto` + `SecretSafe` in SECRETARY routes.
- C-5 No direct collected edits: fail on `collectedMinor:` write outside receipt-aggregation service (allow derived recompute only).
- C-6 No mutable receipts/audit: fail on `update.*receipt|delete.*receipt|update.*audit_event|delete.*audit_event` in src (migrations excluded).
- C-7 Idempotency required: fail if cash routes lack Idempotency-Key validator.
- C-8 lockShift required: fail if checkout/pay/reverse/write-off/petty/close service lacks lockShift call.
- C-9 queueVersion required: fail if reorder/emergency handler lacks If-Match/OCC check + bump.
- C-10 MSE NOT_PERFORMED: fail if MSE Zod lacks NOT_PERFORMED literal.
- C-11 Canon count: fail if migration set adds SQL beyond Appendix A 3 statements without new RPS version.
- C-12 Blind close: test asserts expectedCash absent pre-actual for closer.

---

## §8. Threat Model & Accepted Residual Risks (RPS-2)

- T-1 Front-desk curiosity / privilege abuse: mitigated by allowlist SecretSafe + severed relations + 403s + audit; residual: SECRETARY shoulder-surfing doctor screen (procedural, out of backend scope — accepted, recommend screen-privacy practice).
- T-2 Discount/drawer fraud: mitigated by floor + mandatory reasons + idempotency + lockShift + blind counts + INV gate; residual: colluding doctor + secretary (owner is doctor — accepted as owner-trust boundary, still fully audited).
- T-3 Intercom/audit smuggling clinical text: mitigated by allowlists + length caps + write-time checks; residual: free-text clinical typed by doctor into CUSTOM_TEXT visible to secretary (accepted, addressed by training + warning; structured clinical never auto-included).
- T-4 Audio/transcript retention: mitigated by consent gate + withdraw lock + 30d purge + PURGED status; residual: backup copies of audio bytes until backup rotation (accepted, documented TTL applies to live store + backup expiry procedure).
- T-5 Key loss: vault unrecoverable if keys lost (by design, Appendix B); accepted, mitigated by custody + drills.
- T-6 Concurrency races: mitigated by DB partial uniques + lockShift + OCC; residual: brief 409s under contention requiring client retry (accepted, specified retry guidance).
- T-7 WS replay / stale snapshot: mitigated by queueVersion in every frame + refetch on STALE; residual: sub-second divergence during partition (accepted, snapshot converges on reconnect).
- Out of scope (accepted, not mitigated here): endpoint-device compromise, network TLS termination practices, physical drawer theft (backend records discrepancy, does not prevent).

*End of RPS-2 conventions. Implement CONV-01..10, Appendices B/C/F, and §8 exactly. Do not reintroduce denylist sanitizer or second Prisma clients.*
