import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors/AppError.js';
import { requireRole } from '../src/common/middleware/requireRole.js';
import type { AuthContext } from '../src/common/middleware/authenticate.js';
import {
  cashSummaryQuerySchema,
  discrepanciesQuerySchema,
  discountsQuerySchema,
  exceptionsQuerySchema,
  frontDeskActivityQuerySchema,
  nonCashQuerySchema,
  shiftReadinessQuerySchema,
  supervisionShiftsQuerySchema,
  unsignedNotesQuerySchema,
} from '../src/modules/supervision/supervision.validators.js';
import {
  getDiscounts,
  getExceptions,
  getNonCash,
  getShiftReadiness,
  getUnsignedNotes,
  listSupervisionShifts,
  resolveShift,
} from '../src/modules/supervision/supervision.service.js';

function mockReq(role: 'DOCTOR' | 'SECRETARY'): Request {
  const req = { method: 'GET', originalUrl: '/api/v1/supervision/cash-summary', path: '/' } as Request;
  const auth: AuthContext = { userId: 'u-doc-1', role, tokenVersion: 1, mustChangePassword: false };
  (req as Request & { auth: AuthContext }).auth = auth;
  return req;
}

function mockRes(): Response {
  return { statusCode: 200 } as Response;
}

// ---------------------------------------------------------------------------
// 1. Every supervision route is DOCTOR-gated: SECRETARY gets 403 FORBIDDEN.
// ---------------------------------------------------------------------------
{
  let forwarded: unknown = 'none';
  requireRole('DOCTOR')(mockReq('SECRETARY'), mockRes(), (err?: unknown) => {
    forwarded = err;
  });
  assert.ok(forwarded instanceof AppError);
  assert.equal((forwarded as AppError).code, 'FORBIDDEN');
  assert.equal((forwarded as AppError).statusCode, 403);

  let passed = false;
  requireRole('DOCTOR')(mockReq('DOCTOR'), mockRes(), (err?: unknown) => {
    assert.equal(err, undefined);
    passed = true;
  });
  assert.equal(passed, true);
}

// ---------------------------------------------------------------------------
// 2. Validators: strict, shiftId required where the contract requires it.
// ---------------------------------------------------------------------------
{
  assert.equal(frontDeskActivityQuerySchema.safeParse({}).success, true, 'activity scope optional');
  assert.equal(frontDeskActivityQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(frontDeskActivityQuerySchema.safeParse({ clinicDayId: '2026-10-09' }).success, true);
  assert.equal(frontDeskActivityQuerySchema.safeParse({ shiftId: 's1', extra: 1 }).success, false, 'strict');

  assert.equal(cashSummaryQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(cashSummaryQuerySchema.safeParse({}).success, false, 'cash-summary needs shiftId');
  assert.equal(cashSummaryQuerySchema.safeParse({ shiftId: '' }).success, false);

  assert.equal(supervisionShiftsQuerySchema.safeParse({}).success, true);
  assert.equal(supervisionShiftsQuerySchema.safeParse({ unacked: 'true', varianceOnly: 'true' }).success, true);
  assert.equal(supervisionShiftsQuerySchema.safeParse({ unacked: 'yes' }).success, false);
  assert.equal(supervisionShiftsQuerySchema.safeParse({ unacked: true }).success, false, 'query flags are strings');

  assert.equal(unsignedNotesQuerySchema.safeParse({}).success, true);
  assert.equal(unsignedNotesQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(unsignedNotesQuerySchema.safeParse({ shiftId: 's1', extra: 1 }).success, false, 'strict');

  assert.equal(discountsQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(discountsQuerySchema.safeParse({}).success, false, 'discounts needs shiftId');

  assert.equal(nonCashQuerySchema.safeParse({}).success, true);
  assert.equal(nonCashQuerySchema.safeParse({ clinicDayId: '2026-10-09' }).success, true);
  assert.equal(exceptionsQuerySchema.safeParse({ clinicDayId: 'c1', shiftId: 's1' }).success, true);
  assert.equal(discrepanciesQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(discrepanciesQuerySchema.safeParse({}).success, false);
  assert.equal(shiftReadinessQuerySchema.safeParse({ shiftId: 's1' }).success, true);
  assert.equal(shiftReadinessQuerySchema.safeParse({}).success, false);
}

// ---------------------------------------------------------------------------
// 3. resolveShift precedence: shiftId > clinicDayId-as-id > clinicDayId-as-date.
// ---------------------------------------------------------------------------
{
  const day = new Date('2026-10-09T00:00:00.000Z');
  const byId = {
    id: 'shift-1',
    businessDate: day,
    status: 'OPEN',
    openingFloatMinor: 1000,
    openingCarryForwardMinor: 1000,
    openingDiscrepancyMinor: 0,
    queueVersion: 2,
    expectedCashMinor: null,
    actualCountedMinor: null,
    differenceMinor: null,
    result: null,
    integrityCheckPassed: null,
    openedByUserId: 'u1',
    closedByUserId: null,
    closedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  const fake = {
    shift: {
      findUnique: (args: { where: { id: string } }): Promise<typeof byId | null> =>
        Promise.resolve(args.where.id === 'shift-1' ? byId : null),
      findFirst: (): Promise<typeof byId | null> => Promise.resolve(byId),
    },
  } as unknown as PrismaClient;

  const resolved = await resolveShift({ shiftId: 'shift-1' }, fake);
  assert.equal(resolved.id, 'shift-1');
  assert.equal(resolved.queueVersion, 2);

  let missing: unknown = null;
  try {
    await resolveShift({ shiftId: 'nope' }, fake);
  } catch (err) {
    missing = err;
  }
  assert.ok(missing instanceof AppError && missing.code === 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// 4. listSupervisionShifts: closed review queue with unacked + variance filters.
// ---------------------------------------------------------------------------
{
  const closedA = {
    id: 'sh-a',
    businessDate: new Date('2026-10-08T00:00:00.000Z'),
    status: 'CLOSED',
    expectedCashMinor: 10000,
    actualCountedMinor: 10100,
    differenceMinor: 100,
    result: 'SURPLUS',
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    closedAt: new Date('2026-10-08T20:00:00.000Z'),
  };
  const closedB = {
    id: 'sh-b',
    businessDate: new Date('2026-10-07T00:00:00.000Z'),
    status: 'CLOSED',
    expectedCashMinor: 9000,
    actualCountedMinor: 9000,
    differenceMinor: 0,
    result: 'BALANCED',
    reviewedByUserId: 'u-doc-1',
    reviewedAt: new Date('2026-10-07T21:00:00.000Z'),
    reviewNote: 'Balanced, reviewed.',
    closedAt: new Date('2026-10-07T20:00:00.000Z'),
  };
  const fake = {
    shift: {
      findMany: (args: {
        where: { reviewedByUserId?: unknown; differenceMinor?: unknown };
      }): Promise<typeof closedA[] | typeof closedB[]> => {
        const where = args.where as { reviewedByUserId?: null; differenceMinor?: { not: number } };
        let rows: unknown[] = [closedA, closedB];
        if (where.reviewedByUserId === null) rows = rows.filter((r) => (r as typeof closedA).reviewedByUserId === null);
        if (where.differenceMinor !== undefined) rows = rows.filter((r) => (r as typeof closedA).differenceMinor !== 0);
        return Promise.resolve(rows as typeof closedA[]);
      },
    },
  } as unknown as PrismaClient;

  const all = await listSupervisionShifts({}, fake);
  assert.equal(all.data.length, 2);
  assert.equal(all.nextCursor, null);

  const unacked = await listSupervisionShifts({ unacked: 'true' }, fake);
  assert.equal(unacked.data.length, 1);
  assert.equal(unacked.data[0]?.shiftId, 'sh-a');

  const variance = await listSupervisionShifts({ varianceOnly: 'true' }, fake);
  assert.equal(variance.data.length, 1);
  assert.equal(variance.data[0]?.differenceMinor, 100);
}

// ---------------------------------------------------------------------------
// 5. getUnsignedNotes: COMPLETED without SIGNED is flagged; DRAFT age tracked.
// ---------------------------------------------------------------------------
{
  const completed = [
    {
      id: 'qe-1',
      patientId: 'p1',
      status: 'COMPLETED',
      completedAt: new Date('2026-10-09T10:00:00.000Z'),
      patient: { fullName: 'Patient One' },
    },
    {
      id: 'qe-2',
      patientId: 'p2',
      status: 'COMPLETED',
      completedAt: new Date('2026-10-09T11:00:00.000Z'),
      patient: { fullName: 'Patient Two' },
    },
  ];
  const fake = {
    shift: {
      findUnique: (): Promise<null> => Promise.resolve(null),
    },
    queueEntry: {
      findMany: (): Promise<typeof completed> => Promise.resolve(completed),
    },
    encounter: {
      findMany: (args: { where: { queueEntryRef?: unknown; status?: unknown } }): Promise<unknown[]> => {
        const where = args.where as { queueEntryRef?: { in: string[] }; status?: string };
        if (where.queueEntryRef !== undefined) {
          return Promise.resolve([{ queueEntryRef: 'qe-2' }]);
        }
        return Promise.resolve([
          { id: 'enc-1', patientId: 'p1', status: 'DRAFT', createdAt: new Date(Date.now() - 30 * 3_600_000) },
        ]);
      },
    },
    scribeDraft: {
      findMany: (): Promise<unknown[]> => Promise.resolve([]),
    },
    auditEvent: {
      findMany: (): Promise<unknown[]> =>
        Promise.resolve([
          {
            entityId: 'qe-1',
            entityType: 'DocumentationDeferral',
            reasonText: 'تأجيل لانتظار نتائج المعمل',
            createdAt: new Date('2026-10-10T12:00:00Z'),
          },
        ]),
    },
  } as unknown as PrismaClient;

  const dto = await getUnsignedNotes({}, fake);
  assert.equal(dto.shiftId, null);
  assert.equal(dto.completedWithoutSigned.length, 1);
  assert.equal(dto.completedWithoutSigned[0]?.queueEntryId, 'qe-1');
  assert.equal(dto.completedWithoutSigned[0]?.hasSignedEncounter, false);
  assert.equal(dto.completedWithoutSigned[0]?.isDeferred, true);
  assert.equal(dto.completedWithoutSigned[0]?.deferredReason, 'تأجيل لانتظار نتائج المعمل');
  assert.equal(dto.deferralCount, 1);
  assert.equal(dto.staleDrafts.length, 1);
  assert.equal(dto.staleDrafts[0]?.draftKind, 'ENCOUNTER');
  assert.equal(dto.staleDrafts[0]?.stale, true);
}

// ---------------------------------------------------------------------------
// 6. getDiscounts: itemized feed carries author metadata + totals.
// ---------------------------------------------------------------------------
{
  const rows = [
    {
      id: 'inv-1',
      queueEntryId: 'qe-1',
      patientId: 'p1',
      standardFeeMinor: 10000,
      finalFeeMinor: 8000,
      discountMinor: 2000,
      discountReason: 'Hardship verified by doctor',
      isComplimentary: false,
      createdByUserId: 'u-sec-1',
      createdBy: { name: 'Sam Secretary', role: 'SECRETARY' },
      createdAt: new Date('2026-10-09T10:00:00.000Z'),
    },
  ];
  const fake = {
    shift: {
      findUnique: (): Promise<{ id: string } | null> => Promise.resolve({ id: 's1' }),
    },
    invoice: {
      findMany: (): Promise<typeof rows> => Promise.resolve(rows),
    },
  } as unknown as PrismaClient;

  const dto = await getDiscounts({ shiftId: 's1' }, fake);
  assert.equal(dto.shiftId, 's1');
  assert.equal(dto.count, 1);
  assert.equal(dto.totalDiscountMinor, 2000);
  assert.equal(dto.data[0]?.authorName, 'Sam Secretary');
  assert.equal(dto.data[0]?.authorRole, 'SECRETARY');
  assert.equal(dto.data[0]?.discountReason, 'Hardship verified by doctor');
}

// ---------------------------------------------------------------------------
// 7. getNonCash + getExceptions: wallet grouping + discrepancy surfacing.
// ---------------------------------------------------------------------------
{
  const shiftRow = {
    id: 's1',
    businessDate: new Date('2026-10-09T00:00:00.000Z'),
    status: 'CLOSED',
    openingFloatMinor: 5000,
    openingCarryForwardMinor: 5000,
    openingDiscrepancyMinor: 0,
    queueVersion: 4,
    expectedCashMinor: 15000,
    actualCountedMinor: 15100,
    differenceMinor: 100,
    result: 'SURPLUS',
    integrityCheckPassed: false,
    openedByUserId: 'u1',
    closedByUserId: 'u2',
    closedAt: new Date('2026-10-09T20:00:00.000Z'),
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  const receipts = [
    {
      id: 'r-1',
      invoiceId: 'inv-1',
      amountMinor: 8000,
      type: 'CHARGE',
      paymentMethod: 'OTHER',
      reason: 'BANK-TXN-001',
      reversalOfReceiptId: null,
      createdAt: new Date('2026-10-09T10:00:00.000Z'),
    },
  ];
  const fakeNonCash = {
    shift: {
      findUnique: (): Promise<typeof shiftRow> => Promise.resolve(shiftRow),
      findFirst: (): Promise<typeof shiftRow> => Promise.resolve(shiftRow),
    },
    receipt: {
      findMany: (): Promise<typeof receipts> => Promise.resolve(receipts),
    },
  } as unknown as PrismaClient;
  const noncash = await getNonCash({ shiftId: 's1' }, fakeNonCash);
  assert.equal(noncash.shiftId, 's1');
  assert.equal(noncash.count, 1);
  assert.equal(noncash.totalMinor, 8000);
  assert.equal(noncash.byMethod[0]?.method, 'OTHER');
  assert.equal(noncash.byMethod[0]?.references[0]?.externalReference, 'BANK-TXN-001');

  const fakeExc = {
    shift: {
      findUnique: (): Promise<typeof shiftRow> => Promise.resolve(shiftRow),
      findFirst: (): Promise<typeof shiftRow> => Promise.resolve(shiftRow),
    },
    queueEntry: {
      findMany: (args: { where: { status?: unknown } }): Promise<unknown[]> => {
        const where = args.where as { status?: string | { in: string[] } };
        if (where.status === 'COMPLETED') {
          return Promise.resolve([
            { id: 'qe-1', patientId: 'p1', status: 'COMPLETED', completedAt: new Date() },
          ]);
        }
        return Promise.resolve([
          {
            id: 'qe-9',
            patientId: 'p9',
            emergencyReasonCode: 'VISIBLE_DISTRESS',
            emergencyFlaggedAt: new Date(),
            emergencyFlaggedByUserId: 'u-sec-1',
          },
        ]);
      },
    },
    invoice: {
      findMany: (): Promise<unknown[]> => Promise.resolve([]),
    },
  } as unknown as PrismaClient;
  const exc = await getExceptions({ shiftId: 's1' }, fakeExc);
  assert.equal(exc.completedWithoutInvoice.length, 1);
  assert.equal(exc.unacknowledgedEmergencies.length, 1);
  assert.equal(exc.shiftVarianceMinor, 100);
  assert.equal(exc.shiftResult, 'SURPLUS');
}

// ---------------------------------------------------------------------------
// 8. getShiftReadiness: open entries + closed status block close.
// ---------------------------------------------------------------------------
{
  const shiftRow = {
    id: 's1',
    businessDate: new Date('2026-10-09T00:00:00.000Z'),
    status: 'OPEN',
    openingFloatMinor: 5000,
    openingCarryForwardMinor: 5000,
    openingDiscrepancyMinor: 0,
    queueVersion: 7,
    expectedCashMinor: null,
    actualCountedMinor: null,
    differenceMinor: null,
    result: null,
    integrityCheckPassed: null,
    openedByUserId: 'u1',
    closedByUserId: null,
    closedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  const fake = {
    shift: {
      findUnique: (): Promise<typeof shiftRow> => Promise.resolve(shiftRow),
    },
    queueEntry: {
      findMany: (): Promise<unknown[]> =>
        Promise.resolve([{ id: 'qe-1', status: 'WAITING', position: 1 }]),
      count: (): Promise<number> => Promise.resolve(1),
    },
    invoice: { findMany: (): Promise<unknown[]> => Promise.resolve([]) },
    receipt: {
      findMany: (): Promise<unknown[]> => Promise.resolve([]),
      aggregate: (): Promise<{ _sum: { amountMinor: number | null } }> =>
        Promise.resolve({ _sum: { amountMinor: null } }),
    },
    pettyExpense: { findMany: (): Promise<unknown[]> => Promise.resolve([]) },
    auditEvent: { findMany: (): Promise<unknown[]> => Promise.resolve([]) },
    clinicSettings: { findUnique: (): Promise<null> => Promise.resolve(null) },
    user: { findMany: (): Promise<unknown[]> => Promise.resolve([]) },
  } as unknown as PrismaClient;

  const readiness = await getShiftReadiness({ shiftId: 's1' }, fake);
  assert.equal(readiness.shiftId, 's1');
  assert.equal(readiness.canClose, false);
  assert.ok(readiness.blockers.length > 0);
  assert.equal(readiness.queueVersion, 7);
  assert.equal(readiness.openEntries.length, 1);
}

// eslint-disable-next-line no-console
console.log('BE-702 supervision validators + feeds + readiness tests passed.');
