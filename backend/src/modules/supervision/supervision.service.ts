import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { broadcastSupervisionDiscrepancy } from '../../common/realtime.js';
import {
  checkShiftInvariants,
  computeExpectedCash,
  formatInvariantFailures,
} from '../cashier-shift/reconciliation.service.js';
import type {
  CashSummaryDto,
  DiscrepanciesDto,
  DiscountsDto,
  ExceptionsDto,
  FrontDeskActivityDto,
  FrontDeskActivityItem,
  NonCashDto,
  NonCashMethodGroup,
  NonCashReference,
  ShiftReadinessDto,
  SupervisionShiftsDto,
  UnsignedNotesDto,
} from './supervision.dto.js';
import type {
  CashSummaryQuery,
  DiscountsQuery,
  DiscrepanciesQuery,
  ExceptionsQuery,
  FrontDeskActivityQuery,
  NonCashQuery,
  ShiftReadinessQuery,
  ShiftScopeQuery,
  SupervisionShiftsQuery,
  UnsignedNotesQuery,
} from './supervision.validators.js';

type Db = PrismaClient;

interface ShiftScope {
  readonly shiftId?: string | undefined;
  readonly clinicDayId?: string | undefined;
}

interface ResolvedShift {
  readonly id: string;
  readonly businessDate: Date;
  readonly status: 'OPEN' | 'CLOSED';
  readonly openingFloatMinor: number;
  readonly openingCarryForwardMinor: number;
  readonly openingDiscrepancyMinor: number;
  readonly queueVersion: number;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: 'BALANCED' | 'SURPLUS' | 'DEFICIT' | null;
  readonly integrityCheckPassed: boolean | null;
  readonly openedByUserId: string;
  readonly closedByUserId: string | null;
  readonly closedAt: Date | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}

function parseDayDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const year = Number.parseInt(match[1] ?? '1970', 10);
  const month = Number.parseInt(match[2] ?? '01', 10);
  const day = Number.parseInt(match[3] ?? '01', 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Resolve a day/shift scope to a single Shift row.
 *
 * Precedence: explicit `shiftId` > `clinicDayId`-as-shift-id >
 * `clinicDayId`-as-`YYYY-MM-DD` businessDate > OPEN shift > latest shift.
 * Throws 404 when nothing resolves (never 500 on an empty clinic).
 */
async function resolveShift(scope: ShiftScope, db: Db = prisma): Promise<ResolvedShift> {
  if (scope.shiftId !== undefined) {
    const shift = await db.shift.findUnique({ where: { id: scope.shiftId } });
    if (shift === null) throw AppError.notFound('Shift not found');
    return shift as ResolvedShift;
  }
  if (scope.clinicDayId !== undefined) {
    const byId = await db.shift.findUnique({ where: { id: scope.clinicDayId } });
    if (byId !== null) return byId as ResolvedShift;
    const day = parseDayDate(scope.clinicDayId);
    if (day !== null) {
      const byDate = await db.shift.findFirst({ where: { businessDate: day } });
      if (byDate !== null) return byDate as ResolvedShift;
    }
    throw AppError.notFound('Shift not found for clinicDayId');
  }
  const open = await db.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
  if (open !== null) return open as ResolvedShift;
  const latest = await db.shift.findFirst({ orderBy: { businessDate: 'desc' } });
  if (latest !== null) return latest as ResolvedShift;
  throw AppError.notFound('No shift found');
}

async function loadShiftOrThrow(shiftId: string, db: Db = prisma): Promise<ResolvedShift> {
  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (shift === null) throw AppError.notFound('Shift not found');
  return shift as ResolvedShift;
}

function actionKind(action: string): FrontDeskActivityItem['kind'] {
  if (
    action.startsWith('QUEUE_') ||
    action === 'EMERGENCY_FLAG' ||
    action === 'EMERGENCY_UNFLAG' ||
    action === 'QUEUE_REORDER' ||
    action === 'QUEUE_SKIP' ||
    action === 'QUEUE_NO_SHOW' ||
    action === 'QUEUE_ABANDON' ||
    action === 'QUEUE_CALL' ||
    action === 'QUEUE_COMPLETE' ||
    action === 'QUEUE_COMPLETE_UNDO' ||
    action === 'QUEUE_UNDO_COMPLETE' ||
    action === 'QUEUE_REQUEUE' ||
    action === 'QUEUE_CHECKIN' ||
    action === 'CHECKIN_DEBT_ACK' ||
    action === 'FORCED_CALLNEXT' ||
    action === 'QUEUE_OUT_OF_ORDER_CALL'
  ) {
    return 'QUEUE';
  }
  if (
    action === 'CHECKOUT' ||
    action === 'INVOICE_PAY' ||
    action === 'COMPLIMENTARY' ||
    action === 'RECEIPT_REVERSAL' ||
    action === 'REVERSAL' ||
    action === 'WRITE_OFF' ||
    action === 'PETTY_CREATE' ||
    action === 'PETTY' ||
    action === 'DISCOUNT_FLOOR_BLOCKED' ||
    action === 'DISCOUNT' ||
    action === 'FEE_OVERRIDE' ||
    action === 'FLOOR_VIOLATION'
  ) {
    return 'CASH';
  }
  return 'SHIFT';
}

// ---------------------------------------------------------------------------
// GET /supervision/front-desk-activity — queue + cash feed
// ---------------------------------------------------------------------------

export async function getFrontDeskActivity(
  query: FrontDeskActivityQuery,
  db: Db = prisma,
): Promise<FrontDeskActivityDto> {
  const scope: ShiftScope = {};
  if (query.shiftId !== undefined) (scope as { shiftId: string }).shiftId = query.shiftId;
  if (query.clinicDayId !== undefined) (scope as { clinicDayId: string }).clinicDayId = query.clinicDayId;
  const shift = await resolveShift(scope, db);

  const [queueEntries, invoices, receipts, pettyRows] = await Promise.all([
    db.queueEntry.findMany({ where: { shiftId: shift.id }, select: { id: true } }),
    db.invoice.findMany({ where: { shiftId: shift.id }, select: { id: true } }),
    db.receipt.findMany({ where: { shiftId: shift.id }, select: { id: true } }),
    db.pettyExpense.findMany({ where: { shiftId: shift.id }, select: { id: true } }),
  ]);

  const scopedIds = new Set<string>([shift.id]);
  for (const row of queueEntries) scopedIds.add(row.id);
  for (const row of invoices) scopedIds.add(row.id);
  for (const row of receipts) scopedIds.add(row.id);
  for (const row of pettyRows) scopedIds.add(row.id);

  const limit = query.limit ?? 50;
  const cursor = query.cursor;

  const events = await db.auditEvent.findMany({
    where: { entityId: { in: [...scopedIds] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorUserId: true,
      actorRole: true,
      reasonText: true,
      createdAt: true,
    },
  });

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;

  const data: FrontDeskActivityItem[] = page.map((e) => ({
    action: String(e.action),
    kind: actionKind(String(e.action)),
    entityType: e.entityType,
    entityId: e.entityId,
    actorUserId: e.actorUserId,
    actorRole: e.actorRole,
    createdAt: e.createdAt.toISOString(),
    reason: e.reasonText,
  }));

  return {
    shiftId: shift.id,
    businessDate: shift.businessDate.toISOString(),
    queueVersion: shift.queueVersion,
    totalEvents: data.length,
    data,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/cash-summary — full financial audit view for a shift
// ---------------------------------------------------------------------------

export async function getCashSummary(query: CashSummaryQuery, db: Db = prisma): Promise<CashSummaryDto> {
  const shift = await loadShiftOrThrow(query.shiftId, db);

  const [receipts, pettyRows, invoices] = await Promise.all([
    db.receipt.findMany({ where: { shiftId: shift.id }, select: { type: true, amountMinor: true, paymentMethod: true } }),
    db.pettyExpense.findMany({ where: { shiftId: shift.id }, select: { amountMinor: true, direction: true } }),
    db.invoice.findMany({ where: { shiftId: shift.id }, select: { id: true } }),
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

  const drawer = await computeExpectedCash(db, shift.id, shift.openingFloatMinor);
  const netCashMinor = drawer.expectedCashMinor;
  const report = await checkShiftInvariants(shift.id, db);
  const failures = formatInvariantFailures(report);

  const audited = await db.auditEvent.findMany({
    where: { entityType: { in: ['Shift', 'Invoice', 'Receipt', 'PettyExpense'] } },
    select: { entityType: true, entityId: true },
  });
  const auditedKeys = new Set(audited.map((a) => `${a.entityType}:${a.entityId}`));
  // INV-10 coverage mirrors reconciliation.service.ts: CHARGE receipts are audited
  // under their Invoice (counted above); only REVERSAL receipts carry a
  // Receipt-keyed audit. Counting every receipt here would under-report coverage
  // on otherwise-clean shifts (and the prior expectedKeys block was dead code).
  const reversalReceiptIds = await db.receipt.findMany({
    where: { shiftId: shift.id, type: 'REVERSAL' },
    select: { id: true },
  });
  const pettyIds = await db.pettyExpense.findMany({ where: { shiftId: shift.id }, select: { id: true } });
  const expectedCount = 1 + invoices.length + reversalReceiptIds.length + pettyIds.length;
  let covered = 0;
  if (auditedKeys.has(`Shift:${shift.id}`)) covered += 1;
  for (const inv of invoices) {
    if (auditedKeys.has(`Invoice:${inv.id}`)) covered += 1;
  }
  for (const r of reversalReceiptIds) {
    if (auditedKeys.has(`Receipt:${r.id}`)) covered += 1;
  }
  for (const p of pettyIds) {
    if (auditedKeys.has(`PettyExpense:${p.id}`)) covered += 1;
  }

  return {
    shiftId: shift.id,
    businessDate: shift.businessDate.toISOString(),
    status: shift.status,
    queueVersion: shift.queueVersion,
    grossCollectedMinor,
    cashCollectedMinor,
    otherCollectedMinor,
    reversalsMinor,
    pettyExpenseMinor,
    pettyInjectionMinor,
    netCashMinor,
    byMethod: { CASH: cashCollectedMinor, OTHER: otherCollectedMinor },
    expectedCashMinor: shift.expectedCashMinor,
    actualCountedMinor: shift.actualCountedMinor,
    differenceMinor: shift.differenceMinor,
    result: shift.result,
    reconciliationPassed: report.passed,
    invariantFailures: failures,
    auditCoverage: {
      expectedAuditedEntities: expectedCount,
      auditedEntities: covered,
      missing: Math.max(0, expectedCount - covered),
    },
    reviewedByUserId: shift.reviewedByUserId,
    reviewedAt: shift.reviewedAt === null ? null : shift.reviewedAt.toISOString(),
    reviewNote: shift.reviewNote,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/shifts — doctor async review queue
// ---------------------------------------------------------------------------

export async function listSupervisionShifts(
  query: SupervisionShiftsQuery,
  db: Db = prisma,
): Promise<SupervisionShiftsDto> {
  const unackedOnly = query.unacked === 'true';
  const varianceOnly = query.varianceOnly === 'true';
  const limit = query.limit ?? 50;

  const rows = await db.shift.findMany({
    where: {
      status: 'CLOSED',
      ...(unackedOnly ? { reviewedByUserId: null } : {}),
      ...(varianceOnly ? { differenceMinor: { not: 0 } } : {}),
    },
    orderBy: { closedAt: 'desc' },
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;

  return {
    data: page.map((s) => ({
      shiftId: s.id,
      businessDate: s.businessDate.toISOString(),
      status: s.status,
      expectedCashMinor: s.expectedCashMinor,
      actualCountedMinor: s.actualCountedMinor,
      differenceMinor: s.differenceMinor,
      result: s.result,
      reviewedByUserId: s.reviewedByUserId,
      reviewedAt: s.reviewedAt === null ? null : s.reviewedAt.toISOString(),
      reviewNote: s.reviewNote,
      closedAt: s.closedAt === null ? null : s.closedAt.toISOString(),
    })),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/unsigned-notes — clinical safety monitor
// ---------------------------------------------------------------------------

const STALE_DRAFT_HOURS = 24;

export async function getUnsignedNotes(query: UnsignedNotesQuery, db: Db = prisma): Promise<UnsignedNotesDto> {
  let shift: ResolvedShift | null = null;
  if (query.shiftId !== undefined) {
    shift = await loadShiftOrThrow(query.shiftId, db);
  }

  const completedEntries = await db.queueEntry.findMany({
    where: {
      status: 'COMPLETED',
      ...(shift !== null ? { shiftId: shift.id } : {}),
    },
    include: { patient: { select: { fullName: true } } },
    orderBy: { completedAt: 'desc' },
    take: 200,
  });

  const entryIds = completedEntries.map((e) => e.id);
  const signedByRef =
    entryIds.length > 0
      ? await db.encounter.findMany({
          where: { queueEntryRef: { in: entryIds }, status: 'SIGNED' },
          select: { queueEntryRef: true },
        })
      : [];
  const signedRefs = new Set<string>();
  for (const s of signedByRef) {
    if (s.queueEntryRef !== null) signedRefs.add(s.queueEntryRef);
  }

  const completedWithoutSigned = completedEntries
    .filter((e) => !signedRefs.has(e.id))
    .map((e) => ({
      queueEntryId: e.id,
      patientId: e.patientId,
      displayName: e.patient.fullName,
      status: String(e.status),
      completedAt: e.completedAt === null ? null : e.completedAt.toISOString(),
      hasSignedEncounter: false as const,
    }));

  const nowMs = Date.now();
  const [draftEncounters, scribeDrafts] = await Promise.all([
    db.encounter.findMany({
      where: { status: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, patientId: true, status: true, createdAt: true },
    }),
    db.scribeDraft.findMany({
      where: { status: { in: ['DRAFT', 'EDITED'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, patientId: true, status: true, createdAt: true, signedEncounterRef: true },
    }),
  ]);

  const staleDrafts = [
    ...draftEncounters.map((d) => {
      const ageHours = (nowMs - d.createdAt.getTime()) / 3_600_000;
      return {
        draftKind: 'ENCOUNTER' as const,
        draftId: d.id,
        patientId: d.patientId,
        status: String(d.status),
        createdAt: d.createdAt.toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        stale: ageHours >= STALE_DRAFT_HOURS,
      };
    }),
    ...scribeDrafts
      .filter((d) => d.signedEncounterRef === null)
      .map((d) => {
        const ageHours = (nowMs - d.createdAt.getTime()) / 3_600_000;
        return {
          draftKind: 'SCRIBE' as const,
          draftId: d.id,
          patientId: d.patientId,
          status: String(d.status),
          createdAt: d.createdAt.toISOString(),
          ageHours: Math.round(ageHours * 10) / 10,
          stale: ageHours >= STALE_DRAFT_HOURS,
        };
      }),
  ];

  return {
    shiftId: shift === null ? null : shift.id,
    completedWithoutSigned,
    staleDrafts,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/discounts — itemized per-secretary discount feed
// ---------------------------------------------------------------------------

export async function getDiscounts(query: DiscountsQuery, db: Db = prisma): Promise<DiscountsDto> {
  await loadShiftOrThrow(query.shiftId, db);

  const invoices = await db.invoice.findMany({
    where: { shiftId: query.shiftId, discountMinor: { gt: 0 } },
    include: { createdBy: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const data = invoices.map((inv) => ({
    invoiceId: inv.id,
    queueEntryId: inv.queueEntryId,
    patientId: inv.patientId,
    standardFeeMinor: inv.standardFeeMinor,
    finalFeeMinor: inv.finalFeeMinor,
    discountMinor: inv.discountMinor,
    discountReason: inv.discountReason,
    isComplimentary: inv.isComplimentary,
    createdByUserId: inv.createdByUserId,
    authorName: inv.createdBy.name,
    authorRole: inv.createdBy.role,
    createdAt: inv.createdAt.toISOString(),
  }));

  const totalDiscountMinor = data.reduce((sum, d) => sum + d.discountMinor, 0);

  return {
    shiftId: query.shiftId,
    count: data.length,
    totalDiscountMinor,
    data,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/noncash — grouped non-cash receipts with references
// ---------------------------------------------------------------------------

export async function getNonCash(query: NonCashQuery, db: Db = prisma): Promise<NonCashDto> {
  const scope: ShiftScope = {};
  if (query.shiftId !== undefined) (scope as { shiftId: string }).shiftId = query.shiftId;
  if (query.clinicDayId !== undefined) (scope as { clinicDayId: string }).clinicDayId = query.clinicDayId;
  const shift = await resolveShift(scope, db);

  const receipts = await db.receipt.findMany({
    where: { shiftId: shift.id, paymentMethod: { not: 'CASH' } },
    orderBy: { createdAt: 'desc' },
  });

  const groups = new Map<string, { count: number; totalMinor: number; refs: NonCashReference[] }>();
  for (const r of receipts) {
    const method = String(r.paymentMethod);
    const bucket = groups.get(method) ?? { count: 0, totalMinor: 0, refs: [] };
    const delta = r.type === 'CHARGE' ? r.amountMinor : -r.amountMinor;
    bucket.count += 1;
    bucket.totalMinor += delta;
    bucket.refs.push({
      receiptId: r.id,
      invoiceId: r.invoiceId,
      amountMinor: r.amountMinor,
      type: r.type,
      externalReference: r.reason ?? r.reversalOfReceiptId ?? null,
      createdAt: r.createdAt.toISOString(),
    });
    groups.set(method, bucket);
  }

  const byMethod: NonCashMethodGroup[] = [...groups.entries()].map(([method, bucket]) => ({
    method,
    count: bucket.count,
    totalMinor: bucket.totalMinor,
    references: bucket.refs,
  }));

  const totalMinor = byMethod.reduce((sum, g) => sum + g.totalMinor, 0);

  return {
    shiftId: shift.id,
    businessDate: shift.businessDate.toISOString(),
    count: receipts.length,
    totalMinor,
    byMethod,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/exceptions — operational discrepancies
// ---------------------------------------------------------------------------

export async function getExceptions(query: ExceptionsQuery, db: Db = prisma): Promise<ExceptionsDto> {
  const scope: ShiftScope = {};
  if (query.shiftId !== undefined) (scope as { shiftId: string }).shiftId = query.shiftId;
  if (query.clinicDayId !== undefined) (scope as { clinicDayId: string }).clinicDayId = query.clinicDayId;
  const shift = await resolveShift(scope, db);

  const completed = await db.queueEntry.findMany({
    where: { shiftId: shift.id, status: 'COMPLETED' },
    select: { id: true, patientId: true, status: true, completedAt: true },
  });
  const invoices = await db.invoice.findMany({
    where: { shiftId: shift.id },
    select: { queueEntryId: true },
  });
  const invoicedEntries = new Set(invoices.map((i) => i.queueEntryId));
  const completedWithoutInvoice = completed
    .filter((e) => !invoicedEntries.has(e.id))
    .map((e) => ({
      queueEntryId: e.id,
      patientId: e.patientId,
      status: String(e.status),
      completedAt: e.completedAt === null ? null : e.completedAt.toISOString(),
    }));

  const emergencies = await db.queueEntry.findMany({
    where: { shiftId: shift.id, isEmergency: true, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
    select: { id: true, patientId: true, emergencyReasonCode: true, emergencyFlaggedAt: true, emergencyFlaggedByUserId: true },
    orderBy: { emergencyFlaggedAt: 'asc' },
  });

  const forcedClose =
    shift.status === 'CLOSED' &&
    shift.integrityCheckPassed === false &&
    shift.reviewedByUserId !== null;

  return {
    shiftId: shift.id,
    businessDate: shift.businessDate.toISOString(),
    completedWithoutInvoice,
    unacknowledgedEmergencies: emergencies.map((e) => ({
      queueEntryId: e.id,
      patientId: e.patientId,
      reasonCode: e.emergencyReasonCode,
      flaggedAt: e.emergencyFlaggedAt === null ? null : e.emergencyFlaggedAt.toISOString(),
      flaggedByUserId: e.emergencyFlaggedByUserId,
    })),
    openingFloatDiscrepancyMinor: shift.openingDiscrepancyMinor,
    openingCarryForwardMinor: shift.openingCarryForwardMinor,
    shiftVarianceMinor: shift.differenceMinor,
    shiftResult: shift.result,
    forcedClose,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/discrepancies (RPS-2 INV-1..10 gate view)
// ---------------------------------------------------------------------------

export async function getDiscrepancies(query: DiscrepanciesQuery, db: Db = prisma): Promise<DiscrepanciesDto> {
  const shift = await loadShiftOrThrow(query.shiftId, db);
  const report = await checkShiftInvariants(shift.id, db);

  const invViolations = report.failures
    .filter((f) => f.code !== 'INV-10')
    .map((f) => ({ inv: f.code, detail: f.detail, entities: [...f.entities] }));
  const missingAudit = report.failures
    .filter((f) => f.code === 'INV-10')
    .map((f) => ({ inv: f.code, detail: f.detail, entities: [...f.entities] }));

  const openCount = await db.queueEntry.count({
    where: { shiftId: shift.id, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
  });
  const staleQueue = shift.status === 'CLOSED' && openCount > 0;

  if (!report.passed) {
    const serverAt = new Date().toISOString();
    for (const v of report.failures.slice(0, 5)) {
      broadcastSupervisionDiscrepancy({ shiftId: shift.id, inv: v.code, detail: v.detail, serverAt });
    }
  }

  return {
    shiftId: shift.id,
    invViolations,
    missingAudit,
    staleQueue,
  };
}

// ---------------------------------------------------------------------------
// GET /supervision/shift-readiness (close-readiness probe)
// ---------------------------------------------------------------------------

export async function getShiftReadiness(query: ShiftReadinessQuery, db: Db = prisma): Promise<ShiftReadinessDto> {
  const shift = await loadShiftOrThrow(query.shiftId, db);

  const openEntries = await db.queueEntry.findMany({
    where: { shiftId: shift.id, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
    select: { id: true, status: true, position: true },
    orderBy: { position: 'asc' },
  });

  const report = await checkShiftInvariants(shift.id, db);
  const blockers: string[] = [];
  if (openEntries.length > 0) {
    blockers.push(`${openEntries.length} queue entr${openEntries.length === 1 ? 'y is' : 'ies are'} still WAITING or IN_CONSULTATION`);
  }
  for (const failure of formatInvariantFailures(report)) {
    blockers.push(failure);
  }
  if (shift.status === 'CLOSED') {
    blockers.push('shift is already CLOSED');
  }

  return {
    shiftId: shift.id,
    canClose: blockers.length === 0,
    blockers,
    queueVersion: shift.queueVersion,
    openEntries: openEntries.map((e) => ({
      queueEntryId: e.id,
      status: String(e.status),
      position: e.position,
    })),
  };
}

export type { ShiftScopeQuery };
export type { ResolvedShift };
export { resolveShift };
