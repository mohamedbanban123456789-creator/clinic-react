import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, Prisma as PrismaNs } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/utils/logger.js';

/**
 * BE-304 / BE-305 shared support (cashier-shift module-local).
 *
 * Declares its own `lockShift` (CONV-04 / DB-11 / C-8) rather than importing
 * billing.support's, keeping this sprint's files independently reviewable; both
 * issue the identical `SELECT ... FOR UPDATE` on the shifts row and both map
 * contention to 409, so there is no behavioural divergence.
 */

export type PrismaTx = Prisma.TransactionClient;

/** CONV-04 / DB-11 / C-8: row lock on the shift for ALL cash mutations. */
export async function lockShift(tx: PrismaTx, shiftId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${shiftId} FOR UPDATE`;
}

export type ShiftAuditAction =
  | 'SHIFT_OPEN'
  | 'SHIFT_CLOSE'
  | 'PETTY_CREATE'
  | 'SHIFT_ACK'
  | 'INTEGRITY_CHECK_FAILED';

/**
 * Atomic shift audit (INV-10 coverage). Written INSIDE the money transaction so
 * coverage cannot drift. Each call gets a unique requestId.
 */
export async function writeShiftAudit(
  tx: PrismaTx,
  params: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: ShiftAuditAction;
    entityType: string;
    entityId: string;
    reasonText?: string | null;
    idempotencyKey?: string | null;
    beforeState?: PrismaNs.InputJsonValue;
    afterState?: PrismaNs.InputJsonValue;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      requestId: randomUUID(),
      ...(params.reasonText !== undefined ? { reasonText: params.reasonText } : {}),
      ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
      ...(params.beforeState !== undefined ? { beforeState: params.beforeState } : {}),
      ...(params.afterState !== undefined ? { afterState: params.afterState } : {}),
    },
  });
}

/**
 * Standalone (auto-committed) audit write for a path that must be recorded even
 * though the surrounding transaction aborts or never opens (e.g. the on-demand
 * integrity probe reporting a failure). Best-effort with a warn log.
 */
export async function writeShiftAuditStandalone(
  db: PrismaClient,
  params: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: ShiftAuditAction;
    entityType: string;
    entityId: string;
    reasonText?: string | null;
    idempotencyKey?: string | null;
    afterState?: PrismaNs.InputJsonValue;
  },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        requestId: randomUUID(),
        ...(params.reasonText !== undefined ? { reasonText: params.reasonText } : {}),
        ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        ...(params.afterState !== undefined ? { afterState: params.afterState } : {}),
      },
    });
  } catch (err) {
    logger.warn('shift.audit.standaloneWriteFailed', { action: params.action, err: String(err) });
  }
}

/** Truncate any Date to its UTC calendar date (Shift.businessDate is @db.Date). */
export function toBusinessDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Parse a YYYY-MM-DD body value into a UTC calendar date. */
export function parseBusinessDate(value: string): Date {
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  const yy = y ?? 1970;
  const mm = m ?? 1;
  const dd = d ?? 1;
  return new Date(Date.UTC(yy, mm - 1, dd));
}

/** Map a Prisma unique-violation to true when the constraint target matches. */
export function isUniqueViolation(err: unknown, target: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: unknown }).code !== 'P2002') return false;
  const meta = (err as { meta?: { target?: string | string[] } }).meta;
  const t = Array.isArray(meta?.target) ? meta?.target.join(',') : String(meta?.target ?? '');
  return t.includes(target);
}

/** AppError is re-exported for service-local guards without a second import. */
export { AppError };


/**
 * BE-305 opening carry-forward: the prior closed shift's counted/verified cash,
 * else the ClinicSettings initial float, else 0.
 *
 * "Counted/verified" prefers the prior shift's persisted actual count (the
 * doctor-reviewed count when present). No prior shift -> settings float.
 */
export async function deriveOpeningCarryForward(
  db: PrismaTx | PrismaClient,
  businessDate: Date,
): Promise<{ carryForwardMinor: number; source: string }> {
  const prior = await db.shift.findFirst({
    where: { status: 'CLOSED', businessDate: { lt: businessDate } },
    orderBy: { businessDate: 'desc' },
    select: { id: true, actualCountedMinor: true, reviewedAt: true },
  });
  if (prior !== null && prior.actualCountedMinor !== null) {
    return {
      carryForwardMinor: prior.actualCountedMinor,
      source: prior.reviewedAt === null ? `prior-shift:${prior.id}:counted` : `prior-shift:${prior.id}:verified`,
    };
  }

  try {
    const settings = await db.clinicSettings.findUnique({
      where: { id: 'singleton' },
      select: { openingFloatMinor: true },
    });
    if (settings !== null && settings.openingFloatMinor > 0) {
      return { carryForwardMinor: settings.openingFloatMinor, source: 'clinic-settings:openingFloat' };
    }
  } catch {
    /* settings unavailable — fall through to the zero default */
  }

  return { carryForwardMinor: 0, source: 'default:zero' };
}

/** Load a shift row or throw 404. */
export async function loadShiftOrThrow(db: PrismaTx | PrismaClient, shiftId: string): Promise<ShiftRowFull> {
  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (shift === null) throw AppError.notFound('Shift not found');
  return shift;
}

/** INV-6 / BE-304: guard a shift-scoped cash write against a CLOSED shift. */
export function assertShiftOpen(status: 'OPEN' | 'CLOSED', shiftId: string): void {
  if (status !== 'OPEN') {
    throw new AppError('SHIFT_NOT_OPEN', `Shift ${shiftId} is ${status}; cash operations require an OPEN shift`, [
      { field: 'shiftId', issue: 'shift is not OPEN', expected: "status = 'OPEN'" },
    ]);
  }
}

/** Full shift row projection shared by the service and DTO mappers. */
export interface ShiftRowFull {
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

/**
 * Automatically creates or reopens a backing shift for today when SHIFT_SYSTEM_ENABLED=false.
 * Allows the secretary and doctor to work seamlessly without manual shift opening ceremony.
 */
export async function ensureAutoShift(
  db: PrismaTx | PrismaClient,
  actorUserId?: string,
): Promise<{ id: string; queueVersion: number; status: string }> {
  // Check if there is already an OPEN shift
  const openShift = await db.shift.findFirst({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });
  if (openShift !== null) {
    return { id: openShift.id, queueVersion: openShift.queueVersion, status: openShift.status };
  }

  const businessDate = toBusinessDate(new Date());

  // Check if today's shift was already created and closed
  const existingToday = await db.shift.findUnique({
    where: { businessDate },
  });

  if (existingToday !== null) {
    // Reopen today's shift freely (P1-7: "The secretary can close the day and reopen freely; the next day starts fresh")
    const reopened = await db.shift.update({
      where: { id: existingToday.id },
      data: {
        status: 'OPEN',
        closedAt: null,
        closedByUserId: null,
        closeIdempotencyKey: null,
      },
    });
    return { id: reopened.id, queueVersion: reopened.queueVersion, status: reopened.status };
  }

  // Find a valid user id for openedByUserId if not passed
  let userId = actorUserId;
  if (!userId && typeof (db as PrismaClient).user?.findFirst === 'function') {
    const user = await (db as PrismaClient).user.findFirst({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    userId = user?.id;
  }
  if (!userId) {
    userId = 'system-auto-shift';
  }

  const carry = await deriveOpeningCarryForward(db, businessDate);

  try {
    const created = await db.shift.create({
      data: {
        businessDate,
        status: 'OPEN',
        openingFloatMinor: carry.carryForwardMinor,
        openingCarryForwardMinor: carry.carryForwardMinor,
        openingDiscrepancyMinor: 0,
        queueVersion: 0,
        openedByUserId: userId,
      },
      select: { id: true, queueVersion: true, status: true },
    });

    return created;
  } catch (err) {
    if (isUniqueViolation(err, 'business_date') || isUniqueViolation(err, 'uq_shifts_single_open') || isUniqueViolation(err, 'status')) {
      const fallback = await db.shift.findFirst({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      });
      if (fallback !== null) {
        return { id: fallback.id, queueVersion: fallback.queueVersion, status: fallback.status };
      }
    }
    throw err;
  }
}

