/* eslint-disable no-console */
/**
 * REAL-DATABASE concurrency / OCC / idempotency / rollback verification (5C).
 *
 * Runs the ACTUAL service functions against a disposable PostgreSQL instance
 * with genuinely overlapping async operations — the fake-db suites cannot prove
 * transactional rollback or DB-level race authority. Run:
 *
 *   DATABASE_URL="postgresql://clinic_app:<pw>@<host>:<port>/<db>" \
 *   CLINIC_SETTINGS_FEE=50000 npx tsx tests/db/concurrency-verification.ts
 *
 * The database must be freshly migrated + provisioned (scripts/db/provision.sql)
 * — this script seeds its own users/patients/shift with the prefix `cc-` and
 * cleans up after itself. Exit 0 = every guarantee held.
 */
import assert from 'node:assert/strict';
import pkg from '@prisma/client/index.js';
const { PrismaClient } = pkg;

const db = new PrismaClient() as unknown as import('@prisma/client').PrismaClient;
// Owner client for seed/cleanup only (the runtime role cannot delete receipts — DB-05).
const owner = new PrismaClient({ datasources: { db: { url: process.env['CLEANUP_URL'] ?? '' } } }) as unknown as import('@prisma/client').PrismaClient;
const DOCTOR = { userId: 'cc-doctor', role: 'DOCTOR' } as const;

async function seed(): Promise<{ shiftId: string }> {
  await owner.user.create({
    data: { id: 'cc-doctor', name: 'CC Doctor', identifier: 'cc-doctor-ident', passwordHash: 'x', role: 'DOCTOR', isActive: true, passwordMustChange: false },
  }).catch(() => undefined);
  await owner.clinicSettings.create({
    data: { id: 'singleton', standardFeeMinor: 50_000, secretaryMaxDiscountMinor: 5_000, secretaryMaxDiscountPct: 10, avgConsultDurationMin: 20, currency: 'USD' },
  }).catch(() => undefined);
  for (const i of [1, 2, 3]) {
    await owner.patient.create({
      data: { id: `cc-patient-${i}`, fullName: `CC Patient ${i}`, fullNameNorm: `cc patient ${i}`, dateOfBirth: new Date('1990-01-01'), emergencyContactName: 'Kin', emergencyContactPhone: '000', emergencyContactRelation: 'SELF', physicalAddress: 'n/a', createdByUserId: 'cc-doctor' },
    }).catch(() => undefined);
  }
  await owner.shift.create({
    // Unique business date per run (shifts.business_date is unique clinic-wide).
    data: { id: 'cc-shift', businessDate: new Date(Date.now() - 86_400_000), status: 'OPEN', openingFloatMinor: 0, queueVersion: 0, openedByUserId: 'cc-doctor' },
  }).catch(() => undefined);
  return { shiftId: 'cc-shift' };
}

async function checkInEntry(patientId: string, key: string): Promise<string> {
  const { checkIn } = await import('../../src/modules/identity-queue/queue.service.js');
  const res = await checkIn({ patientId }, DOCTOR, key, db);
  return res.entryId;
}

async function callEntryAsDoctor(entryId: string): Promise<void> {
  const { callEntry } = await import('../../src/modules/identity-queue/queue.service.js');
  await callEntry(entryId, {}, DOCTOR, db);
}

async function cleanup(): Promise<void> {
  // NOTE: audit_events rows are intentionally NOT deleted — DB-05 makes them
  // append-only at the database level (the REVOKE denies DELETE, verified).
  await owner.receipt.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.invoice.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.queueEntry.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.shift.deleteMany({ where: { id: 'cc-shift' } });
  await owner.patient.deleteMany({ where: { id: { startsWith: 'cc-patient-' } } });
  await owner.clinicSettings.deleteMany({ where: { id: 'singleton' } });
  // cc-doctor is intentionally KEPT: audit_events rows reference it with
  // RESTRICT and those rows are append-only by design (DB-05). The seed's
  // create-catch reuses the existing row on the next run.
  await db.$disconnect();
  await owner.$disconnect();
}

let passed = 0;
function ok(label: string): void {
  passed += 1;
  console.log(`ok  ${label}`);
}

async function main(): Promise<void> {
  // Pre-clean leftovers from any previously interrupted run (idempotent re-runs).
  // Close any OPEN shifts first: the single-OPEN invariant means a leftover OPEN
  // shift (e.g. from the integrated E2E) would steal getOpenShiftOrThrow().
  await owner.shift.updateMany({ where: { status: 'OPEN' }, data: { status: 'CLOSED' } }).catch(() => undefined);
  // Order matters: receipts RESTRICT invoices, invoices RESTRICT queue entries.
  await owner.receipt.deleteMany({ where: { shiftId: 'cc-shift' } }).catch(() => undefined);
  await owner.invoice.deleteMany({ where: { shiftId: 'cc-shift' } }).catch(() => undefined);
  await owner.queueEntry.deleteMany({ where: { patientId: { startsWith: 'cc-patient-' } } }).catch(() => undefined);
  await owner.shift.deleteMany({ where: { id: 'cc-shift' } }).catch(() => undefined);
  await owner.patient.deleteMany({ where: { id: { startsWith: 'cc-patient-' } } }).catch(() => undefined);
  await owner.clinicSettings.deleteMany({ where: { id: 'singleton' } }).catch(() => undefined);
  // cc-doctor kept (audit_events RESTRICT — see cleanup note).

  const { shiftId } = await seed();

  // ---------------------------------------------------------------------------
  // 1. Genuinely concurrent double-completion: exactly ONE invoice survives.
  // ---------------------------------------------------------------------------
  {
    const entryId = await checkInEntry('cc-patient-1', 'cc-key-1');
    await callEntryAsDoctor(entryId);
    const { completeEntry } = await import('../../src/modules/identity-queue/queue.service.js');
    const results = await Promise.allSettled([completeEntry(entryId, DOCTOR, db), completeEntry(entryId, DOCTOR, db)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const invoices = await db.invoice.findMany({ where: { queueEntryId: entryId } });
    assert.equal(invoices.length, 1, 'exactly one invoice under concurrent completion');
    assert.equal(invoices[0]!.status, 'UNPAID');
    assert.equal(invoices[0]!.source, 'COMPLETION_AUTO');
    assert.ok(fulfilled.length >= 1, 'at least one completion succeeded');
    ok(`1. concurrent double-completion → 1 invoice (${fulfilled.length}/2 calls fulfilled, DB unique is race authority)`);
  }

  // ---------------------------------------------------------------------------
  // 2. Concurrent checkout race on the auto-created shell: no duplicate rows.
  // ---------------------------------------------------------------------------
  {
    const entryId = await checkInEntry('cc-patient-2', 'cc-key-2');
    await callEntryAsDoctor(entryId);
    const { completeEntry } = await import('../../src/modules/identity-queue/queue.service.js');
    await completeEntry(entryId, DOCTOR, db);
    const { checkout } = await import('../../src/modules/cashier-shift/billing.service.js');
    const results = await Promise.allSettled([
      checkout({ queueEntryId: entryId, collectedMinor: 0 }, DOCTOR, 'cc-checkout-a', db),
      checkout({ queueEntryId: entryId, collectedMinor: 50_000 }, DOCTOR, 'cc-checkout-b', db),
    ]);
    const invoices = await db.invoice.findMany({ where: { queueEntryId: entryId } });
    assert.equal(invoices.length, 1, 'checkout race keeps exactly one invoice');
    assert.equal(invoices[0]!.collectedMinor, 50_000, 'the collecting checkout won');
    assert.ok(results.every((r) => r.status === 'fulfilled' || r.status === 'rejected'), 'no unhandled crash');
    ok('2. concurrent checkout race → single invoice, collected state consistent');
  }

  // ---------------------------------------------------------------------------
  // 3. Undo → re-complete cycle: the SAME invoice is reused (never duplicated).
  // ---------------------------------------------------------------------------
  {
    const entryId = await checkInEntry('cc-patient-3', 'cc-key-3');
    await callEntryAsDoctor(entryId);
    const { completeEntry, undoComplete } = await import('../../src/modules/identity-queue/queue.service.js');
    await completeEntry(entryId, DOCTOR, db);
    const invoiceBefore = await db.invoice.findUnique({ where: { queueEntryId: entryId } });
    await undoComplete(entryId, { reason: 'cc: wrong patient' }, DOCTOR, db);
    const statusAfterUndo = await db.queueEntry.findUnique({ where: { id: entryId } });
    assert.equal(statusAfterUndo?.status, 'IN_CONSULTATION', 'undo restores IN_CONSULTATION (API-06)');
    assert.ok(await db.invoice.findUnique({ where: { queueEntryId: entryId } }), 'invoice retained on undo');
    // API-06: after undo the consultation is ACTIVE again — complete directly (no re-call).
    await completeEntry(entryId, DOCTOR, db);
    const invoiceAfter = await db.invoice.findUnique({ where: { queueEntryId: entryId } });
    assert.equal(invoiceAfter?.id, invoiceBefore?.id, 're-completion reuses the SAME invoice');
    ok('3. undo→re-complete → same invoice id reused, status IN_CONSULTATION after undo');
  }

  // ---------------------------------------------------------------------------
  // 4. Rollback on failure (REAL transaction): FEE_NOT_CONFIGURED leaves no trace.
  // ---------------------------------------------------------------------------
  {
    const entryId = await checkInEntry('cc-patient-1', 'cc-key-4');
    await callEntryAsDoctor(entryId);
    const versionBefore = (await db.shift.findUnique({ where: { id: shiftId } }))!.queueVersion;
    const auditsBefore = await db.auditEvent.count({ where: { action: 'QUEUE_COMPLETE' } });
    // Break the fee configuration → completion must fail 422 and roll back atomically.
    await db.clinicSettings.update({ where: { id: 'singleton' }, data: { standardFeeMinor: 0 } });
    const { completeEntry } = await import('../../src/modules/identity-queue/queue.service.js');
    await assert.rejects(completeEntry(entryId, DOCTOR, db), (err: { code?: string }) => err.code === 'FEE_NOT_CONFIGURED');
    // Restore and verify zero side effects survived the failed transaction.
    await db.clinicSettings.update({ where: { id: 'singleton' }, data: { standardFeeMinor: 50_000 } });
    const entry = await db.queueEntry.findUnique({ where: { id: entryId } });
    assert.equal(entry?.status, 'IN_CONSULTATION', 'failed completion rolled back: entry still IN_CONSULTATION');
    assert.equal((await db.shift.findUnique({ where: { id: shiftId } }))!.queueVersion, versionBefore, 'queueVersion not bumped');
    assert.equal(await db.auditEvent.count({ where: { action: 'QUEUE_COMPLETE' } }), auditsBefore, 'no QUEUE_COMPLETE audit written');
    assert.equal(await db.invoice.count({ where: { queueEntryId: entryId } }), 0, 'no invoice shell created');
    ok('4. transactional rollback on FEE_NOT_CONFIGURED (real DB transaction)');

    // Completion succeeds after fixing the configuration (clear validated failure path).
    await completeEntry(entryId, DOCTOR, db);
    assert.equal(await db.invoice.count({ where: { queueEntryId: entryId } }), 1);
    ok('4b. completion succeeds after configuration fix');
  }

  // ---------------------------------------------------------------------------
  // 5. Reorder OCC under the shift row lock: concurrent same-version reorders serialize.
  // ---------------------------------------------------------------------------
  {
    const e1 = await checkInEntry('cc-patient-1', 'cc-key-5');
    const e2 = await checkInEntry('cc-patient-2', 'cc-key-6');
    const version = (await db.shift.findUnique({ where: { id: shiftId } }))!.queueVersion;
    const { reorderQueue } = await import('../../src/modules/identity-queue/queue.service.js');
    const results = await Promise.allSettled([
      reorderQueue({ lastSeenQueueVersion: version, orderedEntryIds: [e2, e1] }, DOCTOR, db),
      reorderQueue({ lastSeenQueueVersion: version, orderedEntryIds: [e1, e2] }, DOCTOR, db),
    ]);
    const codes = results.map((r) => (r.status === 'fulfilled' ? 'OK' : (r.reason as { code?: string }).code));
    assert.ok(codes.includes('OK'), 'one reorder won');
    assert.ok(codes.includes('STALE_QUEUE'), `loser surfaced STALE_QUEUE (got: ${codes.join(',')})`);
    ok('5. concurrent reorder OCC → winner applies, loser STALE_QUEUE (no silent last-writer-wins)');
  }

  // ---------------------------------------------------------------------------
  // 6. Check-in idempotent replay (service level): same key → same entry, no duplicate.
  // ---------------------------------------------------------------------------
  {
    const entryId = await checkInEntry('cc-patient-3', 'cc-key-replay');
    const replayed = await checkInEntry('cc-patient-3', 'cc-key-replay');
    assert.equal(replayed, entryId, 'same idempotency key returns the original entry');
    assert.equal(await db.queueEntry.count({ where: { patientId: 'cc-patient-3', status: 'WAITING' } }), 1);
    ok('6. check-in idempotent replay → original entry, zero duplicates');
  }

  console.log(`\nConcurrency verification green: ${passed} scenario group(s) passed on real PostgreSQL.`);
  await cleanup();
}

main().catch(async (err) => {
  console.error('CONCURRENCY VERIFICATION FAILED:', err);
  await cleanup();
  process.exit(1);
});
