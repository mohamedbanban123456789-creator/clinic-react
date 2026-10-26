import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { isUniqueViolation } from '../../common/db/unique-violation.js';
import type { SecretSafe } from '../../common/types/secretSafe.js';
import { broadcastIntercom } from '../../common/realtime.js';
import { toSecretIntercomDto } from '../intercom-realtime/intercom.dto.js';
import { writeAudit } from '../../common/audit.js';
import {
  toSecretCheckoutDto,
  toSecretComplimentaryDto,
  toSecretInvoiceDto,
  toSecretInvoiceListDto,
  toSecretPayResultDto,
  toSecretPatientBalanceDto,
  toSecretReceiptDto,
  toSecretReceiptListDto,
  toSecretReverseDto,
  toSecretSettleDto,
  toSecretWriteOffDto,
  toInvoiceRow,
  toReceiptRow,
  type CheckoutDto,
  type ComplimentaryDto,
  type InvoiceListDto,
  type PatientBalanceDto,
  type PaymentMethodDto,
  type PayResultDto,
  type ReceiptDto,
  type ReceiptListDto,
  type ReverseDto,
  type SettleDto,
  type SettleLineDto,
  type WriteOffDto,
} from './billing.dto.js';
import {
  computeOutstanding,
  getOpenShiftOrThrow,
  loadClinicFees,
  lockPatient,
  lockShift,
  recomputeInvoiceFromReceipts,
  sumReversalsForReceipt,
  syncPatientOutstanding,
  writeBillingAudit,
  writeBillingAuditStandalone,
} from './billing.support.js';
import type {
  CheckoutInput,
  ComplimentaryInput,
  InvoicesQuery,
  PayInvoiceInput,
  ReceiptsQuery,
  ReverseInput,
  SettleInput,
  WriteOffInput,
} from './billing.validators.js';

export interface Actor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

/**
 * BE-301 POST /billing/checkout [BOTH] — composite create + first payment.
 * Ensures an Invoice exists for a COMPLETED queue entry (standard-fee snapshot
 * if new), enforces the secretary discount floor + mandatory discount reason,
 * permits fee override only while nothing is collected, records the optional
 * first CHARGE receipt, and derives status. Single atomic lockShift transaction.
 */
export async function checkout(
  input: CheckoutInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<CheckoutDto>> {
  const openShift = await getOpenShiftOrThrow(db);
  const entry = await db.queueEntry.findUnique({ where: { id: input.queueEntryId } });
  if (entry === null) throw AppError.notFound('Queue entry not found');
  if (entry.status !== 'COMPLETED') {
    throw new AppError('CONFLICT', 'Queue entry must be COMPLETED before checkout');
  }

  const fees = await loadClinicFees(db);
  const existing = await db.invoice.findUnique({ where: { queueEntryId: input.queueEntryId } });

  // E-3: a written-off invoice is terminal. Re-checkout must never resurrect it.
  if (existing !== null && existing.status === 'WRITTEN_OFF') {
    throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is written off; no further collection is permitted');
  }

  const standardFee = existing?.standardFeeMinor ?? fees.standardFeeMinor;
  let finalFee: number;
  let feeTouched: boolean;
  if (existing === null) {
    finalFee = input.finalFeeMinor ?? standardFee;
    feeTouched = true;
  } else if (input.finalFeeMinor !== undefined) {
    if (existing.collectedMinor > 0) {
      throw new AppError('CONFLICT', 'Fee override is not permitted once payments have been collected');
    }
    finalFee = input.finalFeeMinor;
    feeTouched = true;
  } else {
    finalFee = existing.finalFeeMinor;
    feeTouched = false;
  }

  const discounted = finalFee < standardFee;

  // Discount governance runs BEFORE the money tx: reason (10-300 chars) is mandatory.
  // P1-1: Secretary discount ceiling cap enforcement is removed; secretary discount
  // is applied as given with mandatory reason + audit trail.
  if (feeTouched && discounted) {
    if (input.discountReason === undefined || input.discountReason.trim().length < 10) {
      throw new AppError('UNPROCESSABLE', 'discountReason is required (10-300 chars) when finalFeeMinor < standardFeeMinor', [
        { field: 'discountReason', issue: 'required when discounted', expected: '10-300 characters' },
      ]);
    }
  }

  const method: PaymentMethodDto = input.method ?? 'CASH';
  const collected = input.collectedMinor;
  const discountReason = discounted ? input.discountReason ?? null : null;

  try {
    const result = await db.$transaction(async (tx) => {
      await lockShift(tx, openShift.id);
      const inv = await tx.invoice.findUnique({ where: { queueEntryId: input.queueEntryId } });

      // Re-check under the shift lock: the row may have been written off since
      // the pre-transaction read above (TOCTOU across concurrent cash mutations).
      if (inv !== null && inv.status === 'WRITTEN_OFF') {
        throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is written off; no further collection is permitted');
      }

      let invoice;
      if (inv === null) {
        invoice = await tx.invoice.create({
          data: {
            patientId: entry.patientId,
            queueEntryId: entry.id,
            shiftId: entry.shiftId,
            standardFeeMinor: standardFee,
            finalFeeMinor: finalFee,
            discountMinor: Math.max(0, standardFee - finalFee),
            discountReason,
            isComplimentary: false,
            collectedMinor: 0,
            writeOffMinor: 0,
            outstandingMinor: finalFee,
            status: 'UNPAID',
            source: 'CHECKOUT',
            idempotencyKey,
            createdByUserId: actor.userId,
          },
        });
      } else {
        if (feeTouched && inv.collectedMinor > 0) {
          throw new AppError('CONFLICT', 'Fee override is not permitted once payments have been collected');
        }
        invoice = await tx.invoice.update({
          where: { id: inv.id },
          data: feeTouched
            ? {
                finalFeeMinor: finalFee,
                discountMinor: Math.max(0, standardFee - finalFee),
                discountReason,
                outstandingMinor: computeOutstanding(finalFee, inv.collectedMinor, inv.writeOffMinor),
              }
            : {},
        });
      }

      let receipt = null;
      if (collected > 0) {
        if (collected > invoice.outstandingMinor) {
          throw new AppError('OVERPAYMENT_REJECTED', `collectedMinor ${collected} exceeds outstanding ${invoice.outstandingMinor}`, [
            { field: 'collectedMinor', issue: 'exceeds outstanding', expected: `<= ${invoice.outstandingMinor}` },
          ]);
        }
        receipt = await tx.receipt.create({
          data: {
            invoiceId: invoice.id,
            patientId: entry.patientId,
            shiftId: openShift.id,
            actorUserId: actor.userId,
            type: 'CHARGE',
            amountMinor: collected,
            paymentMethod: method,
            idempotencyKey: `${idempotencyKey}:initial`,
          },
        });
      }

      const updated = await recomputeInvoiceFromReceipts(tx, invoice.id);
      const auditParams: Parameters<typeof writeBillingAudit>[1] = {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'CHECKOUT',
        entityType: 'Invoice',
        entityId: invoice.id,
        idempotencyKey,
        afterState: { finalFeeMinor: updated.finalFeeMinor, collectedMinor: updated.collectedMinor, status: updated.status },
        ...(existing !== null
          ? { beforeState: { finalFeeMinor: existing.finalFeeMinor, collectedMinor: existing.collectedMinor, status: existing.status } }
          : {}),
      };
      await writeBillingAudit(tx, auditParams);

      // P1-2: Post-completion price review chat message between secretary and doctor.
      let reviewMessage: {
        id: string;
        fromUserId: string;
        fromRole: 'DOCTOR' | 'SECRETARY';
        messageType: 'CUSTOM_TEXT';
        bodyText: string | null;
        relatedQueueEntryId: string | null;
        relatedInvoiceId: string | null;
        createdAt: Date;
      } | null = null;

      try {
        const patient = await tx.patient.findUnique({
          where: { id: entry.patientId },
          select: { fullName: true },
        });
        const patientName = patient?.fullName ?? `مريض ${entry.patientId.slice(-6)}`;
        const reviewText = `طلب مراجعة السعر: يرجى كتابة السعر النهائي بعد أي خصم لزيارة ${patientName} (المسجل: ${updated.finalFeeMinor / 100} ج.م)`;
        const createdMsg = await tx.intercomMessage.create({
          data: {
            fromUserId: actor.userId,
            fromRole: actor.role,
            messageType: 'CUSTOM_TEXT',
            bodyText: reviewText,
            relatedQueueEntryId: entry.id,
            relatedInvoiceId: updated.id,
          },
        });
        reviewMessage = {
          id: createdMsg.id,
          fromUserId: createdMsg.fromUserId,
          fromRole: createdMsg.fromRole as 'DOCTOR' | 'SECRETARY',
          messageType: 'CUSTOM_TEXT',
          bodyText: createdMsg.bodyText,
          relatedQueueEntryId: createdMsg.relatedQueueEntryId,
          relatedInvoiceId: createdMsg.relatedInvoiceId,
          createdAt: createdMsg.createdAt,
        };

        await writeAudit(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'INTERCOM_SEND',
          entityType: 'IntercomMessage',
          entityId: createdMsg.id,
          afterState: {
            type: 'CUSTOM_TEXT',
            relatedQueueEntryId: entry.id,
            relatedInvoiceId: updated.id,
            isPriceReview: true,
          },
        });
      } catch {
        // Review chat is visibility-only; failures must never block checkout.
      }

      return { invoice: updated, receipt, reviewMessage };
    });

    if (result.reviewMessage !== null) {
      broadcastIntercom(toSecretIntercomDto(result.reviewMessage));
    }

    return toSecretCheckoutDto(
      toInvoiceRow(result.invoice),
      result.receipt === null ? null : toReceiptRow(result.receipt),
      method,
    );
  } catch (err) {
    if (isUniqueViolation(err, 'queue_entry_id')) {
      throw new AppError('CONFLICT', 'Invoice already exists for this queue entry');
    }
    throw err;
  }
}

/**
 * BE-301 POST /billing/complimentary [DOCTOR] — zero-fee waiver.
 * Targets an invoiceId or a queueEntryId (creating the invoice snapshot if the
 * entry has none). Allowed ONLY on an UNPAID invoice with no collected payments
 * (else 409 MUST_REVERSE_FIRST). Writes a zero CHARGE receipt for traceability.
 */
export async function complimentary(
  input: ComplimentaryInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ComplimentaryDto>> {
  if (actor.role !== 'DOCTOR') {
    throw AppError.forbidden('Only a doctor may authorize a complimentary visit');
  }
  const openShift = await getOpenShiftOrThrow(db);
  const fees = await loadClinicFees(db);

  let target: { id: string; collectedMinor: number; status: string } | null = null;
  let entry: { id: string; patientId: string; shiftId: string } | null = null;
  if (input.invoiceId !== undefined) {
    const found = await db.invoice.findUnique({ where: { id: input.invoiceId } });
    if (found === null) throw AppError.notFound('Invoice not found');
    target = found;
  } else if (input.queueEntryId !== undefined) {
    const e = await db.queueEntry.findUnique({ where: { id: input.queueEntryId } });
    if (e === null) throw AppError.notFound('Queue entry not found');
    entry = { id: e.id, patientId: e.patientId, shiftId: e.shiftId };
    const found = await db.invoice.findUnique({ where: { queueEntryId: e.id } });
    target = found;
  }

  if (target !== null) {
    if (target.collectedMinor > 0) {
      throw new AppError('MUST_REVERSE_FIRST', 'Invoice has collected payments; reverse them before marking complimentary');
    }
    if (target.status === 'COMPLIMENTARY') {
      throw new AppError('CONFLICT', 'Invoice is already complimentary');
    }
    if (target.status !== 'UNPAID') {
      throw new AppError('CONFLICT', `Invoice is ${target.status}; only UNPAID invoices can be marked complimentary`);
    }
  }

  const result = await db.$transaction(async (tx) => {
    await lockShift(tx, openShift.id);

    let invoice;
    if (target !== null) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: target.id } });
      if (inv.collectedMinor > 0) {
        throw new AppError('MUST_REVERSE_FIRST', 'Invoice has collected payments; reverse them before marking complimentary');
      }
      if (inv.status !== 'UNPAID') {
        throw new AppError('CONFLICT', `Invoice is ${inv.status}; only UNPAID invoices can be marked complimentary`);
      }
      // final 0; discountMinor carries the waived amount so standard = final + discount.
      invoice = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          finalFeeMinor: 0,
          discountMinor: inv.standardFeeMinor,
          isComplimentary: true,
          complimentaryAuthorizedByUserId: actor.userId,
          outstandingMinor: 0,
          status: 'COMPLIMENTARY',
        },
      });
    } else {
      if (entry === null) throw AppError.notFound('Queue entry not found');
      invoice = await tx.invoice.create({
        data: {
          patientId: entry.patientId,
          queueEntryId: entry.id,
          shiftId: entry.shiftId,
          standardFeeMinor: fees.standardFeeMinor,
          finalFeeMinor: 0,
          discountMinor: fees.standardFeeMinor,
          discountReason: null,
          isComplimentary: true,
          complimentaryAuthorizedByUserId: actor.userId,
          collectedMinor: 0,
          writeOffMinor: 0,
          outstandingMinor: 0,
          status: 'COMPLIMENTARY',
          source: 'COMPLIMENTARY',
          idempotencyKey,
          createdByUserId: actor.userId,
        },
      });
    }

    const receipt = await tx.receipt.create({
      data: {
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        shiftId: openShift.id,
        actorUserId: actor.userId,
        type: 'CHARGE',
        amountMinor: 0,
        paymentMethod: 'CASH',
        idempotencyKey: `${idempotencyKey}:complimentary`,
      },
    });

    // E-4: the waiver removes the invoice from the UNPAID/PARTIAL rollup, so
    // Patient.outstandingBalanceMinor (and the derived hasDebtAlert) must be
    // recomputed inside this transaction or the cached debt goes stale.
    await syncPatientOutstanding(tx, invoice.patientId);

    await writeBillingAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'COMPLIMENTARY',
      entityType: 'Invoice',
      entityId: invoice.id,
      idempotencyKey,
      reasonText: input.note ?? null,
      afterState: { status: 'COMPLIMENTARY', finalFeeMinor: 0 },
    });
    return { invoice, receipt };
  });

  return toSecretComplimentaryDto(toInvoiceRow(result.invoice), toReceiptRow(result.receipt), actor.userId);
}

/**
 * BE-302 POST /billing/invoices/:id/pay [BOTH] — debt settlement primitive.
 * Collects against an existing UNPAID/PARTIAL invoice (never changes finalFee),
 * rejects overpayment, issues a CHARGE receipt into the current open shift, and
 * recomputes collected/outstanding/status. Requires an active OPEN shift.
 */
export async function payInvoice(
  invoiceId: string,
  input: PayInvoiceInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<PayResultDto>> {
  const openShift = await getOpenShiftOrThrow(db);
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (invoice === null) throw AppError.notFound('Invoice not found');
  // E-3: written-off is terminal — never collectable again, no resurrection.
  if (invoice.status === 'WRITTEN_OFF') {
    throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is written off; no further collection is permitted');
  }
  if (invoice.status === 'PAID' || invoice.status === 'COMPLIMENTARY') {
    throw new AppError('BAD_REQUEST', 'Invoice has nothing due');
  }

  const amount = input.amountMinor;
  const method: PaymentMethodDto = input.method ?? 'CASH';

  const result = await db.$transaction(async (tx) => {
    await lockShift(tx, openShift.id);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'WRITTEN_OFF') {
      throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is written off; no further collection is permitted');
    }
    if (inv.status === 'PAID' || inv.status === 'COMPLIMENTARY') {
      throw new AppError('BAD_REQUEST', 'Invoice has nothing due');
    }
    if (amount > inv.outstandingMinor) {
      throw new AppError('OVERPAYMENT_REJECTED', `amount ${amount} exceeds outstanding ${inv.outstandingMinor}`, [
        { field: 'amountMinor', issue: 'exceeds outstanding', expected: `<= ${inv.outstandingMinor}` },
      ]);
    }
    const receipt = await tx.receipt.create({
      data: {
        invoiceId,
        patientId: inv.patientId,
        shiftId: openShift.id,
        actorUserId: actor.userId,
        type: 'CHARGE',
        amountMinor: amount,
        paymentMethod: method,
        idempotencyKey,
      },
    });
    const updated = await recomputeInvoiceFromReceipts(tx, invoiceId);
    await writeBillingAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'INVOICE_PAY',
      entityType: 'Invoice',
      entityId: invoiceId,
      idempotencyKey,
      beforeState: { collectedMinor: inv.collectedMinor, outstandingMinor: inv.outstandingMinor, status: inv.status },
      afterState: { collectedMinor: updated.collectedMinor, outstandingMinor: updated.outstandingMinor, status: updated.status, amountMinor: amount },
    });
    return { invoice: updated, receipt };
  });

  return toSecretPayResultDto(toInvoiceRow(result.invoice), toReceiptRow(result.receipt), amount, method);
}

/**
 * BE-302 POST /patients/:id/settle [BOTH] — multi-invoice debt settlement.
 * Allocates the payment oldest-first across the patient's UNPAID/PARTIAL
 * invoices in a single transaction under a patient row lock + shift lock.
 * Rejects amounts exceeding total outstanding.
 */
export async function settle(
  patientId: string,
  input: SettleInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<SettleDto>> {
  const openShift = await getOpenShiftOrThrow(db);
  const patient = await db.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (patient === null) throw AppError.notFound('Patient not found');

  const amount = input.amountMinor;
  const method: PaymentMethodDto = input.method ?? 'CASH';

  const result = await db.$transaction(async (tx) => {
    await lockPatient(tx, patientId);
    await lockShift(tx, openShift.id);

    const invoices = await tx.invoice.findMany({
      where: { patientId, status: { in: ['UNPAID', 'PARTIAL'] } },
      orderBy: { createdAt: 'asc' },
    });
    const totalOutstanding = invoices.reduce((sum, i) => sum + i.outstandingMinor, 0);
    if (amount > totalOutstanding) {
      throw new AppError('OVERPAYMENT_REJECTED', `amount ${amount} exceeds total outstanding ${totalOutstanding}`, [
        { field: 'amountMinor', issue: 'exceeds total outstanding', expected: `<= ${totalOutstanding}` },
      ]);
    }

    let remaining = amount;
    const lines: SettleLineDto[] = [];
    for (const inv of invoices) {
      if (remaining <= 0) break;
      const pay = Math.min(remaining, inv.outstandingMinor);
      if (pay <= 0) continue;
      const receipt = await tx.receipt.create({
        data: {
          invoiceId: inv.id,
          patientId,
          shiftId: openShift.id,
          actorUserId: actor.userId,
          type: 'CHARGE',
          amountMinor: pay,
          paymentMethod: method,
          idempotencyKey: `${idempotencyKey}:${inv.id}`,
        },
      });
      const updated = await recomputeInvoiceFromReceipts(tx, inv.id);
      await writeBillingAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'INVOICE_PAY',
        entityType: 'Invoice',
        entityId: inv.id,
        idempotencyKey: `${idempotencyKey}:${inv.id}`,
        beforeState: { collectedMinor: inv.collectedMinor, outstandingMinor: inv.outstandingMinor, status: inv.status },
        afterState: { collectedMinor: updated.collectedMinor, outstandingMinor: updated.outstandingMinor, status: updated.status, amountMinor: pay },
      });
      lines.push({ invoiceId: inv.id, receiptId: receipt.id, amountMinor: pay, status: updated.status as SettleLineDto['status'] });
      remaining -= pay;
    }

    const after = await tx.invoice.aggregate({
      where: { patientId, status: { in: ['UNPAID', 'PARTIAL'] } },
      _sum: { outstandingMinor: true },
    });
    return { lines, outstandingMinor: after._sum.outstandingMinor ?? 0 };
  });

  return toSecretSettleDto(patientId, amount, method, result.lines, result.outstandingMinor);
}

/**
 * BE-303 POST /billing/receipts/:id/reverse [DOCTOR] — receipt reversal engine.
 * Corrects an erroneous CHARGE by issuing a REVERSAL receipt linked via
 * reversalOfReceiptId, netted into the CURRENT open shift (cross-shift netting).
 * Cumulative reversals cannot exceed the original receipt amount. Decrements the
 * invoice's collected total (recomputed from receipts) and audits RECEIPT_REVERSAL.
 */
export async function reverseReceipt(
  receiptId: string,
  input: ReverseInput,
  actor: Actor,
  idempotencyKey: string,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReverseDto>> {
  if (actor.role !== 'DOCTOR') {
    throw AppError.forbidden('Only a doctor may reverse a financial receipt');
  }
  const openShift = await getOpenShiftOrThrow(db);
  const original = await db.receipt.findUnique({ where: { id: receiptId } });
  if (original === null) throw AppError.notFound('Receipt not found');
  if (original.type !== 'CHARGE') {
    throw new AppError('BAD_REQUEST', 'Only CHARGE receipts can be reversed');
  }

  const amount = input.amountMinor;

  const result = await db.$transaction(async (tx) => {
    await lockShift(tx, openShift.id);
    const orig = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (orig.type !== 'CHARGE') {
      throw new AppError('BAD_REQUEST', 'Only CHARGE receipts can be reversed');
    }
    const alreadyReversed = await sumReversalsForReceipt(tx, receiptId);
    if (alreadyReversed + amount > orig.amountMinor) {
      throw new AppError(
        'REVERSAL_EXCEEDS_ORIGINAL',
        `cumulative reversals ${alreadyReversed + amount} exceed original ${orig.amountMinor}`,
        [{ field: 'amountMinor', issue: 'exceeds reversible remainder', expected: `<= ${orig.amountMinor - alreadyReversed}` }],
      );
    }
    const reversal = await tx.receipt.create({
      data: {
        invoiceId: orig.invoiceId,
        patientId: orig.patientId,
        shiftId: openShift.id,
        actorUserId: actor.userId,
        type: 'REVERSAL',
        amountMinor: amount,
        paymentMethod: orig.paymentMethod,
        reversalOfReceiptId: orig.id,
        reason: input.reason,
        idempotencyKey,
      },
    });
    const updated = await recomputeInvoiceFromReceipts(tx, orig.invoiceId);
    await writeBillingAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'RECEIPT_REVERSAL',
      entityType: 'Receipt',
      entityId: reversal.id,
      reasonText: input.reason,
      idempotencyKey,
      beforeState: { originalReceiptId: orig.id, collectedMinor: updated.collectedMinor + amount },
      afterState: { reversalReceiptId: reversal.id, amountMinor: amount, collectedMinor: updated.collectedMinor, status: updated.status },
    });
    return { invoice: updated, reversal };
  });

  return toSecretReverseDto(toInvoiceRow(result.invoice), toReceiptRow(result.reversal));
}

/** BE-303 GET /receipts?patientId=&shiftId=&invoiceId= [BOTH] — immutable archive. */
export async function listReceipts(
  query: ReceiptsQuery,
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<ReceiptListDto>> {
  const where: Prisma.ReceiptWhereInput = {};
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.shiftId !== undefined) where.shiftId = query.shiftId;
  if (query.invoiceId !== undefined) where.invoiceId = query.invoiceId;

  // BLIND COUNT (DB-10): a SECRETARY must not be able to sum the OPEN shift's
  // CASH receipts to reconstruct the expected drawer total before close. EVERY
  // SECRETARY read path is guarded:
  //   - shiftId-scoped: reject when that shift is OPEN.
  //   - patientId/invoiceId-scoped: reject when ANY matching receipt sits on the
  //     OPEN shift (closed-shift history stays fully readable; today's rows are
  //     withheld — the operator already has the paper receipts they issued).
  //   - unscoped: reject outright (one-shot aggregation vector).
  // A DOCTOR may always read receipts.
  if (actor.role === 'SECRETARY') {
    if (query.shiftId !== undefined) {
      const shift = await db.shift.findUnique({ where: { id: query.shiftId }, select: { status: true } });
      if (shift !== null && shift.status === 'OPEN') {
        throw AppError.forbidden('Receipts for an open shift are not available before close');
      }
    } else if (query.patientId !== undefined || query.invoiceId !== undefined) {
      const openShift = await db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
      if (openShift !== null) {
        const openRows = await db.receipt.findFirst({ where: { ...where, shiftId: openShift.id }, select: { id: true } });
        if (openRows !== null) {
          throw AppError.forbidden('Receipts for an open shift are not available before close');
        }
      }
    } else {
      throw AppError.forbidden('Receipt archive requires a shiftId, patientId, or invoiceId scope before close');
    }
  }

  const limit = query.limit ?? 50;
  const rows = await db.receipt.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return toSecretReceiptListDto(page.map((r) => toSecretReceiptDto(toReceiptRow(r))), nextCursor);
}

/** BE-303 GET /receipts/:id [BOTH] — single immutable receipt (blind-guarded for SECRETARY). */
export async function getReceipt(receiptId: string, actor: Actor, db: PrismaClient = prisma): Promise<SecretSafe<ReceiptDto>> {
  const receipt = await db.receipt.findUnique({ where: { id: receiptId } });
  if (receipt === null) throw AppError.notFound('Receipt not found');
  // BLIND COUNT (DB-10): the same OPEN-shift protection as the list — a
  // SECRETARY must not read CASH amounts from the shift they will count.
  if (actor.role === 'SECRETARY') {
    const shift = await db.shift.findUnique({ where: { id: receipt.shiftId }, select: { status: true } });
    if (shift !== null && shift.status === 'OPEN') {
      throw AppError.forbidden('Receipts for an open shift are not available before close');
    }
  }
  return toSecretReceiptDto(toReceiptRow(receipt));
}

/**
 * BE-302 / RPS-2 DB-17 POST /billing/invoices/:id/write-off [DOCTOR] —
 * uncollectible-debt closure (NEVER a delete). Adds the requested amount to
 * Invoice.writeOffMinor with a mandatory reason, recomputes outstanding via the
 * DB-07 formula (max(0, final - collected - writeOff)), flips the status to
 * WRITTEN_OFF when nothing remains due, syncs the patient balance rollup, and
 * audits INVOICE_WRITE_OFF — all inside a lockShift transaction.
 */
export async function writeOffInvoice(
  invoiceId: string,
  input: WriteOffInput,
  actor: Actor,
  idempotencyKey: string | null,
  db: PrismaClient = prisma,
): Promise<SecretSafe<WriteOffDto>> {
  if (actor.role !== 'DOCTOR') {
    throw AppError.forbidden('Only a doctor may write off an invoice');
  }
  const openShift = await getOpenShiftOrThrow(db);
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (invoice === null) throw AppError.notFound('Invoice not found');
  if (invoice.status === 'WRITTEN_OFF') {
    throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is already written off');
  }
  if (invoice.status === 'PAID' || invoice.status === 'COMPLIMENTARY' || invoice.outstandingMinor <= 0) {
    throw new AppError('BAD_REQUEST', 'Invoice has nothing due');
  }

  const result = await db.$transaction(async (tx) => {
    await lockShift(tx, openShift.id);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'WRITTEN_OFF') {
      throw new AppError('INVOICE_ALREADY_WRITTEN_OFF', 'Invoice is already written off');
    }
    if (inv.status === 'PAID' || inv.status === 'COMPLIMENTARY' || inv.outstandingMinor <= 0) {
      throw new AppError('BAD_REQUEST', 'Invoice has nothing due');
    }
    if (input.writeOffMinor > inv.outstandingMinor) {
      throw new AppError('UNPROCESSABLE', `writeOffMinor ${input.writeOffMinor} exceeds outstanding ${inv.outstandingMinor}`, [
        { field: 'writeOffMinor', issue: 'exceeds outstanding', expected: `<= ${inv.outstandingMinor}` },
      ]);
    }
    const writeOffTotal = inv.writeOffMinor + input.writeOffMinor;
    const outstanding = computeOutstanding(inv.finalFeeMinor, inv.collectedMinor, writeOffTotal);
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        writeOffMinor: writeOffTotal,
        writeOffReason: input.writeOffReason,
        outstandingMinor: outstanding,
        status: outstanding === 0 ? 'WRITTEN_OFF' : inv.status,
      },
    });
    // DB-17 patient rollup: the debt alert clears once nothing remains due.
    await syncPatientOutstanding(tx, inv.patientId);
    await writeBillingAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'WRITE_OFF',
      entityType: 'Invoice',
      entityId: invoiceId,
      reasonText: input.writeOffReason,
      ...(idempotencyKey !== null ? { idempotencyKey } : {}),
      beforeState: { writeOffMinor: inv.writeOffMinor, outstandingMinor: inv.outstandingMinor, status: inv.status },
      afterState: { writeOffMinor: updated.writeOffMinor, outstandingMinor: updated.outstandingMinor, status: updated.status },
    });
    return updated;
  });

  return toSecretWriteOffDto(result.id, result.status as WriteOffDto['status'], result.writeOffMinor, result.outstandingMinor);
}

/**
 * BE-302 GET /billing?shiftId=&patientId=&status= [BOTH] — SecretSafe invoice
 * list with cursor pagination (`?limit&cursor`, global convention). Responses
 * always go through the allowlist-first toSecretInvoiceDto mapper (CONV-02).
 */
export async function listInvoices(
  query: InvoicesQuery,
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<InvoiceListDto>> {
  // BLIND COUNT (DB-10): Invoice.collectedMinor aggregates what has been paid —
  // an OPEN-shift-wide enumeration hands the close submitter the anchor the
  // blind close withholds. SECRETARY aggregate reads are therefore rejected;
  // patient-scoped reads stay allowed (the desk must see what is due to collect
  // for a specific patient during the day — documented residual).
  if (actor.role === 'SECRETARY') {
    if (query.shiftId !== undefined) {
      const shift = await db.shift.findUnique({ where: { id: query.shiftId }, select: { status: true } });
      if (shift !== null && shift.status === 'OPEN') {
        throw AppError.forbidden('Invoice aggregates for an open shift are not available before close');
      }
    } else if (query.patientId === undefined) {
      // Unscoped = shift-wide aggregate — withheld by the blind close (DB-10).
      // Patient-scoped reads stay allowed (the desk must see what is due to
      // collect for a specific patient during the day — documented residual).
      throw AppError.forbidden('Invoice list requires a patientId scope before close');
    }
  }

  const where: Prisma.InvoiceWhereInput = {};
  if (query.shiftId !== undefined) where.shiftId = query.shiftId;
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.status !== undefined) where.status = query.status;

  const limit = query.limit ?? 50;
  const rows = await db.invoice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return toSecretInvoiceListDto(page.map((row) => toSecretInvoiceDto(toInvoiceRow(row))), nextCursor);
}

/**
 * BE-302 GET /patients/:id/balance [BOTH] — outstanding debt rollup
 * (Patient.outstandingBalanceMinor parity: sum over UNPAID/PARTIAL invoices)
 * with per-invoice lines, oldest first. Read-only; no shift required.
 */
export async function getPatientBalance(
  patientId: string,
  _actor: Actor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<PatientBalanceDto>> {
  const patient = await db.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (patient === null) throw AppError.notFound('Patient not found');

  const invoices = await db.invoice.findMany({
    where: { patientId, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
  });
  const outstandingMinor = invoices.reduce((sum, inv) => sum + inv.outstandingMinor, 0);
  const lines = invoices.map((inv) => ({
    invoiceId: inv.id,
    date: inv.createdAt.toISOString(),
    dueMinor: inv.outstandingMinor,
    collectedMinor: inv.collectedMinor,
    writeOffMinor: inv.writeOffMinor,
  }));
  return toSecretPatientBalanceDto(patientId, outstandingMinor, lines);
}
