import { type Prisma, type PrismaClient, type QueueEntry, type QueueStatus } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { isUniqueViolation } from '../../common/db/unique-violation.js';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';
import { canTransition, type QueueEntryStatus } from './queue.state.js';

export type PrismaTx = Prisma.TransactionClient;

/** Normalize a DB QueueStatus into the state-machine union type. */
export function normalizeQueueStatus(status: QueueStatus): QueueEntryStatus {
  return status as QueueEntryStatus;
}

import { ensureAutoShift } from '../cashier-shift/shift.support.js';

/** Load the OPEN shift or throw 409 NO_OPEN_SHIFT. */
export async function getOpenShiftOrThrow(
  prisma: PrismaTx | PrismaClient,
): Promise<{ id: string; queueVersion: number; status: string }> {
  const shift = await prisma.shift.findFirst({ where: { status: 'OPEN' } });
  if (shift === null) {
    const env = loadEnv();
    if (!env.SHIFT_SYSTEM_ENABLED) {
      return await ensureAutoShift(prisma);
    }
    throw new AppError('NO_OPEN_SHIFT', 'No open shift');
  }
  return { id: shift.id, queueVersion: shift.queueVersion, status: shift.status };
}

/** Assert the requested status transition is legal for this entry. */
export function assertLegalTransition(from: QueueEntryStatus, to: QueueEntryStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('ILLEGAL_TRANSITION', `Illegal queue transition ${from} -> ${to}`);
  }
}

/** Fetch entry by id or throw 404. */
export async function loadQueueEntry(
  prisma: PrismaTx | PrismaClient,
  entryId: string,
): Promise<QueueEntry> {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (entry === null) {
    throw new AppError('NOT_FOUND', 'Queue entry not found');
  }
  return entry;
}

/** Compute tail position (max position + 1) among active entries of a shift. */
export async function computeTailPosition(prisma: PrismaTx | PrismaClient, shiftId: string): Promise<number> {
  const max = await prisma.queueEntry.aggregate({
    where: { shiftId },
    _max: { position: true },
  });
  const current = max._max.position;
  return (current ?? 0) + 1;
}

/** Dense-renumber the WAITING pool 1..N by (emergencyFlaggedAt ASC, position ASC). */
export async function renumberWaitingPool(prisma: PrismaTx | PrismaClient, shiftId: string): Promise<void> {
  const pool = await prisma.queueEntry.findMany({
    where: { shiftId, status: 'WAITING' },
    orderBy: [{ emergencyFlaggedAt: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }, { checkedInAt: 'asc' }],
    select: { id: true },
  });
  let idx = 1;
  for (const row of pool) {
    await prisma.queueEntry.update({ where: { id: row.id }, data: { position: idx } });
    idx += 1;
  }
}

/** Ordered WAITING pool for display / head selection. */
export async function loadOrderedWaitingPool(prisma: PrismaTx | PrismaClient, shiftId: string): Promise<QueueEntry[]> {
  return prisma.queueEntry.findMany({
    where: { shiftId, status: 'WAITING' },
    orderBy: [{ emergencyFlaggedAt: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }, { checkedInAt: 'asc' }],
  });
}

/** Estimated wait in minutes for a given dense position. */
export function estimateWaitMin(position: number, avgConsultMin: number): number {
  return Math.round(Math.max(0, position - 1) * avgConsultMin);
}

/** Aggregate outstanding debt for a patient across UNPAID/PARTIAL invoices. */
export async function computePatientDebt(
  prisma: PrismaTx | PrismaClient,
  patientId: string,
): Promise<{ outstandingMinor: number; oldestInvoiceDate: Date | null }> {
  const invoices = await prisma.invoice.findMany({
    where: { patientId, status: { in: ['UNPAID', 'PARTIAL'] } },
    select: { outstandingMinor: true, createdAt: true },
  });
  let outstandingMinor = 0;
  let oldest: Date | null = null;
  for (const inv of invoices) {
    outstandingMinor += inv.outstandingMinor;
    if (oldest === null || inv.createdAt < oldest) {
      oldest = inv.createdAt;
    }
  }
  return { outstandingMinor, oldestInvoiceDate: oldest };
}

/** Append an AuditEvent row (operational allowlist only; before/after states). */
export async function writeQueueAudit(
  prisma: PrismaTx | PrismaClient,
  params: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: string;
    entityId: string;
    entityType?: 'QueueEntry' | 'Shift';
    reasonText?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    beforeState?: Prisma.InputJsonValue;
    afterState?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: params.action as never,
      entityType: params.entityType ?? 'QueueEntry',
      entityId: params.entityId,
      ...(params.reasonText !== undefined ? { reasonText: params.reasonText } : {}),
      ...(params.requestId !== undefined ? { requestId: params.requestId } : {}),
      ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
      ...(params.beforeState !== undefined ? { beforeState: params.beforeState } : {}),
      ...(params.afterState !== undefined ? { afterState: params.afterState } : {}),
    },
  });
}

/** Bump Shift.queueVersion inside the same transaction (DB-12). */
export async function bumpQueueVersion(prisma: PrismaTx | PrismaClient, shiftId: string): Promise<number> {
  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: { queueVersion: { increment: 1 } },
    select: { queueVersion: true },
  });
  return updated.queueVersion;
}

/** Shared P2002 mapping: one IN_CONSULTATION per shift; one open entry per patient. */
export function mapQueueUniqueViolation(err: unknown): AppError | null {
  if (isUniqueViolation(err, 'single_consult')) {
    return new AppError('ACTIVE_CONSULTATION_EXISTS', 'Active consultation already exists');
  }
  if (isUniqueViolation(err, 'one_open_per_patient')) {
    return new AppError('ALREADY_ACTIVE', 'Patient already has an active entry');
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  ) {
    return new AppError('POSSIBLE_DUPLICATE', 'Duplicate queue entry');
  }
  return null;
}

/** Default avg consult minutes from env (ClinicSettings plumbing pending). */
export function defaultAvgConsultMin(): number {
  try {
    return loadEnv().CLINIC_AVG_CONSULT_MIN;
  } catch {
    return 20;
  }
}

/** Best-effort debug log for state transitions (operational only). */
export function logQueueEvent(event: string, payload: Record<string, unknown>): void {
  logger.debug('queue.event', { event, ...payload });
}

/**
 * BE-203 reorder row lock (CONV-04 posture, queue-scoped).
 *
 * Serializes concurrent reorders against the SAME shift row so the OCC version
 * check and the dense renumbering cannot interleave. Kept local to the queue
 * module: the canonical cashier `lockShift` lands in Sprint 3 and can supersede
 * this without any contract change (both map contention → 409).
 */
export async function lockShift(tx: PrismaTx, shiftId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${shiftId} FOR UPDATE`;
}

/**
 * Re-insert a just-un-flagged entry among regular WAITING entries by its
 * original checkedInAt timestamp (RPS-2: "re-inserts among regular WAITING by
 * checkedInAt"). Renumbers the WHOLE waiting pool densely 1..N with emergencies
 * still pinned on top (by emergencyFlaggedAt ASC), then regular entries ordered
 * by checkedInAt ASC so the un-flagged entry lands back in its FIFO place.
 */
export async function renumberWaitingPoolByCheckedInAt(
  prisma: PrismaTx | PrismaClient,
  shiftId: string,
): Promise<void> {
  const pool = await prisma.queueEntry.findMany({
    where: { shiftId, status: 'WAITING' },
    orderBy: [
      { emergencyFlaggedAt: { sort: 'asc', nulls: 'last' } },
      { checkedInAt: 'asc' },
      { position: 'asc' },
    ],
    select: { id: true },
  });
  let idx = 1;
  for (const row of pool) {
    await prisma.queueEntry.update({ where: { id: row.id }, data: { position: idx } });
    idx += 1;
  }
}

/**
 * BE-203 RPS-2 wait-time formula (pure, unit-testable).
 *
 *   estimatedWaitMin =
 *     precedingWaitingCount * avgConsultDurationMin
 *     + (inConsultation ? max(0, avgConsultDurationMin - elapsedConsultMin) : 0)
 *
 * The remainder term models time already spent in the active consultation: a
 * patient is NOT charged the full slot for the consult already underway. Result
 * is floored at 0 and kept exact (fractional minutes preserved by caller policy).
 */
export function computeEstimatedWaitMin(params: {
  precedingWaitingCount: number;
  avgConsultDurationMin: number;
  inConsultation: boolean;
  elapsedConsultMin: number;
}): number {
  const base = Math.max(0, params.precedingWaitingCount) * params.avgConsultDurationMin;
  const remainder = params.inConsultation
    ? Math.max(0, params.avgConsultDurationMin - Math.max(0, params.elapsedConsultMin))
    : 0;
  return Math.round(base + remainder);
}

