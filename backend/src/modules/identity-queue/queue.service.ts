import type { Prisma, PrismaClient, QueueEntry } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { publishQueueSnapshot } from '../../common/realtime.js';
import { isUniqueViolation } from '../../common/db/unique-violation.js';
import type { SecretSafe } from '../../common/types/secretSafe.js';
import {
  toSecretQueueEntryDto,
  toSecretQueueListDto,
  toSecretQueueReorderDto,
  toSecretWaitTimesDto,
  type DebtAlertDto,
  type QueueEntryDto,
  type QueueEntryRow,
  type WaitTimeItemDto,
} from './queue.dto.js';
import type { ActorRef } from './patient.support.js';
import {
  assertLegalTransition,
  bumpQueueVersion,
  computeEstimatedWaitMin,
  computePatientDebt,
  computeTailPosition,
  defaultAvgConsultMin,
  estimateWaitMin,
  getOpenShiftOrThrow,
  loadOrderedWaitingPool,
  loadQueueEntry,
  lockShift,
  mapQueueUniqueViolation,
  normalizeQueueStatus,
  renumberWaitingPool,
  renumberWaitingPoolByCheckedInAt,
  writeQueueAudit,
} from './queue.support.js';
import { loadClinicFees, writeBillingAudit } from '../cashier-shift/billing.support.js';
import type {
  AbandonInput,
  CallInput,
  CallNextInput,
  CheckInInput,
  EmergencyToggleInput,
  NoShowInput,
  ReorderInput,
  RequeueInput,
  UndoCompleteInput,
  WaitTimesQuery,
} from './queue.validators.js';

const UNDO_WINDOW_MIN = 15;

/**
 * Decision 2 (INV-5 close trap): encounter completion atomically creates the
 * patient's UNPAID invoice shell, reusing the existing billing rules — the
 * standard fee snapshot comes from clinic-settings via `loadClinicFees`
 * (env fallback), exactly as `POST /billing/checkout` would snapshot it. No
 * financial value is invented: finalFee = standardFee, discount 0, collected 0.
 * Idempotent by construction: the invoice is keyed to the queue entry
 * (`queueEntryId` unique) with a deterministic idempotency key, so retries,
 * double-submits and undo→re-complete reuse the same row instead of
 * duplicating it. A misconfigured (non-positive) fee is a clear 422 failure —
 * never a fabricated invoice.
 */
async function ensureCompletionInvoice(
  tx: Prisma.TransactionClient,
  entry: QueueEntry,
  actor: ActorRef,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.invoice.findUnique({ where: { queueEntryId: entry.id }, select: { id: true } });
  if (existing !== null) return { id: existing.id, created: false };
  const fees = await loadClinicFees(tx);
  if (!Number.isFinite(fees.standardFeeMinor) || fees.standardFeeMinor <= 0) {
    throw new AppError('FEE_NOT_CONFIGURED', 'Standard consultation fee is not configured; cannot create the invoice', [
      { field: 'standardFeeMinor', issue: 'non-positive or missing', expected: 'clinicSettings.standardFeeMinor > 0' },
    ]);
  }
  try {
    const created = await tx.invoice.create({
      data: {
        patientId: entry.patientId,
        queueEntryId: entry.id,
        shiftId: entry.shiftId,
        standardFeeMinor: fees.standardFeeMinor,
        finalFeeMinor: fees.standardFeeMinor,
        discountMinor: 0,
        discountReason: null,
        isComplimentary: false,
        collectedMinor: 0,
        writeOffMinor: 0,
        outstandingMinor: fees.standardFeeMinor,
        status: 'UNPAID',
        source: 'COMPLETION_AUTO',
        idempotencyKey: `completion:${entry.id}`,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    // INV-10 (APPX-D-10): every invoice needs its audit row, written INSIDE the
    // same transaction so coverage cannot drift. Without this, bare completions
    // failed shift close with INVARIANT_VIOLATION (QA finding: 14 missing rows
    // blocked close). Action CHECKOUT matches the documented equivalence (the
    // shell is snapshotted exactly as POST /billing/checkout would snapshot
    // it); afterState marks the auto-created, uncollected shell.
    await writeBillingAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CHECKOUT',
      entityType: 'Invoice',
      entityId: created.id,
      idempotencyKey: `completion:${entry.id}`,
      afterState: {
        source: 'COMPLETION_AUTO',
        queueEntryId: entry.id,
        finalFeeMinor: fees.standardFeeMinor,
        collectedMinor: 0,
        status: 'UNPAID',
      },
    });
    return { id: created.id, created: true };
  } catch (err) {
    // Concurrent completion of the same entry: the queueEntryId unique wins;
    // converge on the winner's invoice instead of failing the completion.
    if (isUniqueViolation(err, 'queue_entry_id')) {
      const winner = await tx.invoice.findUnique({ where: { queueEntryId: entry.id }, select: { id: true } });
      if (winner !== null) return { id: winner.id, created: false };
    }
    throw err;
  }
}

/**
 * P1-3: Emergency unflag restrictions removed. Any secretary or doctor can unflag any emergency flag at any time.
 */

/**
 * BE-202 Live Smart Queue Engine & State Machine.
 *
 * Concurrency model (RPS-2):
 *  - App pre-checks give friendly 409s; the frozen partial uniques
 *    `uq_queue_single_consult` and `uq_queue_one_open_per_patient` (canon.sql)
 *    are the final authority under race — P2002 is mapped to 409 here.
 *  - Every mutation runs in ONE interactive transaction that also bumps
 *    Shift.queueVersion (DB-12) and writes its audit row atomically.
 */

async function readAvgConsultMinutes(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  try {
    const row = await db.clinicSettings.findUnique({ where: { id: 'singleton' }, select: { avgConsultDurationMin: true } });
    if (row !== null && row.avgConsultDurationMin > 0) return row.avgConsultDurationMin;
  } catch {
    /* fall through to env */
  }
  try {
    return loadEnv().CLINIC_AVG_CONSULT_MIN;
  } catch {
    return defaultAvgConsultMin();
  }
}

function toRow(entry: QueueEntry & { patient: { fullName: string } }): QueueEntryRow {
  return {
    id: entry.id,
    patientId: entry.patientId,
    status: normalizeQueueStatus(entry.status),
    isEmergency: entry.isEmergency,
    emergencyReasonCode: entry.emergencyReasonCode,
    position: entry.position,
    checkedInAt: entry.checkedInAt,
    calledAt: entry.calledAt,
    completedAt: entry.completedAt,
    skippedAt: entry.skippedAt,
    noShowAt: entry.noShowAt,
    abandonAt: entry.abandonAt,
    debtAckAt: entry.debtAckAt,
    patient: { fullName: entry.patient.fullName },
  };
}

/** Best-effort shift id extraction from a queue-tx result (for snapshot logging). */
function extractShiftId(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'entry' in result) {
    const entry = (result as { entry?: { shiftId?: unknown } }).entry;
    if (typeof entry === 'object' && entry !== null && typeof entry.shiftId === 'string') {
      return entry.shiftId;
    }
  }
  return 'unknown';
}

/** Wrap a queue transaction, mapping frozen-unique P2002 violations to 409. */
async function runQueueTx<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    const result = await db.$transaction(async (tx) => fn(tx));
    // BE-401: after a committed queue mutation, broadcast the fresh versioned
    // snapshot. The publisher rebuilds from the OPEN shift, so the id here is
    // only used for correlation logging; no-op when no WS gateway is attached.
    publishQueueSnapshot(extractShiftId(result));
    return result;
  } catch (err) {
    const mapped = mapQueueUniqueViolation(err);
    if (mapped !== null) throw mapped;
    throw err;
  }
}

function buildDebtAlert(debt: { outstandingMinor: number; oldestInvoiceDate: Date | null }): DebtAlertDto | null {
  if (debt.outstandingMinor <= 0) return null;
  return {
    outstandingMinor: debt.outstandingMinor,
    oldestInvoiceDate: debt.oldestInvoiceDate === null ? null : debt.oldestInvoiceDate.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/check-in  [BOTH]  -> 201 SecretSafe<QueueEntryDto> + debtAlert
// Care is NEVER blocked by debt: we always create the entry (201).
// ---------------------------------------------------------------------------
export async function checkIn(
  input: CheckInInput,
  actor: ActorRef,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const avg = await readAvgConsultMinutes(db);

  // Idempotent replay: same shift+key returns the original entry (INV-5).
  const existing = await db.queueEntry.findUnique({
    where: { shiftId_idempotencyKey: { shiftId: shift.id, idempotencyKey } },
    include: { patient: { select: { fullName: true } } },
  });
  if (existing !== null) {
    const debt = await computePatientDebt(db, existing.patientId);
    return toSecretQueueEntryDto(toRow(existing), {
      estimatedWaitMin: estimateWaitMin(existing.position, avg),
      queueVersion: shift.queueVersion,
      debtAlert: buildDebtAlert(debt),
    });
  }

  const patient = await db.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
  if (patient === null) {
    throw new AppError('NOT_FOUND', 'Patient not found');
  }

  // Pre-check: one open entry per patient (canon unique also enforces under race).
  const active = await db.queueEntry.findFirst({
    where: {
      shiftId: shift.id,
      patientId: input.patientId,
      status: { in: ['WAITING', 'IN_CONSULTATION', 'SKIPPED'] },
    },
    select: { id: true },
  });
  if (active !== null) {
    throw new AppError('ALREADY_ACTIVE', 'Patient already has an active queue entry', [
      { field: 'patientId', issue: 'ALREADY_ACTIVE', expected: `existing:${active.id}` },
    ]);
  }

  const isEmergency = input.isEmergency === true;
  const debt = await computePatientDebt(db, input.patientId);
  const debtAlert = buildDebtAlert(debt);

  const created = await runQueueTx(db, async (tx) => {
    const tail = await computeTailPosition(tx, shift.id);
    const now = new Date();
    const entry = await tx.queueEntry.create({
      data: {
        patientId: input.patientId,
        shiftId: shift.id,
        status: 'WAITING',
        isEmergency,
        emergencyReasonCode: isEmergency ? (input.emergencyReasonCode ?? null) : null,
        emergencyFlaggedAt: isEmergency ? now : null,
        position: tail,
        idempotencyKey,
      },
      include: { patient: { select: { fullName: true } } },
    });
    // Dense-renumber so emergencies float to the front (flag time ASC), then
    // regular entries keep FIFO by position ASC.
    await renumberWaitingPool(tx, shift.id);
    const refreshed = (await tx.queueEntry.findUnique({
      where: { id: entry.id },
      include: { patient: { select: { fullName: true } } },
    }))!;
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_CHECKIN',
      entityId: entry.id,
      idempotencyKey,
      requestId: randomUUID(),
      afterState: { status: 'WAITING', position: refreshed.position, isEmergency },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: refreshed, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(created.entry), {
    estimatedWaitMin: estimateWaitMin(created.entry.position, avg),
    queueVersion: created.queueVersion,
    debtAlert,
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/queue?shiftId=&status=  [BOTH]  -> 200 SecretSafe<QueueListDto>
// ---------------------------------------------------------------------------
export async function listQueue(
  query: { shiftId?: string; status?: 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'SKIPPED' | 'NO_SHOW' | 'ABANDONED' },
  _actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretQueueListDto>>> {
  let shiftId = query.shiftId;
  if (shiftId === undefined) {
    const open = await db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true, queueVersion: true } });
    shiftId = open?.id;
  }
  const avg = await readAvgConsultMinutes(db);

  if (shiftId === undefined) {
    return toSecretQueueListDto(null, 0, 0, []);
  }

  const shift = await db.shift.findUnique({ where: { id: shiftId }, select: { queueVersion: true } });
  const queueVersion = shift?.queueVersion ?? 0;

  const rows = await db.queueEntry.findMany({
    where: { shiftId, ...(query.status !== undefined ? { status: query.status } : {}) },
    orderBy: [{ emergencyFlaggedAt: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }, { checkedInAt: 'asc' }],
    include: { patient: { select: { fullName: true } } },
  });

  const entries = rows.map((row) =>
    toSecretQueueEntryDto(toRow(row), {
      estimatedWaitMin:
        row.status === 'WAITING' ? estimateWaitMin(row.position, avg) : 0,
      queueVersion,
    }),
  );

  const headWait = entries.length > 0 ? entries[0]!.estimatedWaitMin : 0;
  return toSecretQueueListDto(shiftId, queueVersion, headWait, entries);
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/call-next  [DOCTOR]  -> 200 SecretSafe<QueueEntryDto>
// ---------------------------------------------------------------------------
export async function callNext(
  input: CallNextInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);

  const current = await db.queueEntry.findFirst({
    where: { shiftId: shift.id, status: 'IN_CONSULTATION' },
  });
  if (current !== null && input.force !== true) {
    throw new AppError('ACTIVE_CONSULTATION_EXISTS', 'A consultation is already active', [
      { field: 'force', issue: 'set force:true to skip the active consultation', expected: 'force:true' },
    ]);
  }

  const pool = await loadOrderedWaitingPool(db, shift.id);
  if (pool.length === 0) {
    throw new AppError('NOT_FOUND', 'No WAITING entries to call');
  }
  const head = pool[0]!;

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    if (current !== null) {
      // Force-call: NEVER auto-complete — move the active consult to SKIPPED.
      assertLegalTransition(normalizeQueueStatus(current.status), 'SKIPPED');
      await tx.queueEntry.update({
        where: { id: current.id },
        data: { status: 'SKIPPED', skippedAt: now, previousPosition: current.position },
      });
      await writeQueueAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'FORCED_CALLNEXT',
        entityId: current.id,
        requestId: randomUUID(),
        beforeState: { status: current.status },
        afterState: { status: 'SKIPPED' },
      });
    }
    assertLegalTransition(normalizeQueueStatus(head.status), 'IN_CONSULTATION');
    const called = await tx.queueEntry.update({
      where: { id: head.id },
      data: { status: 'IN_CONSULTATION', calledAt: now },
      include: { patient: { select: { fullName: true } } },
    });
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_CALL',
      entityId: head.id,
      requestId: randomUUID(),
      beforeState: { status: 'WAITING' },
      afterState: { status: 'IN_CONSULTATION' },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: called, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/call  [DOCTOR]  -> 200 SecretSafe<QueueEntryDto>
// Out-of-order call: requires outOfOrderReasonCode when target != head (pos 1).
// force:true moves an active consultation to SKIPPED (audited FORCED_CALLNEXT),
// mirroring call-next force; the single-consult partial unique stays the race authority.
// ---------------------------------------------------------------------------
export async function callEntry(
  entryId: string,
  input: CallInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  assertLegalTransition(normalizeQueueStatus(entry.status), 'IN_CONSULTATION');

  const current = await db.queueEntry.findFirst({
    where: { shiftId: shift.id, status: 'IN_CONSULTATION' },
  });
  if (current !== null && current.id !== entry.id && input.force !== true) {
    throw new AppError('ACTIVE_CONSULTATION_EXISTS', 'A consultation is already active', [
      { field: 'force', issue: 'set force:true to skip the active consultation', expected: 'force:true' },
    ]);
  }

  const isHead = entry.position === 1;
  const outOfOrder = !isHead;
  if (outOfOrder && (input.outOfOrderReasonCode === undefined || input.outOfOrderReasonCode.length === 0)) {
    throw new AppError('OUT_OF_ORDER_REASON_REQUIRED', 'outOfOrderReasonCode is required for an out-of-order call', [
      { field: 'outOfOrderReasonCode', issue: 'required when target is not position 1', expected: 'reason code' },
    ]);
  }

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    if (current !== null && current.id !== entry.id) {
      // Force-call: NEVER auto-complete — move the active consult to SKIPPED.
      assertLegalTransition(normalizeQueueStatus(current.status), 'SKIPPED');
      await tx.queueEntry.update({
        where: { id: current.id },
        data: { status: 'SKIPPED', skippedAt: now, previousPosition: current.position },
      });
      await writeQueueAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'FORCED_CALLNEXT',
        entityId: current.id,
        requestId: randomUUID(),
        beforeState: { status: current.status },
        afterState: { status: 'SKIPPED' },
      });
    }
    const called = await tx.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'IN_CONSULTATION',
        calledAt: now,
        ...(outOfOrder && input.outOfOrderReasonCode !== undefined
          ? { outOfOrderReasonCode: input.outOfOrderReasonCode }
          : {}),
      },
      include: { patient: { select: { fullName: true } } },
    });
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: outOfOrder ? 'QUEUE_OUT_OF_ORDER_CALL' : 'QUEUE_CALL',
      entityId: entry.id,
      requestId: randomUUID(),
      reasonText: outOfOrder ? (input.outOfOrderReasonCode ?? null) : null,
      beforeState: { status: entry.status, position: entry.position },
      afterState: { status: 'IN_CONSULTATION' },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: called, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/skip  [DOCTOR]  -> 200 SecretSafe<QueueEntryDto>
// ---------------------------------------------------------------------------
export async function skipEntry(
  entryId: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  assertLegalTransition(normalizeQueueStatus(entry.status), 'SKIPPED');

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    const skipped = await tx.queueEntry.update({
      where: { id: entry.id },
      data: { status: 'SKIPPED', skippedAt: now, previousPosition: entry.position },
      include: { patient: { select: { fullName: true } } },
    });
    await renumberWaitingPool(tx, shift.id);
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_SKIP',
      entityId: entry.id,
      requestId: randomUUID(),
      beforeState: { status: entry.status },
      afterState: { status: 'SKIPPED' },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: skipped, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/requeue  [BOTH]  -> 200 SecretSafe<QueueEntryDto>
// SECRETARY always reinserts at tail; DOCTOR honors FRONT|ORIGINAL (default ORIGINAL).
// ---------------------------------------------------------------------------
export async function requeueEntry(
  entryId: string,
  input: RequeueInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  assertLegalTransition(normalizeQueueStatus(entry.status), 'WAITING');

  const secretary = actor.role === 'SECRETARY';
  const mode: 'FRONT' | 'ORIGINAL' | 'TAIL' = secretary
    ? 'TAIL'
    : (input.position ?? 'ORIGINAL');

  const result = await runQueueTx(db, async (tx) => {
    if (mode === 'TAIL') {
      const tail = await computeTailPosition(tx, shift.id);
      await tx.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'WAITING', position: tail, calledAt: null, skippedAt: null },
        include: { patient: { select: { fullName: true } } },
      });
      await renumberWaitingPool(tx, shift.id);
      const refreshed = (await tx.queueEntry.findUnique({
        where: { id: entry.id },
        include: { patient: { select: { fullName: true } } },
      }))!;
      await writeQueueAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'QUEUE_REQUEUE',
        entityId: entry.id,
        requestId: randomUUID(),
        reasonText: 'TAIL',
        beforeState: { status: 'SKIPPED' },
        afterState: { status: 'WAITING', position: refreshed.position },
      });
      const queueVersion = await bumpQueueVersion(tx, shift.id);
      return { entry: refreshed, queueVersion };
    }

    const restoredPosition =
      mode === 'FRONT' ? 1 : Math.max(1, entry.previousPosition ?? 1);
    // Shift every pool entry at/after target forward by one, then place target.
    const pool = await tx.queueEntry.findMany({
      where: { shiftId: shift.id, status: 'WAITING', position: { gte: restoredPosition } },
      orderBy: { position: 'desc' },
      select: { id: true, position: true },
    });
    for (const row of pool) {
      await tx.queueEntry.update({ where: { id: row.id }, data: { position: row.position + 1 } });
    }
    const requeued = await tx.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'WAITING',
        position: restoredPosition,
        calledAt: null,
        skippedAt: null,
        previousPosition: null,
      },
      include: { patient: { select: { fullName: true } } },
    });
    await renumberWaitingPool(tx, shift.id);
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_REQUEUE',
      entityId: entry.id,
      requestId: randomUUID(),
      reasonText: mode,
      beforeState: { status: 'SKIPPED' },
      afterState: { status: 'WAITING', position: restoredPosition },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: requeued, queueVersion };
  });

  const avg = await readAvgConsultMinutes(db);
  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: result.entry.status === 'WAITING' ? estimateWaitMin(result.entry.position, avg) : 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/complete  [DOCTOR]  -> 200 SecretSafe<QueueEntryDto>
// IN_CONSULTATION -> COMPLETED. Sets undoWindowUntil = now + 15m and, in the
// SAME transaction, creates the patient's UNPAID invoice shell (Decision 2 /
// INV-5): every COMPLETED entry leaves the completion step with exactly one
// invoice, so shift-close INV-5 can never trip on a completed entry that was
// never checked out. Re-checkout (POST /billing/checkout) reuses this invoice.
// ---------------------------------------------------------------------------
export async function completeEntry(
  entryId: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }

  try {
    // Pre-check INSIDE the convergence window: a loser arriving after the
    // winner committed sees COMPLETED here (ILLEGAL_TRANSITION) — that is an
    // idempotent replay and must converge, not fail.
    assertLegalTransition(normalizeQueueStatus(entry.status), 'COMPLETED');
    const result = await runQueueTx(db, async (tx) => {
      const now = new Date();
      const undoWindowUntil = new Date(now.getTime() + UNDO_WINDOW_MIN * 60_000);
      const completed = await tx.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'COMPLETED', completedAt: now, undoWindowUntil },
        include: { patient: { select: { fullName: true } } },
      });
      const invoice = await ensureCompletionInvoice(tx, entry, actor);
      await writeQueueAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'QUEUE_COMPLETE',
        entityId: entry.id,
        requestId: randomUUID(),
        beforeState: { status: entry.status },
        afterState: { status: 'COMPLETED', invoiceId: invoice.id, invoiceCreated: invoice.created },
      });
      const queueVersion = await bumpQueueVersion(tx, shift.id);
      return { entry: completed, queueVersion };
    });

    return toSecretQueueEntryDto(toRow(result.entry), {
      estimatedWaitMin: 0,
      queueVersion: result.queueVersion,
    });
  } catch (err) {
    // Concurrent double-complete race (R6): both transactions pass the
    // IN_CONSULTATION pre-check, one wins the invoice unique; the loser rolls
    // back and must CONVERGE on the winner's invoice instead of surfacing 409.
    // The winner is only visible AFTER commit, so convergence happens here
    // (outside the rolled-back tx) with a short retry for commit visibility.
    // Timing variant: the loser may arrive AFTER the winner committed and fail
    // the pre-check with ILLEGAL_TRANSITION (already COMPLETED) — that is the
    // same idempotent replay and converges identically.
    if (isInvoiceRace(err) || isAlreadyCompleted(err)) {
      const winner = await readCompletionWinner(db, shift.id, entryId);
      if (winner !== null) return winner;
    }
    throw err;
  }
}

async function readCompletionWinner(
  db: PrismaClient,
  shiftId: string,
  entryId: string,
): Promise<SecretSafe<QueueEntryDto> | null> {
  // Winner commit visibility: under concurrent load the loser may fail fast
  // (pre-check ILLEGAL_TRANSITION) before the winner commits — poll up to ~2s.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const fresh = await db.queueEntry.findUnique({
      where: { id: entryId },
      include: { patient: { select: { fullName: true } } },
    });
    const invoice = await db.invoice.findUnique({ where: { queueEntryId: entryId }, select: { id: true } });
    if (fresh !== null && normalizeQueueStatus(fresh.status) === 'COMPLETED' && invoice !== null) {
      const cur = await db.shift.findUnique({ where: { id: shiftId }, select: { queueVersion: true } });
      return toSecretQueueEntryDto(toRow(fresh), {
        estimatedWaitMin: 0,
        queueVersion: cur?.queueVersion ?? 0,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function isInvoiceRace(err: unknown): boolean {
  if (isUniqueViolation(err, 'queue_entry_id')) return true;
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'POSSIBLE_DUPLICATE' || code === 'P2002') return true;
  }
  return false;
}

function isAlreadyCompleted(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ILLEGAL_TRANSITION';
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/undo-complete  [DOCTOR]  (RPS-2 API-06)
// -> 200 SecretSafe<QueueEntryDto>
// COMPLETED -> IN_CONSULTATION (single hop, windowed). The completion is a
// normal reversal, not a visit cancellation: the encounter/audit trail stays,
// the entry returns to the ACTIVE consultation state. Guards: within window,
// same OPEN shift, no linked signed Encounter, linked invoice UNPAID with zero
// receipts. The invoice is NEVER deleted (zero-hard-delete): it is retained so
// re-completion reuses it (exactly-one-invoice-per-COMPLETED-entry). The
// single-consultation partial unique is the race authority — undoing while
// another consultation is active fails with 409 ACTIVE_CONSULTATION_EXISTS.
// ---------------------------------------------------------------------------
export async function undoComplete(
  entryId: string,
  input: UndoCompleteInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  if (normalizeQueueStatus(entry.status) !== 'COMPLETED') {
    throw new AppError('ILLEGAL_TRANSITION', 'Only COMPLETED entries can be undone');
  }
  if (entry.undoWindowUntil === null || entry.undoWindowUntil.getTime() < Date.now()) {
    throw new AppError('UNDO_WINDOW_EXPIRED', 'Undo window has expired');
  }
  // OCC (CONV-05/API-07): enforced when the client sends lastSeenQueueVersion.
  if (input.lastSeenQueueVersion !== undefined && input.lastSeenQueueVersion !== shift.queueVersion) {
    throw new AppError('STALE_QUEUE', 'Queue version mismatch; refetch the queue and retry', [
      { field: 'queueVersion', issue: 'stale', expected: String(shift.queueVersion) },
    ]);
  }

  const result = await runQueueTx(db, async (tx) => {
    // Serialize against concurrent queue mutations and re-check the state UNDER
    // the row lock (defense in depth — the pre-checks above are friendly 4xx only).
    await lockShift(tx, shift.id);
    const fresh = await tx.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    if (normalizeQueueStatus(fresh.status) !== 'COMPLETED') {
      throw new AppError('ILLEGAL_TRANSITION', 'Only COMPLETED entries can be undone');
    }
    if (input.lastSeenQueueVersion !== undefined) {
      const locked = await tx.shift.findUniqueOrThrow({ where: { id: shift.id }, select: { queueVersion: true } });
      if (locked.queueVersion !== input.lastSeenQueueVersion) {
        throw new AppError('STALE_QUEUE', 'Queue version mismatch; refetch the queue and retry', [
          { field: 'queueVersion', issue: 'stale', expected: String(locked.queueVersion) },
        ]);
      }
    }
    // No linked signed Encounter (correlation by explicit query, DOCTOR-only).
    const signedEncounter = await tx.encounter.findFirst({
      where: { queueEntryRef: entry.id, status: 'SIGNED' },
      select: { id: true },
    });
    if (signedEncounter !== null) {
      throw new AppError('UNDO_BLOCKED', 'Cannot undo: a signed encounter is linked', [
        { field: 'entryId', issue: 'signed encounter exists', expected: `encounter:${signedEncounter.id}` },
      ]);
    }
    // Linked invoice must be voidable (UNPAID, zero receipts) — no money has moved.
    const invoice = await tx.invoice.findUnique({ where: { queueEntryId: entry.id }, select: { id: true, status: true } });
    if (invoice !== null) {
      if (invoice.status !== 'UNPAID') {
        throw new AppError('UNDO_BLOCKED', 'Cannot undo: invoice is not UNPAID', [
          { field: 'entryId', issue: `invoice status ${invoice.status}`, expected: 'UNPAID' },
        ]);
      }
      const receiptCount = await tx.receipt.count({ where: { invoiceId: invoice.id } });
      if (receiptCount > 0) {
        throw new AppError('UNDO_BLOCKED', 'Cannot undo: invoice has collected receipts', [
          { field: 'entryId', issue: 'receipts exist', expected: 'zero receipts' },
        ]);
      }
    }

    // API-06 / §1.5 zero-hard-delete: the UNPAID invoice row is RETAINED to
    // preserve audit integrity; re-completion reuses it via
    // findUnique({ queueEntryId }), so exactly-one-invoice-per-COMPLETED-entry
    // still holds after the entry is re-completed.
    const undone = await tx.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'IN_CONSULTATION',
        completedAt: null,
        undoWindowUntil: null,
        // calledAt + position are intentionally preserved: the patient was
        // already called and stays in consultation at their queue position.
      },
      include: { patient: { select: { fullName: true } } },
    });
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_COMPLETE_UNDO',
      entityId: entry.id,
      requestId: randomUUID(),
      reasonText: input.reason,
      beforeState: { status: 'COMPLETED' },
      afterState: { status: 'IN_CONSULTATION', position: undone.position, retainedInvoiceId: invoice?.id ?? null },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: undone, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/no-show  [BOTH]  -> 200 SecretSafe<QueueEntryDto>
// WAITING | SKIPPED -> NO_SHOW (terminal).
// ---------------------------------------------------------------------------
export async function markNoShow(
  entryId: string,
  input: NoShowInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  const from = normalizeQueueStatus(entry.status);
  assertLegalTransition(from, 'NO_SHOW');

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    const updated = await tx.queueEntry.update({
      where: { id: entry.id },
      data: { status: 'NO_SHOW', noShowAt: now, noShowReasonCode: input.reasonCode },
      include: { patient: { select: { fullName: true } } },
    });
    if (from === 'WAITING') {
      await renumberWaitingPool(tx, shift.id);
    }
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_NO_SHOW',
      entityId: entry.id,
      requestId: randomUUID(),
      reasonText: input.reasonCode,
      beforeState: { status: from },
      afterState: { status: 'NO_SHOW' },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: updated, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/abandon  [DOCTOR]  -> 200 SecretSafe<QueueEntryDto>
// IN_CONSULTATION -> ABANDONED (terminal). Captures billable intent.
// ---------------------------------------------------------------------------
export async function abandonEntry(
  entryId: string,
  input: AbandonInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  assertLegalTransition(normalizeQueueStatus(entry.status), 'ABANDONED');

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    const updated = await tx.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'ABANDONED',
        abandonAt: now,
        abandonReasonCode: input.reasonCode,
        abandonBillable: input.billable,
      },
      include: { patient: { select: { fullName: true } } },
    });
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_ABANDON',
      entityId: entry.id,
      requestId: randomUUID(),
      reasonText: input.reasonCode,
      beforeState: { status: entry.status },
      afterState: { status: 'ABANDONED', billable: input.billable },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: updated, queueVersion };
  });

  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: 0,
    queueVersion: result.queueVersion,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/queue/:entryId/debt-ack  [BOTH]  -> 200 SecretSafe<QueueEntryDto>
// Records that the front-desk acknowledged outstanding debt. Never blocks care.
// ---------------------------------------------------------------------------
export async function debtAck(
  entryId: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }

  const result = await runQueueTx(db, async (tx) => {
    const now = new Date();
    const updated = await tx.queueEntry.update({
      where: { id: entry.id },
      data: { debtAckAt: now, debtAckByUserId: actor.userId },
      include: { patient: { select: { fullName: true } } },
    });
    const debt = await computePatientDebt(tx, entry.patientId);
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CHECKIN_DEBT_ACK',
      entityId: entry.id,
      requestId: randomUUID(),
      afterState: { outstandingMinor: debt.outstandingMinor },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: updated, queueVersion };
  });

  const avg = await readAvgConsultMinutes(db);
  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: result.entry.status === 'WAITING' ? estimateWaitMin(result.entry.position, avg) : 0,
    queueVersion: result.queueVersion,
  });
}
// ---------------------------------------------------------------------------
// BE-203 POST /api/v1/queue/reorder  [BOTH]  -> 200 SecretSafe<QueueReorderDto>
// Manual reorder of the non-emergency WAITING pool under OCC + row lock.
// Emergencies are pinned on top and never appear in the manual ordering.
// ---------------------------------------------------------------------------

/** Exact-set guard: submitted ids must equal the current non-emergency WAITING set. */
function assertExactReorderSet(submitted: readonly string[], currentIds: readonly string[]): void {
  const currentSet = new Set(currentIds);
  const submittedSet = new Set(submitted);
  const matches =
    submitted.length === currentIds.length &&
    submittedSet.size === currentSet.size &&
    submitted.every((id) => currentSet.has(id));
  if (matches) return;

  const extras = submitted.filter((id) => !currentSet.has(id));
  const missing = currentIds.filter((id) => !submittedSet.has(id));
  throw new AppError(
    'UNPROCESSABLE',
    'orderedEntryIds must exactly match the current non-emergency WAITING entries',
    [
      ...(extras.length > 0
        ? [{ field: 'orderedEntryIds', issue: 'contains unknown/non-WAITING/emergency ids', expected: extras.join(',') }]
        : []),
      ...(missing.length > 0
        ? [{ field: 'orderedEntryIds', issue: 'missing current non-emergency WAITING ids', expected: missing.join(',') }]
        : []),
    ],
  );
}

export async function reorderQueue(
  input: ReorderInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretQueueReorderDto>>> {
  const shift = await getOpenShiftOrThrow(db);

  // OCC: the client's last-seen version must match the stored queue version.
  if (input.lastSeenQueueVersion !== shift.queueVersion) {
    throw new AppError('STALE_QUEUE', 'Queue version mismatch; refetch the queue and retry', [
      { field: 'queueVersion', issue: 'stale', expected: String(shift.queueVersion) },
    ]);
  }

  // Friendly pre-validation against the current non-emergency WAITING set (422).
  const prePool = await db.queueEntry.findMany({
    where: { shiftId: shift.id, status: 'WAITING', isEmergency: false },
    orderBy: [{ position: 'asc' }, { checkedInAt: 'asc' }],
    select: { id: true },
  });
  assertExactReorderSet(input.orderedEntryIds, prePool.map((r) => r.id));

  const result = await runQueueTx(db, async (tx) => {
    await lockShift(tx, shift.id);

    // CONV-05/API-07: re-check the OCC version UNDER the row lock. The pre-check
    // above is a friendly 409 only — two reorders passing it concurrently must
    // still serialize here, and the loser must surface STALE_QUEUE (not silently
    // apply last-writer-wins over the winner's order).
    const locked = await tx.shift.findUniqueOrThrow({ where: { id: shift.id }, select: { queueVersion: true } });
    if (locked.queueVersion !== input.lastSeenQueueVersion) {
      throw new AppError('STALE_QUEUE', 'Queue version mismatch; refetch the queue and retry', [
        { field: 'queueVersion', issue: 'stale', expected: String(locked.queueVersion) },
      ]);
    }

    // Re-read under the row lock and re-validate (defense in depth under OCC).
    const pool = await tx.queueEntry.findMany({
      where: { shiftId: shift.id, status: 'WAITING', isEmergency: false },
      orderBy: [{ position: 'asc' }, { checkedInAt: 'asc' }],
      select: { id: true, position: true },
    });
    assertExactReorderSet(input.orderedEntryIds, pool.map((r) => r.id));

    const oldPosition = new Map(pool.map((r) => [r.id, r.position]));
    let idx = 1;
    for (const id of input.orderedEntryIds) {
      const moved = oldPosition.get(id) !== idx;
      await tx.queueEntry.update({
        where: { id },
        data: {
          position: idx,
          ...(moved ? { reorderCount: { increment: 1 } } : {}),
        },
      });
      idx += 1;
    }

    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'QUEUE_REORDER',
      entityType: 'Shift',
      entityId: shift.id,
      requestId: randomUUID(),
      beforeState: { order: pool.map((r) => r.id) },
      afterState: { order: [...input.orderedEntryIds] },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { queueVersion };
  });

  // Fresh canonical snapshot (emergencies first, then reordered non-emergency).
  const avg = await readAvgConsultMinutes(db);
  const rows = await db.queueEntry.findMany({
    where: { shiftId: shift.id, status: 'WAITING' },
    orderBy: [{ emergencyFlaggedAt: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }, { checkedInAt: 'asc' }],
    include: { patient: { select: { fullName: true } } },
  });
  const entries = rows.map((row) =>
    toSecretQueueEntryDto(toRow(row), {
      estimatedWaitMin: estimateWaitMin(row.position, avg),
      queueVersion: result.queueVersion,
    }),
  );
  return toSecretQueueReorderDto(result.queueVersion, entries);
}
// ---------------------------------------------------------------------------
// BE-203 POST /api/v1/queue/:entryId/emergency  [BOTH]  -> 200 SecretSafe<QueueEntryDto>
// Flag floats the entry to the top emergency block (sorted by flaggedAt ASC).
// Unflag re-inserts among regular WAITING by checkedInAt. Any role (DOCTOR or
// SECRETARY) may unflag at any time per P1-3.
// ---------------------------------------------------------------------------
export async function toggleEmergency(
  entryId: string,
  input: EmergencyToggleInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<QueueEntryDto>> {
  const shift = await getOpenShiftOrThrow(db);
  const entry = await loadQueueEntry(db, entryId);
  if (entry.shiftId !== shift.id) {
    throw new AppError('NOT_FOUND', 'Queue entry not in open shift');
  }
  if (normalizeQueueStatus(entry.status) !== 'WAITING') {
    throw new AppError('ILLEGAL_TRANSITION', 'Only WAITING entries can be flagged/unflagged as emergency');
  }

  // OCC (optional on this endpoint per ticket's minimal body; enforced if present).
  if (input.lastSeenQueueVersion !== undefined && input.lastSeenQueueVersion !== shift.queueVersion) {
    throw new AppError('STALE_QUEUE', 'Queue version mismatch; refetch the queue and retry', [
      { field: 'queueVersion', issue: 'stale', expected: String(shift.queueVersion) },
    ]);
  }

  const now = new Date();

  if (input.isEmergency) {
    const result = await runQueueTx(db, async (tx) => {
      await tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          isEmergency: true,
          emergencyFlaggedAt: now,
          emergencyFlaggedByUserId: actor.userId,
          emergencyReasonCode: input.reasonCode ?? null,
        },
      });
      // Float to the top emergency block, sorted by flaggedAt ASC.
      await renumberWaitingPool(tx, shift.id);
      const refreshed = (await tx.queueEntry.findUnique({
        where: { id: entry.id },
        include: { patient: { select: { fullName: true } } },
      }))!;
      await writeQueueAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'EMERGENCY_FLAG',
        entityId: entry.id,
        requestId: randomUUID(),
        reasonText: input.reasonCode ?? null,
        beforeState: { isEmergency: false },
        afterState: { isEmergency: true, reasonCode: input.reasonCode ?? null, position: refreshed.position },
      });
      const queueVersion = await bumpQueueVersion(tx, shift.id);
      return { entry: refreshed, queueVersion };
    });

    const avg = await readAvgConsultMinutes(db);
    return toSecretQueueEntryDto(toRow(result.entry), {
      estimatedWaitMin: estimateWaitMin(result.entry.position, avg),
      queueVersion: result.queueVersion,
    });
  }

  // ---- Unflag ----
  if (!entry.isEmergency) {
    throw new AppError('ILLEGAL_TRANSITION', 'Entry is not currently flagged as emergency');
  }
  // P1-3: Any secretary can unflag any emergency flag at any time. Grace window and ownership check removed.

  const result = await runQueueTx(db, async (tx) => {
    await tx.queueEntry.update({
      where: { id: entry.id },
      data: {
        isEmergency: false,
        emergencyFlaggedAt: null,
        emergencyFlaggedByUserId: null,
        emergencyReasonCode: null,
      },
    });
    // Re-insert among regular WAITING by original checkedInAt timestamp.
    await renumberWaitingPoolByCheckedInAt(tx, shift.id);
    const refreshed = (await tx.queueEntry.findUnique({
      where: { id: entry.id },
      include: { patient: { select: { fullName: true } } },
    }))!;
    await writeQueueAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'EMERGENCY_UNFLAG',
      entityId: entry.id,
      requestId: randomUUID(),
      beforeState: { isEmergency: true, position: entry.position },
      afterState: { isEmergency: false, position: refreshed.position },
    });
    const queueVersion = await bumpQueueVersion(tx, shift.id);
    return { entry: refreshed, queueVersion };
  });

  const avg = await readAvgConsultMinutes(db);
  return toSecretQueueEntryDto(toRow(result.entry), {
    estimatedWaitMin: estimateWaitMin(result.entry.position, avg),
    queueVersion: result.queueVersion,
  });
}
// ---------------------------------------------------------------------------
// BE-203 GET /api/v1/queue/wait-times?shiftId=  [BOTH]  -> 200 SecretSafe<WaitTimesDto>
// RPS-2: estimatedWaitMin = precedingWaitingCount * avg
//                        + (inConsultation ? max(0, avg - elapsedConsultMin) : 0)
// ---------------------------------------------------------------------------
export async function getWaitTimes(
  query: WaitTimesQuery,
  _actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretWaitTimesDto>>> {
  let shiftId = query.shiftId;
  if (shiftId === undefined) {
    const open = await db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
    shiftId = open?.id;
  }
  const avg = await readAvgConsultMinutes(db);

  if (shiftId === undefined) {
    return toSecretWaitTimesDto(avg, []);
  }

  // Single active consultation (if any) drives the in-consultation remainder term.
  const active = await db.queueEntry.findFirst({
    where: { shiftId, status: 'IN_CONSULTATION' },
    select: { calledAt: true },
  });
  const inConsultation = active !== null;
  const now = new Date();
  const elapsedConsultMin =
    active !== null && active.calledAt !== null
      ? Math.max(0, (now.getTime() - active.calledAt.getTime()) / 60_000)
      : 0;

  // Canonical ordered WAITING pool: emergencies by flagged time, then regular by position.
  const pool = await loadOrderedWaitingPool(db, shiftId);
  const items: WaitTimeItemDto[] = pool.map((row, index) => ({
    entryId: row.id,
    precedingCount: index,
    estimatedWaitMin: computeEstimatedWaitMin({
      precedingWaitingCount: index,
      avgConsultDurationMin: avg,
      inConsultation,
      elapsedConsultMin,
    }),
  }));

  return toSecretWaitTimesDto(avg, items);
}








