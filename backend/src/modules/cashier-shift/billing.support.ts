import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';
import type { InvoiceStatusDto } from './billing.dto.js';

export type PrismaTx = Prisma.TransactionClient;

export interface ClinicFees {
  readonly standardFeeMinor: number;
  readonly secretaryMaxDiscountMinor: number;
  readonly secretaryMaxDiscountPct: number;
}

/** CONV-04 / DB-11: row lock on the shift for ALL cash mutations. */
export async function lockShift(tx: PrismaTx, shiftId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${shiftId} FOR UPDATE`;
}

/** Patient row lock for multi-invoice settlement (serializes concurrent settles). */
export async function lockPatient(tx: PrismaTx, patientId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} FOR UPDATE`;
}

/** Load the OPEN shift or throw 409 NO_OPEN_SHIFT. */
export async function getOpenShiftOrThrow(
  db: PrismaTx | PrismaClient,
): Promise<{ id: string; queueVersion: number }> {
  const shift = await db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true, queueVersion: true } });
  if (shift === null) {
    throw new AppError('NO_OPEN_SHIFT', 'No open shift');
  }
  return { id: shift.id, queueVersion: shift.queueVersion };
}

/** Clinic fee + secretary discount-floor constants (settings row -> env fallback). */
export async function loadClinicFees(db: PrismaTx | PrismaClient): Promise<ClinicFees> {
  const env = loadEnv();
  const fallback: ClinicFees = {
    standardFeeMinor: env.CLINIC_DEFAULT_FEE_MINOR,
    secretaryMaxDiscountMinor: env.CLINIC_SECRETARY_MAX_DISCOUNT_MINOR,
    secretaryMaxDiscountPct: env.CLINIC_SECRETARY_MAX_DISCOUNT_PCT,
  };
  try {
    const row = await db.clinicSettings.findUnique({
      where: { id: 'singleton' },
      select: { standardFeeMinor: true, secretaryMaxDiscountMinor: true, secretaryMaxDiscountPct: true },
    });
    if (row === null) return fallback;
    return {
      standardFeeMinor: row.standardFeeMinor,
      secretaryMaxDiscountMinor: row.secretaryMaxDiscountMinor,
      secretaryMaxDiscountPct: row.secretaryMaxDiscountPct,
    };
  } catch {
    return fallback;
  }
}

/** DB-07 / INV-2: outstanding excludes write-off, floored at 0. */
export function computeOutstanding(finalFeeMinor: number, collectedMinor: number, writeOffMinor: number): number {
  return Math.max(0, finalFeeMinor - collectedMinor - writeOffMinor);
}

/**
 * Derive invoice status from money (never set status directly except via these
 * transitions).
 *
 * E-3 regression guard: `WRITTEN_OFF` is a TERMINAL state. Once a doctor writes
 * off an invoice it must never be resurrected by a later receipt recompute, so
 * an already-written-off row (or one whose outstanding is 0 with a write-off
 * applied) pins to `WRITTEN_OFF`.
 */
export function deriveInvoiceStatus(
  finalFeeMinor: number,
  collectedMinor: number,
  isComplimentary: boolean,
  currentStatus?: string | null,
  writeOffMinor = 0,
): InvoiceStatusDto {
  if (isComplimentary) return 'COMPLIMENTARY';
  const outstanding = computeOutstanding(finalFeeMinor, collectedMinor, writeOffMinor);
  if (currentStatus === 'WRITTEN_OFF' || (writeOffMinor > 0 && outstanding === 0)) {
    return 'WRITTEN_OFF';
  }
  if (collectedMinor >= finalFeeMinor) return 'PAID';
  if (collectedMinor > 0) return 'PARTIAL';
  return 'UNPAID';
}

/**
 * DB-07: recompute Invoice.collectedMinor as (sum of CHARGE) - (sum of REVERSAL),
 * then derive outstanding + status. Collected is ALWAYS derived from receipts,
 * never written from an arbitrary input. Returns the refreshed invoice row.
 */
export async function recomputeInvoiceFromReceipts(
  tx: PrismaTx,
  invoiceId: string,
): Promise<{
  id: string;
  patientId: string;
  queueEntryId: string;
  standardFeeMinor: number;
  finalFeeMinor: number;
  discountMinor: number;
  discountReason: string | null;
  isComplimentary: boolean;
  collectedMinor: number;
  writeOffMinor: number;
  outstandingMinor: number;
  status: string;
  complimentaryAuthorizedByUserId: string | null;
  createdAt: Date;
}> {
  const grouped = await tx.receipt.groupBy({
    by: ['type'],
    where: { invoiceId },
    _sum: { amountMinor: true },
  });
  let charges = 0;
  let reversals = 0;
  for (const g of grouped) {
    const sum = g._sum.amountMinor ?? 0;
    if (g.type === 'CHARGE') charges += sum;
    else if (g.type === 'REVERSAL') reversals += sum;
  }
  const collected = Math.max(0, charges - reversals);

  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const outstanding = computeOutstanding(invoice.finalFeeMinor, collected, invoice.writeOffMinor);
  const status = deriveInvoiceStatus(invoice.finalFeeMinor, collected, invoice.isComplimentary, invoice.status, invoice.writeOffMinor);

  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: { collectedMinor: collected, outstandingMinor: outstanding, status },
  });
  // Keep Patient.outstandingBalanceMinor in sync (search/detail debt alerts).
  await syncPatientOutstanding(tx, invoice.patientId);
  return updated;
}

/** Sum of REVERSAL amounts already applied against a given original receipt. */
export async function sumReversalsForReceipt(tx: PrismaTx, originalReceiptId: string): Promise<number> {
  const agg = await tx.receipt.aggregate({
    where: { reversalOfReceiptId: originalReceiptId, type: 'REVERSAL' },
    _sum: { amountMinor: true },
  });
  return agg._sum.amountMinor ?? 0;
}

/**
 * DB-17 / search-debt parity: recompute Patient.outstandingBalanceMinor as the
 * sum of outstanding over the patient's UNPAID/PARTIAL invoices. Called from
 * recomputeInvoiceFromReceipts (the single derivation chokepoint for every money
 * mutation) so the search/detail DTOs' `hasDebtAlert` / `outstandingBalanceMinor`
 * stay accurate instead of remaining 0 forever. Runs inside the caller's tx.
 */
export async function syncPatientOutstanding(tx: PrismaTx, patientId: string): Promise<number> {
  const agg = await tx.invoice.aggregate({
    where: { patientId, status: { in: ['UNPAID', 'PARTIAL'] } },
    _sum: { outstandingMinor: true },
  });
  const total = agg._sum.outstandingMinor ?? 0;
  await tx.patient.update({ where: { id: patientId }, data: { outstandingBalanceMinor: total } });
  return total;
}

export type BillingAuditAction =
  | 'CHECKOUT'
  | 'INVOICE_PAY'
  | 'WRITE_OFF'
  | 'COMPLIMENTARY'
  | 'RECEIPT_REVERSAL'
  | 'DISCOUNT_FLOOR_BLOCKED';

/**
 * Atomic billing audit (INV-10 coverage). Written INSIDE the money transaction
 * so coverage cannot drift. Each call gets a unique requestId.
 */
export async function writeBillingAudit(
  tx: PrismaTx,
  params: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: BillingAuditAction;
    entityType: string;
    entityId: string;
    reasonText?: string | null;
    idempotencyKey?: string | null;
    beforeState?: Prisma.InputJsonValue;
    afterState?: Prisma.InputJsonValue;
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
 * Standalone (auto-committed) audit write for a REJECTED request — used when the
 * money transaction never opens (e.g. secretary discount-floor block) so the
 * audit survives the aborted operation. Best-effort with warn log.
 */
export async function writeBillingAuditStandalone(
  db: PrismaClient,
  params: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: BillingAuditAction;
    entityType: string;
    entityId: string;
    reasonText?: string | null;
    idempotencyKey?: string | null;
    afterState?: Prisma.InputJsonValue;
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
    logger.warn('billing.audit.standaloneWriteFailed', { action: params.action, err: String(err) });
  }
}

/**
 * DB-09 secretary discount floor. "Tighter of absolute + pct wins": a SECRETARY
 * P1-1: Ceiling enforcement for the SECRETARY role has been removed.
 * The secretary may enter ANY discount value with a mandatory reason.
 * The doctor path is unchanged. Settings fields remain in DB, but the cap is no longer enforced.
 */
export function assertSecretaryDiscountFloor(
  _actorRole: 'DOCTOR' | 'SECRETARY',
  _standardFeeMinor: number,
  _finalFeeMinor: number,
  _fees: ClinicFees,
): void {
  // P1-1: Secretary discount cap removed per business rule change.
  // Any discount value is permitted; mandatory reason (10-300 chars) is validated at checkout/update.
  return;
}
