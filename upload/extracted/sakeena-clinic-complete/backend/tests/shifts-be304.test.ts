import assert from 'node:assert/strict';
import { AppError } from '../src/common/errors/AppError.js';
import { isSecretSafe } from '../src/common/types/secretSafe.js';
import {
  deriveShiftResult,
  computeExpectedCash,
  formatInvariantFailures,
} from '../src/modules/cashier-shift/reconciliation.service.js';
import {
  toSecretPettyExpenseDto,
  toSecretShiftCloseDto,
  toSecretShiftOpenDto,
  toSecretShiftSummaryDto,
  toSecretShiftViewDto,
  type ShiftRow,
} from '../src/modules/cashier-shift/shift.dto.js';
import {
  integrityCheckSchema,
  pettyCreateSchema,
  shiftAckSchema,
  shiftCloseSchema,
  shiftOpenSchema,
} from '../src/modules/cashier-shift/shift.validators.js';
import { closeShift, reopenShift } from '../src/modules/cashier-shift/shift.service.js';
import { ensureAutoShift } from '../src/modules/cashier-shift/shift.support.js';

// BE-304/305/306 acceptance: new AppError codes carry the contract status.
{
  assert.equal(new AppError('SHIFT_NOT_OPEN', 'x').statusCode, 409, 'SHIFT_NOT_OPEN must be 409');
  assert.equal(new AppError('SHIFT_ALREADY_OPEN', 'x').statusCode, 409, 'SHIFT_ALREADY_OPEN must be 409');
  assert.equal(new AppError('INVARIANT_VIOLATION', 'x').statusCode, 409, 'INVARIANT_VIOLATION must be 409');
}

// BE-304 petty validator: amount > 0, direction enum, description 1..300.
{
  const base = { amountMinor: 500, direction: 'EXPENSE', category: 'Supplies', description: 'Detergent refill' };
  assert.equal(pettyCreateSchema.safeParse(base).success, true, 'minimal EXPENSE petty valid');
  assert.equal(pettyCreateSchema.safeParse({ ...base, direction: 'INJECTION' }).success, true, 'INJECTION valid');
  assert.equal(pettyCreateSchema.safeParse({ ...base, amountMinor: 0 }).success, false, 'amount 0 rejected');
  assert.equal(pettyCreateSchema.safeParse({ ...base, amountMinor: -5 }).success, false, 'negative rejected');
  assert.equal(pettyCreateSchema.safeParse({ ...base, amountMinor: 12.5 }).success, false, 'non-integer rejected');
  assert.equal(pettyCreateSchema.safeParse({ ...base, description: '   ' }).success, false, 'blank desc rejected');
  assert.equal(
    pettyCreateSchema.safeParse({ ...base, description: 'x'.repeat(301) }).success,
    false,
    'description > 300 rejected',
  );
  assert.equal(pettyCreateSchema.safeParse({ ...base, direction: 'REFUND' }).success, false, 'bad direction out');
  assert.equal(pettyCreateSchema.safeParse({ ...base, category: '' }).success, false, 'blank category rejected');
  assert.equal(pettyCreateSchema.safeParse({ ...base, extra: 1 }).success, false, 'strict body, no unknown keys');
  assert.equal(pettyCreateSchema.safeParse({ ...base, receiptRef: 'R-1' }).success, true, 'receiptRef accepted');
}

// BE-305 open/close validators: blind count, non-negative, force handshake.
{
  assert.equal(shiftOpenSchema.safeParse({ openingCountMinor: 0 }).success, true, 'zero opening count valid');
  assert.equal(shiftOpenSchema.safeParse({ openingCountMinor: 25000 }).success, true, 'positive opening valid');
  assert.equal(shiftOpenSchema.safeParse({ openingCountMinor: -1 }).success, false, 'negative opening rejected');
  assert.equal(shiftOpenSchema.safeParse({ openingCountMinor: 1.5 }).success, false, 'non-integer opening out');
  assert.equal(
    shiftOpenSchema.safeParse({ openingCountMinor: 100, businessDate: '2026-10-09' }).success,
    true,
    'ISO businessDate accepted',
  );
  assert.equal(
    shiftOpenSchema.safeParse({ openingCountMinor: 100, businessDate: '09/10/2026' }).success,
    false,
    'non-ISO businessDate rejected',
  );
  assert.equal(shiftCloseSchema.safeParse({ actualCountedMinor: 0 }).success, true, 'zero count valid');
  assert.equal(shiftCloseSchema.safeParse({ actualCountedMinor: -1 }).success, false, 'negative count rejected');
  assert.equal(
    shiftCloseSchema.safeParse({ actualCountedMinor: 100, force: true }).success,
    false,
    'force without forceReason rejected',
  );
  assert.equal(
    shiftCloseSchema.safeParse({ actualCountedMinor: 100, forceReason: 'a valid reason here' }).success,
    false,
    'forceReason without force rejected',
  );
  assert.equal(
    shiftCloseSchema.safeParse({ actualCountedMinor: 100, force: true, forceReason: 'short' }).success,
    false,
    'forceReason < 10 chars rejected',
  );
  assert.equal(
    shiftCloseSchema.safeParse({ actualCountedMinor: 100, force: true, forceReason: 'Doctor reviewed backlog' })
      .success,
    true,
    'doctor force handshake valid',
  );
}

// BE-305 ack validator: note optional at schema level (mandatory-by-variance
// is enforced in the service); schema still floors note length at 10.
{
  assert.equal(shiftAckSchema.safeParse({}).success, true, 'empty ack valid (zero-variance path)');
  assert.equal(shiftAckSchema.safeParse({ note: 'short' }).success, false, 'short ack note rejected');
  assert.equal(shiftAckSchema.safeParse({ note: 'Counted twice, verified surplus' }).success, true, 'long note valid');
  assert.equal(integrityCheckSchema.safeParse({ shiftId: 's1' }).success, true, 'integrity probe valid');
  assert.equal(integrityCheckSchema.safeParse({}).success, false, 'integrity probe needs shiftId');
}

// BE-305 blind count (CONV-06 / DB-10 / C-12): an OPEN shift never leaks
// expected cash, actual count, difference, or result. Rule lives in mapper.
{
  const openRow: ShiftRow = {
    id: 'shift-open-1',
    businessDate: new Date('2026-10-09T00:00:00.000Z'),
    status: 'OPEN',
    openingFloatMinor: 20000,
    openingCarryForwardMinor: 20000,
    openingDiscrepancyMinor: 0,
    queueVersion: 3,
    expectedCashMinor: 99999,
    actualCountedMinor: 99999,
    differenceMinor: 7,
    result: 'SURPLUS',
    integrityCheckPassed: null,
    openedByUserId: 'u-doc-1',
    closedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  const blind = toSecretShiftViewDto(openRow, true);
  assert.equal(blind.expectedCashMinor, null, 'OPEN view hides expected');
  assert.equal(blind.actualCountedMinor, null, 'OPEN view hides actual');
  assert.equal(blind.differenceMinor, null, 'OPEN view hides difference');
  assert.equal(blind.result, null, 'OPEN view hides result');
  assert.equal(blind.integrityCheckPassed, null, 'OPEN view hides flag');
  assert.equal(isSecretSafe(blind), true, 'OPEN view stays branded');
  assert.equal(blind.openingFloatMinor, 20000, 'opening float is not secret');
  const closed = toSecretShiftViewDto({ ...openRow, status: 'CLOSED' }, false);
  assert.equal(closed.expectedCashMinor, 99999, 'CLOSED reveals expected');
  assert.equal(closed.differenceMinor, 7, 'CLOSED reveals difference');
  assert.equal(closed.result, 'SURPLUS', 'CLOSED reveals result');
}

// OPEN summary: operational counts only, every cash figure null.
{
  const openShift: ShiftRow = {
    id: 'shift-open-2',
    businessDate: new Date('2026-10-09T00:00:00.000Z'),
    status: 'OPEN',
    openingFloatMinor: 20000,
    openingCarryForwardMinor: 20000,
    openingDiscrepancyMinor: 0,
    queueVersion: 1,
    expectedCashMinor: null,
    actualCountedMinor: null,
    differenceMinor: null,
    result: null,
    integrityCheckPassed: null,
    openedByUserId: 'u-doc-1',
    closedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  const blindSum = toSecretShiftSummaryDto({
    shift: openShift,
    totalServed: 4,
    grossCollectedMinor: 50000,
    cashCollectedMinor: 40000,
    otherCollectedMinor: 10000,
    reversalsMinor: 0,
    pettyExpenseMinor: 500,
    pettyInjectionMinor: 2000,
    discountTotalMinor: 0,
    discountCount: 0,
    writeOffTotalMinor: 0,
    complimentaryCount: 0,
    newDebtTotalMinor: 0,
  });
  assert.equal(blindSum.grossCollectedMinor, null, 'OPEN hides gross');
  assert.equal(blindSum.cashCollectedMinor, null, 'OPEN hides cash');
  assert.equal(blindSum.byMethod, null, 'OPEN hides byMethod');
  assert.equal(blindSum.expectedCashMinor, null, 'OPEN hides expected');
  assert.equal(blindSum.totalServed, 4, 'OPEN keeps counts');
  const fullSum = toSecretShiftSummaryDto({
    shift: { ...openShift, status: 'CLOSED' },
    totalServed: 4,
    grossCollectedMinor: 50000,
    cashCollectedMinor: 40000,
    otherCollectedMinor: 10000,
    reversalsMinor: 0,
    pettyExpenseMinor: 500,
    pettyInjectionMinor: 2000,
    discountTotalMinor: 0,
    discountCount: 0,
    writeOffTotalMinor: 0,
    complimentaryCount: 0,
    newDebtTotalMinor: 0,
  });
  assert.equal(fullSum.grossCollectedMinor, 50000, 'CLOSED reveals gross');
  assert.deepEqual(fullSum.byMethod, { CASH: 40000, OTHER: 10000 }, 'byMethod split');
  assert.equal(fullSum.pettyTotalMinor, 2500, 'petty total exact');
}

// INV-8 result sign: BALANCED iff exactly zero. Close/open envelopes.
{
  assert.equal(deriveShiftResult(0), 'BALANCED', 'zero is BALANCED');
  assert.equal(deriveShiftResult(1), 'SURPLUS', 'plus is SURPLUS');
  assert.equal(deriveShiftResult(-1), 'DEFICIT', 'minus is DEFICIT');
  const closeDto = toSecretShiftCloseDto({
    shiftId: 's1',
    expectedCashMinor: 50000,
    actualCountedMinor: 50000,
    differenceMinor: 0,
    result: 'BALANCED',
    integrityCheckPassed: true,
    queueVersion: 9,
  });
  assert.equal(closeDto.result, 'BALANCED', 'close carries result');
  assert.equal(isSecretSafe(closeDto), true, 'close is branded');
  const openDto = toSecretShiftOpenDto({
    id: 's1',
    businessDate: new Date('2026-10-09T00:00:00.000Z'),
    openingDiscrepancyMinor: 250,
    queueVersion: 0,
  });
  assert.equal(openDto.openingDiscrepancyMinor, 250, 'open carries discrepancy');
  assert.equal('expectedCashMinor' in openDto, false, 'open never has expected');
}

// BE-304 petty DTO branded; BE-306 failure strings are CODE-colon-detail.
{
  const petty = toSecretPettyExpenseDto({
    id: 'p1',
    shiftId: 's1',
    direction: 'EXPENSE',
    amountMinor: 750,
    category: 'Supplies',
    description: 'Detergent refill',
    receiptRef: null,
    actorUserId: 'u-sec-1',
    createdAt: new Date('2026-10-09T10:00:00.000Z'),
  });
  assert.equal(petty.direction, 'EXPENSE', 'direction survives mapper');
  assert.equal(isSecretSafe(petty), true, 'petty branded');
  const failures = formatInvariantFailures({
    shiftId: 's1',
    passed: false,
    failures: [{ code: 'INV-1', detail: 'invoice i1 off by 5', entities: ['i1'] }],
  });
  assert.deepEqual(failures, ['INV-1: invoice i1 off by 5'], 'CODE detail shape');
}

// Drawer formula via stub tx: opening + CASH CHARGE - CASH REVERSAL
// - EXPENSE + INJECTION. EXPENSE deducts, INJECTION adds.
{
  type Tx = Parameters<typeof computeExpectedCash>[0];
  type PettyStub = { amountMinor: number; direction: 'EXPENSE' | 'INJECTION' };
  const stubTx = (charge: number | null, reversal: number | null, petty: PettyStub[]): Tx => {
    const tx = {
      receipt: {
        aggregate: (args: { where: { type: string } }): Promise<{ _sum: { amountMinor: number | null } }> => {
          if (args.where.type === 'CHARGE') return Promise.resolve({ _sum: { amountMinor: charge } });
          return Promise.resolve({ _sum: { amountMinor: reversal } });
        },
      },
      pettyExpense: {
        findMany: (): Promise<PettyStub[]> => Promise.resolve(petty),
      },
    };
    return tx as unknown as Tx;
  };
  const exp = await computeExpectedCash(stubTx(30000, 0, [{ amountMinor: 1500, direction: 'EXPENSE' }]), 's1', 20000);
  assert.equal(exp.expectedCashMinor, 20000 + 30000 - 0 - 1500, 'EXPENSE deducts');
  const inj = await computeExpectedCash(stubTx(30000, 0, [{ amountMinor: 5000, direction: 'INJECTION' }]), 's1', 20000);
  assert.equal(inj.expectedCashMinor, 20000 + 30000 + 5000, 'INJECTION adds');
  const mix = await computeExpectedCash(
    stubTx(30000, 2000, [
      { amountMinor: 1500, direction: 'EXPENSE' },
      { amountMinor: 5000, direction: 'INJECTION' },
    ]),
    's1',
    20000,
  );
  assert.equal(mix.expectedCashMinor, 20000 + 30000 - 2000 - 1500 + 5000, 'mixed exact');
  assert.equal(mix.pettyExpenseMinor, 1500, 'expense leg');
  assert.equal(mix.pettyInjectionMinor, 5000, 'injection leg');
}

// ===========================================================================
// P1-5 — Free day closing with waiting patients (Secretary can close with reason)
// ===========================================================================
{
  assert.equal(
    shiftCloseSchema.safeParse({ actualCountedMinor: 50000, reason: '2 waiting patients postponed' }).success,
    true,
    'reason accepted in shiftCloseSchema',
  );

  const fakeShift = {
    id: 'shift-1',
    businessDate: new Date('2026-10-15T00:00:00Z'),
    status: 'OPEN',
    openingFloatMinor: 10000,
    queueVersion: 5,
    actualCountedMinor: null,
    expectedCashMinor: null,
    differenceMinor: null,
    result: null,
    integrityCheckPassed: null,
    closedByUserId: null,
    closedAt: null,
    closeIdempotencyKey: null,
    reviewNote: null,
    reviewedByUserId: null,
    reviewedAt: null,
  };

  const auditEvents: Array<Record<string, unknown>> = [];

  const fakeDb = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeDb),
    shift: {
      findUnique: async () => fakeShift,
      findUniqueOrThrow: async () => fakeShift,
      update: async (args: { data: Record<string, unknown> }) => {
        Object.assign(fakeShift, args.data);
        return fakeShift;
      },
    },
    queueEntry: {
      count: async () => 2, // 2 waiting patients!
      findMany: async () => [],
    },
    receipt: {
      aggregate: async () => ({ _sum: { amountMinor: 0 } }),
      findMany: async () => [],
    },
    pettyExpense: {
      findMany: async () => [],
    },
    invoice: {
      findMany: async () => [],
    },
    auditEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditEvents.push(args.data);
        return args.data;
      },
      findMany: async () => [],
    },
    clinicSettings: {
      findUnique: async () => null,
    },
  };

  // 1. Secretary closes with 2 waiting patients and NO reason -> rejected with UNPROCESSABLE
  await assert.rejects(
    () =>
      closeShift(
        'shift-1',
        { actualCountedMinor: 10000 },
        { userId: 'u-sec', role: 'SECRETARY' },
        'idemp-close-1',
        fakeDb as any,
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'UNPROCESSABLE' &&
      err.message.includes('2 queue entries are still WAITING or IN_CONSULTATION'),
    'Closing with open entries and no reason must fail',
  );

  // 2. Secretary closes with 2 waiting patients AND a reason -> SUCCEEDS!
  const closeResult = await closeShift(
    'shift-1',
    {
      actualCountedMinor: 10000,
      reason: 'انتهى الدوام واعتذر المرضى عن الانتظار',
    },
    { userId: 'u-sec', role: 'SECRETARY' },
    'idemp-close-2',
    fakeDb as any,
  );

  assert.equal(closeResult.shiftId, 'shift-1');
  assert.equal(closeResult.status, 'CLOSED');
  assert.equal(fakeShift.status, 'CLOSED');
  assert.equal(fakeShift.closedByUserId, 'u-sec');
  assert.equal(fakeShift.reviewNote, 'انتهى الدوام واعتذر المرضى عن الانتظار');

  // 3. Verify audit trail records the secretary role and reason
  const closeAudit = auditEvents.find((a) => a.action === 'SHIFT_CLOSE');
  assert.ok(closeAudit, 'SHIFT_CLOSE audit recorded');
  assert.equal(closeAudit.actorUserId, 'u-sec');
  assert.equal(closeAudit.actorRole, 'SECRETARY');
  assert.equal(closeAudit.reasonText, 'انتهى الدوام واعتذر المرضى عن الانتظار');
  assert.equal((closeAudit.afterState as Record<string, unknown>).closedWithOpenEntries, true);
  assert.equal((closeAudit.afterState as Record<string, unknown>).openEntriesCount, 2);
}

// ---------------------------------------------------------------------------
// P1-7: Shift system simplification: silent auto-open and day reopen
// ---------------------------------------------------------------------------
{
  let shiftRow: any = null;
  const auditList: any[] = [];

  const mockDb: any = {
    shift: {
      findFirst: async (args: any) => {
        if (args?.where?.status === 'OPEN') {
          return shiftRow && shiftRow.status === 'OPEN' ? shiftRow : null;
        }
        return shiftRow;
      },
      findUnique: async () => shiftRow,
      create: async (args: any) => {
        shiftRow = {
          id: 'shift-auto-1',
          businessDate: args.data.businessDate,
          status: 'OPEN',
          openingFloatMinor: args.data.openingFloatMinor,
          openingCarryForwardMinor: args.data.openingCarryForwardMinor,
          openingDiscrepancyMinor: args.data.openingDiscrepancyMinor,
          queueVersion: 0,
          openedByUserId: args.data.openedByUserId,
          createdAt: new Date(),
        };
        return shiftRow;
      },
      update: async (args: any) => {
        Object.assign(shiftRow, args.data);
        return shiftRow;
      },
    },
    user: {
      findFirst: async () => ({ id: 'u-auto-sec' }),
    },
    auditEvent: {
      create: async (args: any) => {
        auditList.push(args.data);
        return args.data;
      },
    },
  };

  // 1. When no open shift exists, ensureAutoShift creates backing shift silently
  const autoShift = await ensureAutoShift(mockDb, 'u-auto-sec');
  assert.equal(autoShift.id, 'shift-auto-1');
  assert.equal(autoShift.status, 'OPEN');
  assert.equal(shiftRow.status, 'OPEN');

  // 2. Close the shift
  shiftRow.status = 'CLOSED';
  shiftRow.closedAt = new Date();
  shiftRow.closedByUserId = 'u-auto-sec';

  // 3. Reopen the shift freely
  const reopenResult = await reopenShift('shift-auto-1', { userId: 'u-auto-sec', role: 'SECRETARY' }, mockDb);
  assert.equal(reopenResult.shiftId, 'shift-auto-1');
  assert.equal(reopenResult.status, 'OPEN');
  assert.equal(shiftRow.status, 'OPEN');
  assert.equal(shiftRow.closedAt, null);

  const reopenAudit = auditList.find((a) => a.action === 'SHIFT_OPEN' && a.entityId === 'shift-auto-1');
  assert.ok(reopenAudit, 'SHIFT_OPEN audit recorded on reopen');
  assert.equal(reopenAudit.reasonText, 'إعادة فتح اليوم');
}

// eslint-disable-next-line no-console
console.log('shifts-be304: shift lifecycle + closing + P1-7 auto-shift/reopen tests passed.');


