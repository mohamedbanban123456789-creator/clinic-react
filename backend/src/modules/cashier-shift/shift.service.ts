import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import type { SecretSafe } from '../../common/types/secretSafe.js';
import {
  toSecretPettyExpenseDto,
  toSecretPettyListDto,
  toSecretShiftAckDto,
  toSecretShiftCloseDto,
  toSecretIntegrityCheckDto,
  toSecretShiftOpenDto,
  toSecretShiftSummaryDto,
  toSecretShiftViewDto,
  type PettyExpenseRow,
  type ShiftRow,
} from './shift.dto.js';
import {
  assertShiftOpen,
  deriveOpeningCarryForward,
  isUniqueViolation,
  loadShiftOrThrow,
  lockShift,
  parseBusinessDate,
  toBusinessDate,
  writeShiftAudit,
  writeShiftAuditStandalone,
} from './shift.support.js';
import {
  checkShiftInvariants,
  computeExpectedCash,
  deriveShiftResult,
  formatInvariantFailures,
  type InvariantReport,
} from './reconciliation.service.js';
import type {
  IntegrityCheckInput,
  PettyCreateInput,
  PettyListQuery,
  ShiftAckInput,
  ShiftCloseInput,
  ShiftOpenInput,
} from './shift.validators.js';

export interface Actor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

function toShiftRow(shift: Awaited<ReturnType<typeof loadShiftOrThrow>>): ShiftRow {
  return {
    id: shift.id,
    businessDate: shift.businessDate,
    status: shift.status,
    openingFloatMinor: shift.openingFloatMinor,
    openingCarryForwardMinor: shift.openingCarryForwardMinor,
    openingDiscrepancyMinor: shift.openingDiscrepancyMinor,
    queueVersion: shift.queueVersion,
    expectedCashMinor: shift.expectedCashMinor,
    actualCountedMinor: shift.actualCountedMinor,
    differenceMinor: shift.differenceMinor,
    result: shift.result,
    integrityCheckPassed: shift.integrityCheckPassed,
    openedByUserId: shift.openedByUserId,
    closedAt: shift.closedAt,
    reviewedByUserId: shift.reviewedByUserId,
    reviewedAt: shift.reviewedAt,
    reviewNote: shift.reviewNote,
  };
}

function toPettyRow(row: {
  id: string;
  shiftId: string;
  direction: 'EXPENSE' | 'INJECTION';
  amountMinor: number;
  category: string;
  description: string;
  receiptRef: string | null;
  actorUserId: string;
  createdAt: Date;
}): PettyExpenseRow {
  return {
    id: row.id,
    shiftId: row.shiftId,
    direction: row.direction,
    amountMinor: row.amountMinor,
    category: row.category,
    description: row.description,
    receiptRef: row.receiptRef,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

// ===========================================================================
// BE-305 POST /shifts/open  [BOTH]  -> 201 SecretSafe<ShiftOpenDto>
// Single-OPEN-shift invariant (clinic-wide): 409 SHIFT_ALREADY_OPEN.
// The carry-forward is DERIVED server-side; the caller only supplies the blind
// physical count, so the expected total can never be anchored at open either.
// ===========================================================================
export async function openShift(
  input: ShiftOpenInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftOpenDto>>> {
  const businessDate =
    input.businessDate !== undefined ? parseBusinessDate(input.businessDate) : toBusinessDate(new Date());

  // Friendly pre-check for the common case (app-level single-OPEN invariant).
  const alreadyOpen = await db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
  if (alreadyOpen !== null) {
    throw new AppError('SHIFT_ALREADY_OPEN', 'A shift is already OPEN clinic-wide; close it before opening another', [
      { field: 'status', issue: 'an OPEN shift exists', expected: 'exactly one OPEN shift clinic-wide' },
    ]);
  }

  const carry = await deriveOpeningCarryForward(db, businessDate);
  const openingDiscrepancyMinor = input.openingCountMinor - carry.carryForwardMinor;

  try {
    const created = await db.shift.create({
      data: {
        businessDate,
        status: 'OPEN',
        // Plan §1(b): the float base is the PHYSICAL count so the close drawer
        // formula reconciles exactly; the carry-forward variance is recorded
        // separately in openingDiscrepancyMinor, never silently absorbed.
        openingFloatMinor: input.openingCountMinor,
        openingCarryForwardMinor: carry.carryForwardMinor,
        openingDiscrepancyMinor,
        queueVersion: 0,
        openedByUserId: actor.userId,
      },
      select: { id: true, businessDate: true, openingDiscrepancyMinor: true, queueVersion: true },
    });

    await writeShiftAuditStandalone(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SHIFT_OPEN',
      entityType: 'Shift',
      entityId: created.id,
      idempotencyKey,
      afterState: {
        businessDate: created.businessDate.toISOString(),
        openingFloatMinor: input.openingCountMinor,
        openingCarryForwardMinor: carry.carryForwardMinor,
        openingDiscrepancyMinor,
        carryForwardSource: carry.source,
      },
    });

    return toSecretShiftOpenDto(created);
  } catch (err) {
    if (isUniqueViolation(err, 'business_date')) {
      throw new AppError('SHIFT_ALREADY_OPEN', 'A shift already exists for this business date');
    }
    // Race authority: uq_shifts_single_open (migration 0010) — two concurrent
    // opens on different business dates must still yield exactly one OPEN shift.
    if (isUniqueViolation(err, 'uq_shifts_single_open') || isUniqueViolation(err, 'status')) {
      throw new AppError('SHIFT_ALREADY_OPEN', 'A shift is already OPEN clinic-wide; close it before opening another', [
        { field: 'status', issue: 'an OPEN shift exists', expected: 'exactly one OPEN shift clinic-wide' },
      ]);
    }
    throw err;
  }
}

// ===========================================================================
// BE-304 POST /shifts/:id/petty  [BOTH]  -> 201 SecretSafe<PettyExpenseDto>
// EXPENSE pays cash out of the drawer (reduces expected); INJECTION tops it up
// (increases expected). Requires an OPEN shift; runs under lockShift (C-8).
// ===========================================================================
export async function createPetty(
  shiftId: string,
  input: PettyCreateInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretPettyExpenseDto>>> {
  const shift = await loadShiftOrThrow(db, shiftId);
  assertShiftOpen(shift.status, shiftId);

  try {
    const result = await db.$transaction(async (tx) => {
      await lockShift(tx, shiftId);

      const locked = await tx.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { status: true } });
      assertShiftOpen(locked.status, shiftId);

      const petty = await tx.pettyExpense.create({
        data: {
          shiftId,
          amountMinor: input.amountMinor,
          description: input.description,
          category: input.category,
          direction: input.direction,
          ...(input.receiptRef !== undefined ? { receiptRef: input.receiptRef } : {}),
          actorUserId: actor.userId,
          idempotencyKey,
        },
      });

      await writeShiftAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'PETTY_CREATE',
        entityType: 'PettyExpense',
        entityId: petty.id,
        idempotencyKey,
        reasonText: `${input.direction}: ${input.description}`,
        afterState: {
          direction: input.direction,
          amountMinor: input.amountMinor,
          category: input.category,
          receiptRef: petty.receiptRef,
        },
      });

      return petty;
    });

    return toSecretPettyExpenseDto(toPettyRow(result));
  } catch (err) {
    if (isUniqueViolation(err, 'idempotency_key')) {
      throw new AppError('CONFLICT', 'A petty operation with this Idempotency-Key already exists for this shift');
    }
    throw err;
  }
}

// ===========================================================================
// BE-304 GET /shifts/:id/petty  [BOTH]  -> 200 SecretSafe<PettyListDto>
// ===========================================================================
export async function listPetty(
  shiftId: string,
  query: PettyListQuery,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretPettyListDto>>> {
  await loadShiftOrThrow(db, shiftId);

  const limit = query.limit ?? 50;
  const rows = await db.pettyExpense.findMany({
    where: { shiftId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;

  return toSecretPettyListDto(shiftId, page.map((r) => toSecretPettyExpenseDto(toPettyRow(r))), nextCursor);
}

// ===========================================================================
// BE-305 POST /shifts/:id/close  [BOTH]  -> 200 SecretSafe<ShiftCloseDto>
// BLIND two-phase close (DB-10 / CONV-06 / API-07) + INV gate (BE-306).
//
// Order inside the single lockShift transaction:
//   1. re-assert OPEN                       -> 409 SHIFT_NOT_OPEN
//   2. open WAITING/IN_CONSULTATION entries  -> 422 unless force+DOCTOR
//   3. compute expectedCash (drawer formula) -> BE-306 computeExpectedCash
//   4. difference = actual - expected; result = sign(difference)
//   5. run INV-1..INV-10                     -> 409 INVARIANT_VIOLATION unless forced
//   6. persist CLOSED, write SHIFT_CLOSE audit
// The expected total is revealed ONLY in the 200 body, after actualCounted is
// already persisted, so it cannot anchor the count.
// ===========================================================================
export async function closeShift(
  shiftId: string,
  input: ShiftCloseInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftCloseDto>>> {
  const existing = await loadShiftOrThrow(db, shiftId);
  if (existing.status !== 'OPEN') {
    throw new AppError('SHIFT_NOT_OPEN', `Shift ${shiftId} is already ${existing.status}`, [
      { field: 'status', issue: 'shift is not OPEN', expected: "status = 'OPEN'" },
    ]);
  }

  const effectiveReason = input.reason ?? input.closeReason ?? input.forceReason;
  const force = input.force === true || effectiveReason !== undefined;

  // P1-5: The secretary or doctor can close the day with waiting patients or discrepancies
  // when a reason is provided. The doctor-only force restriction has been removed.

  const result = await db.$transaction(async (tx) => {
    await lockShift(tx, shiftId);

    // Re-read under the row lock: another writer may have closed it meanwhile.
    const locked = await tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
    if (locked.status !== 'OPEN') {
      throw new AppError('SHIFT_NOT_OPEN', `Shift ${shiftId} is already ${locked.status}`);
    }

    // (2) Open queue entries block an orderly close unless a reason is provided.
    const openEntries = await tx.queueEntry.count({
      where: { shiftId, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
    });
    if (openEntries > 0 && !effectiveReason) {
      throw new AppError(
        'UNPROCESSABLE',
        `${openEntries} queue entr${openEntries === 1 ? 'y is' : 'ies are'} still WAITING or IN_CONSULTATION`, [
          {
            field: 'reason',
            issue: `${openEntries} open queue entr${openEntries === 1 ? 'y' : 'ies'} remain`,
            expected: 'provide a reason to close with open queue entries',
          },
        ],
      );
    }

    // (3) Drawer formula — the single source of drawer math (BE-306).
    const drawer = await computeExpectedCash(tx, shiftId, locked.openingFloatMinor);
    const expectedCashMinor = drawer.expectedCashMinor;

    // (4) Difference + result.
    const differenceMinor = input.actualCountedMinor - expectedCashMinor;
    const shiftResult = deriveShiftResult(differenceMinor);

    // (5) Invariants gate (INV-1..INV-10 + APPX-D-3..6 via BE-306).
    const report: InvariantReport = await checkShiftInvariants(shiftId, tx);
    if (!report.passed && !effectiveReason) {
      const details = report.failures.map((f) => ({
        field: f.code,
        issue: f.detail,
        expected: 'resolve the discrepancy, or provide a reason to close',
      }));
      throw new AppError('INVARIANT_VIOLATION', `Shift failed ${report.failures.length} reconciliation invariant(s)`, details);
    }

    // (6) Persist CLOSED. Expected is written here — the ONLY reveal point.
    const closed = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        expectedCashMinor,
        actualCountedMinor: input.actualCountedMinor,
        differenceMinor,
        result: shiftResult,
        integrityCheckPassed: report.passed && openEntries === 0,
        closedByUserId: actor.userId,
        closedAt: new Date(),
        closeIdempotencyKey: idempotencyKey,
        queueVersion: locked.queueVersion + 1,
        ...(effectiveReason !== undefined
          ? {
              reviewNote: effectiveReason,
              reviewedByUserId: actor.userId,
              reviewedAt: new Date(),
            }
          : {}),
      },
      select: { id: true, queueVersion: true },
    });

    await writeShiftAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SHIFT_CLOSE',
      entityType: 'Shift',
      entityId: shiftId,
      idempotencyKey,
      reasonText: effectiveReason ?? null,
      beforeState: {
        status: 'OPEN',
        openingFloatMinor: locked.openingFloatMinor,
        openQueueEntries: openEntries,
      },
      afterState: {
        status: 'CLOSED',
        expectedCashMinor,
        actualCountedMinor: input.actualCountedMinor,
        differenceMinor,
        result: shiftResult,
        forced: force,
        closedWithOpenEntries: openEntries > 0,
        openEntriesCount: openEntries,
        ...(effectiveReason !== undefined ? { forceReason: effectiveReason } : {}),
        invariantFailures: formatInvariantFailures(report),
        drawer: {
          cashChargeMinor: drawer.cashChargeMinor,
          cashReversalMinor: drawer.cashReversalMinor,
          pettyExpenseMinor: drawer.pettyExpenseMinor,
          pettyInjectionMinor: drawer.pettyInjectionMinor,
        },
      },
    });

    return {
      shiftId: closed.id,
      expectedCashMinor,
      actualCountedMinor: input.actualCountedMinor,
      differenceMinor,
      result: shiftResult,
      integrityCheckPassed: report.passed,
      queueVersion: closed.queueVersion,
    };
  });

  return toSecretShiftCloseDto(result);
}

// ===========================================================================
// BE-305 GET /shifts/current  [BOTH]  -> 200 SecretSafe<ShiftViewDto> | 404
// Blind-aware: while OPEN the expected/difference/result fields are null.
// ===========================================================================
export async function getCurrentShift(
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftViewDto>>> {
  const shift = await db.shift.findFirst({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });
  if (shift === null) throw AppError.notFound('No open shift');
  return toSecretShiftViewDto(toShiftRow(shift), shift.status === 'OPEN');
}

// ===========================================================================
// BE-305 GET /shifts/:id  [BOTH]  -> 200 SecretSafe<ShiftViewDto>
// Blind count invariant: expected cash is null while the shift is OPEN.
// ===========================================================================
export async function getShift(
  shiftId: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftViewDto>>> {
  const shift = await loadShiftOrThrow(db, shiftId);
  return toSecretShiftViewDto(toShiftRow(shift), shift.status === 'OPEN');
}

// ===========================================================================
// BE-305 GET /shifts/:id/summary  [BOTH]  -> 200 SecretSafe<ShiftSummaryDto>
// OPEN  -> operational counts only, every cash figure null (blind).
// CLOSED -> full financial breakdown.
// ===========================================================================
export async function getShiftSummary(
  shiftId: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftSummaryDto>>> {
  const shift = await loadShiftOrThrow(db, shiftId);

  const [invoices, receipts, pettyRows, queueAgg, invoiceAgg, writeOffAgg] = await Promise.all([
    db.invoice.findMany({ where: { shiftId }, select: { id: true, status: true, discountMinor: true, writeOffMinor: true, isComplimentary: true, collectedMinor: true, outstandingMinor: true } }),
    db.receipt.findMany({ where: { shiftId }, select: { type: true, amountMinor: true, paymentMethod: true } }),
    db.pettyExpense.findMany({ where: { shiftId }, select: { amountMinor: true, direction: true } }),
    db.queueEntry.count({ where: { shiftId, status: 'COMPLETED' } }),
    db.invoice.aggregate({ where: { shiftId }, _sum: { collectedMinor: true } }),
    db.invoice.aggregate({ where: { shiftId }, _sum: { writeOffMinor: true } }),
  ]);

  let grossCollectedMinor = 0;
  let cashCollectedMinor = 0;
  let otherCollectedMinor = 0;
  let reversalsMinor = 0;
  for (const r of receipts) {
    if (r.type === 'REVERSAL') {
      reversalsMinor += r.amountMinor;
      continue;
    }
    grossCollectedMinor += r.amountMinor;
    if (r.paymentMethod === 'CASH') cashCollectedMinor += r.amountMinor;
    else otherCollectedMinor += r.amountMinor;
  }

  let pettyExpenseMinor = 0;
  let pettyInjectionMinor = 0;
  for (const p of pettyRows) {
    if (p.direction === 'INJECTION') pettyInjectionMinor += p.amountMinor;
    else pettyExpenseMinor += p.amountMinor;
  }

  let discountTotalMinor = 0;
  let discountCount = 0;
  let complimentaryCount = 0;
  let newDebtTotalMinor = 0;
  for (const inv of invoices) {
    if (inv.discountMinor > 0) {
      discountTotalMinor += inv.discountMinor;
      discountCount += 1;
    }
    if (inv.isComplimentary) complimentaryCount += 1;
    if (inv.status === 'UNPAID' || inv.status === 'PARTIAL') newDebtTotalMinor += inv.outstandingMinor;
  }

  return toSecretShiftSummaryDto({
    shift: toShiftRow(shift),
    totalServed: queueAgg,
    grossCollectedMinor: grossCollectedMinor > 0 ? grossCollectedMinor : (invoiceAgg._sum.collectedMinor ?? 0),
    cashCollectedMinor,
    otherCollectedMinor,
    reversalsMinor,
    pettyExpenseMinor,
    pettyInjectionMinor,
    discountTotalMinor,
    discountCount,
    writeOffTotalMinor: writeOffAgg._sum.writeOffMinor ?? 0,
    complimentaryCount,
    newDebtTotalMinor,
  });
}


// ===========================================================================
// BE-305 POST /supervision/shifts/:id/ack  [DOCTOR]  -> 200 SecretSafe<ShiftAckDto>
// Async, non-blocking doctor review of a closed drawer. Records who reviewed it
// and why. When the variance is non-zero the note is MANDATORY (>= 10 chars):
// an unexplained surplus/deficit is exactly the fraud signal supervision exists
// to capture, so a blank note must never satisfy the control.
// ===========================================================================
export async function ackShift(
  shiftId: string,
  input: ShiftAckInput,
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretShiftAckDto>>> {
  if (actor.role !== 'DOCTOR') {
    throw AppError.forbidden('Only a doctor may acknowledge a shift discrepancy');
  }

  const shift = await loadShiftOrThrow(db, shiftId);
  if (shift.status !== 'CLOSED') {
    throw new AppError('SHIFT_NOT_OPEN', `Shift ${shiftId} is ${shift.status}; only a CLOSED shift can be acknowledged`, [
      { field: 'status', issue: 'shift is not CLOSED', expected: "status = 'CLOSED'" },
    ]);
  }

  const variance = shift.differenceMinor ?? 0;
  const note = input.note;
  if (variance !== 0 && (note === undefined || note.trim().length < 10)) {
    throw new AppError('UNPROCESSABLE', 'A review note of at least 10 characters is required when the variance is non-zero', [
      { field: 'note', issue: 'required for a non-zero variance', expected: '10-1000 characters' },
    ]);
  }

  const reviewedAt = new Date();
  const reviewNote = note === undefined ? null : note.trim();

  const updated = await db.shift.update({
    where: { id: shiftId },
    data: {
      reviewedByUserId: actor.userId,
      reviewedAt,
      reviewNote,
    },
    select: { id: true, differenceMinor: true, result: true },
  });

  await writeShiftAuditStandalone(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'SHIFT_ACK',
    entityType: 'Shift',
    entityId: shiftId,
    reasonText: reviewNote,
    afterState: {
      reviewedByUserId: actor.userId,
      reviewedAt: reviewedAt.toISOString(),
      differenceMinor: updated.differenceMinor,
      result: updated.result,
      noteLength: reviewNote === null ? 0 : reviewNote.length,
    },
  });

  return toSecretShiftAckDto({
    shiftId,
    differenceMinor: updated.differenceMinor,
    result: updated.result,
    reviewedByUserId: actor.userId,
    reviewedAt,
    reviewNote,
  });
}

// ===========================================================================
// BE-306 POST /supervision/integrity-check  [DOCTOR]  -> 200 SecretSafe<IntegrityCheckDto>
// On-demand invariant probe. Read-only against the domain; writes exactly one
// INTEGRITY_CHECK_FAILED audit when it fails (INV-10 supervision coverage).
// ===========================================================================
export async function runIntegrityCheck(
  input: IntegrityCheckInput,
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReturnType<typeof toSecretIntegrityCheckDto>>> {
  if (actor.role !== 'DOCTOR') {
    throw AppError.forbidden('Only a doctor may run an on-demand integrity check');
  }

  await loadShiftOrThrow(db, input.shiftId);

  const report = await checkShiftInvariants(input.shiftId, db);
  const failures = formatInvariantFailures(report);

  if (!report.passed) {
    await writeShiftAuditStandalone(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'INTEGRITY_CHECK_FAILED',
      entityType: 'Shift',
      entityId: input.shiftId,
      afterState: { failureCount: failures.length, codes: report.failures.map((f) => f.code) },
    });
  }

  return toSecretIntegrityCheckDto(input.shiftId, report.passed, failures);
}

/** Re-exported so callers need not import two modules for a close-time probe. */
export { checkShiftInvariants, formatInvariantFailures };
export type { InvariantReport };
