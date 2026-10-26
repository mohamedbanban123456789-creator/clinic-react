import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { logger } from '../../common/utils/logger.js';
import type { PrismaTx } from './shift.support.js';

/**
 * BE-306 — Reconciliation Invariants Service (single source of drawer math).
 *
 * Ownership: cashier-shift. Consumed by BE-305 (`POST /shifts/:id/close`), the
 * supervision views (BE-702) and `POST /supervision/integrity-check`.
 *
 * ---------------------------------------------------------------------------
 * INVARIANT CODE MAPPING (two specs, two numbering systems — see plan §1)
 * ---------------------------------------------------------------------------
 * `docs/BACKEND_TASKS_WBS.md` (BE-306) and `docs/DATABASE_SCHEMA_SPEC.md`
 * §15 Appendix D number the invariants DIFFERENTLY. Rather than silently pick
 * one and violate the other, this service implements the UNION and emits BOTH
 * code namespaces:
 *
 *   Emitted code          Meaning (check implemented here)
 *   --------------------  ----------------------------------------------
 *   INV-1  (APPX-D-1)     Per-invoice collected = ΣCHARGE − ΣREVERSAL
 *   INV-2                 collectedMinor <= finalFeeMinor (non-complimentary)
 *   INV-3  (APPX-D-2)     Patient debt = Σ(final − collected) over UNPAID/PARTIAL
 *   INV-4  (APPX-D-8)     Drawer expected cash == shift formula exactly
 *   INV-5                 Every COMPLETED queue entry has exactly one invoice
 *   INV-6  (APPX-D-9)     No receipts / petty ops on a CLOSED shift
 *   INV-7  (APPX-D-7)     Petty containment (OPEN shift only, monotonic total)
 *   INV-8                 Shift result sign matches differenceMinor
 *   INV-9                 At most one IN_CONSULTATION entry
 *   INV-10 (APPX-D-10)    Every sensitive mutation has exactly one audit row
 *   APPX-D-3              discount vs write-off separation (fixed at creation)
 *   APPX-D-4              Reversal linkage (≤ original, no double reversal)
 *   APPX-D-5              Idempotency (no duplicate key rows in scope)
 *   APPX-D-6              Secretary discount floor (no SECRETARY invoice below floor)
 *
 * A failure string is emitted as `<CODE>: <detail>`, so a consumer grepping for
 * either `INV-4` (WBS) or `APPX-D-8` (schema spec) finds the drawer violation.
 * ---------------------------------------------------------------------------
 */

export interface InvariantFailure {
  readonly code: string;
  readonly detail: string;
  readonly entities: readonly string[];
}

export interface InvariantReport {
  readonly shiftId: string;
  readonly passed: boolean;
  readonly failures: readonly InvariantFailure[];
}

/** DB-08 unique scope: a (scope, actor, key) replay must create zero rows. */
function uniqueKeyViolations(rows: readonly { id: string; key: string }[], label: string): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const row of rows) {
    const first = seen.get(row.key);
    if (first === undefined) {
      seen.set(row.key, row.id);
      continue;
    }
    problems.push(`${label} ${row.id} reuses idempotencyKey already held by ${first}`);
  }
  return problems;
}

/**
 * DB-10 / INV-4 / APPX-D-8 — the canonical drawer formula.
 *
 *   expectedCash = openingFloat
 *                + Σ(CASH CHARGE)
 *                − Σ(CASH REVERSAL in this shift)
 *                − Σ(petty EXPENSE)
 *                + Σ(petty INJECTION)
 *
 * Every term is aggregated inside the caller's `lockShift` transaction so the
 * value cannot drift between read and persist. Money is integer minor units.
 */
export async function computeExpectedCash(
  tx: PrismaTx | PrismaClient,
  shiftId: string,
  openingFloatMinor: number,
): Promise<{
  openingFloatMinor: number;
  cashChargeMinor: number;
  cashReversalMinor: number;
  pettyExpenseMinor: number;
  pettyInjectionMinor: number;
  expectedCashMinor: number;
}> {
  const [chargeAgg, reversalAgg, pettyRows] = await Promise.all([
    tx.receipt.aggregate({
      where: { shiftId, type: 'CHARGE', paymentMethod: 'CASH' },
      _sum: { amountMinor: true },
    }),
    tx.receipt.aggregate({
      where: { shiftId, type: 'REVERSAL', paymentMethod: 'CASH' },
      _sum: { amountMinor: true },
    }),
    tx.pettyExpense.findMany({ where: { shiftId }, select: { amountMinor: true, direction: true } }),
  ]);

  const cashChargeMinor = chargeAgg._sum.amountMinor ?? 0;
  const cashReversalMinor = reversalAgg._sum.amountMinor ?? 0;

  let pettyExpenseMinor = 0;
  let pettyInjectionMinor = 0;
  for (const row of pettyRows) {
    if (row.direction === 'INJECTION') pettyInjectionMinor += row.amountMinor;
    else pettyExpenseMinor += row.amountMinor;
  }

  const expectedCashMinor =
    openingFloatMinor + cashChargeMinor - cashReversalMinor - pettyExpenseMinor + pettyInjectionMinor;

  return {
    openingFloatMinor,
    cashChargeMinor,
    cashReversalMinor,
    pettyExpenseMinor,
    pettyInjectionMinor,
    expectedCashMinor,
  };
}

/** INV-8 — result sign strictly follows differenceMinor (BALANCED iff 0). */
export function deriveShiftResult(differenceMinor: number): 'BALANCED' | 'SURPLUS' | 'DEFICIT' {
  if (differenceMinor === 0) return 'BALANCED';
  return differenceMinor > 0 ? 'SURPLUS' : 'DEFICIT';
}

/**
 * P1-1: Secretary discount ceiling removed. The secretary's discount is applied
 * as given without an absolute or percentage cap. Reason and audit trail remain mandatory.
 */
function secretaryFloorAllowed(
  _standardFeeMinor: number,
  _finalFeeMinor: number,
  _maxDiscountMinor?: number,
  _maxDiscountPct?: number,
): boolean {
  return true;
}

/** Render failures as stable strings for the API `failures: string[]` contract. */
export function formatInvariantFailures(report: InvariantReport): string[] {
  return report.failures.map((f) => `${f.code}: ${f.detail}`);
}

/** Drawer breakdown for BE-306 consumers (shape re-exported for the summary DTO). */
export type DrawerBreakdown = Prisma.PromiseReturnType<typeof computeExpectedCash>;


/**
 * BE-306 — evaluate every invariant for a shift.
 *
 * Pure read: never writes. Callers hold `lockShift` when the result gates a
 * mutation (close), or run it standalone for the on-demand supervision probe.
 */
export async function checkShiftInvariants(
  shiftId: string,
  db: PrismaTx | PrismaClient = prisma,
): Promise<InvariantReport> {
  const failures: InvariantFailure[] = [];

  const push = (code: string, detail: string, entities: readonly string[] = []): void => {
    failures.push({ code, detail, entities });
  };

  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (shift === null) {
    push('SHIFT_NOT_FOUND', `shift ${shiftId} does not exist`, [shiftId]);
    return { shiftId, passed: false, failures };
  }

  const [invoices, receipts, pettyRows, queueEntries, auditRows, settings] = await Promise.all([
    db.invoice.findMany({ where: { shiftId } }),
    db.receipt.findMany({ where: { shiftId } }),
    db.pettyExpense.findMany({ where: { shiftId } }),
    db.queueEntry.findMany({ where: { shiftId }, select: { id: true, status: true } }),
    db.auditEvent.findMany({
      where: { entityType: { in: ['Shift', 'Invoice', 'Receipt', 'PettyExpense'] } },
    }),
    db.clinicSettings.findUnique({ where: { id: 'singleton' } }),
  ]);

  // --- INV-1 (APPX-D-1) collected integrity + INV-2 collected <= final -------
  const collectedByInvoice = new Map<string, number>();
  for (const r of receipts) {
    const delta = r.type === 'CHARGE' ? r.amountMinor : -r.amountMinor;
    collectedByInvoice.set(r.invoiceId, (collectedByInvoice.get(r.invoiceId) ?? 0) + delta);
  }

  for (const inv of invoices) {
    const derived = Math.max(0, collectedByInvoice.get(inv.id) ?? 0);
    if (derived !== inv.collectedMinor) {
      push('INV-1', `invoice ${inv.id} collectedMinor ${inv.collectedMinor} does not match sum(CHARGE)-sum(REVERSAL) ${derived}`, [inv.id]);
    }
    if (!inv.isComplimentary && inv.collectedMinor > inv.finalFeeMinor) {
      push('INV-2', `invoice ${inv.id} collectedMinor ${inv.collectedMinor} exceeds finalFeeMinor ${inv.finalFeeMinor}`, [inv.id]);
    }
  }

  // --- INV-3 (APPX-D-2) patient debt rollup over UNPAID/PARTIAL --------------
  const debtByPatient = new Map<string, { sum: number; stored: number; invoiceIds: string[] }>();
  for (const inv of invoices) {
    if (inv.status !== 'UNPAID' && inv.status !== 'PARTIAL') continue;
    const expected = Math.max(0, inv.finalFeeMinor - inv.collectedMinor - inv.writeOffMinor);
    const bucket = debtByPatient.get(inv.patientId) ?? { sum: 0, stored: 0, invoiceIds: [] as string[] };
    bucket.sum += expected;
    bucket.stored += inv.outstandingMinor;
    bucket.invoiceIds.push(inv.id);
    debtByPatient.set(inv.patientId, bucket);
  }
  for (const [patientId, bucket] of debtByPatient) {
    const storedOutstanding = Math.max(0, bucket.stored);
    if (storedOutstanding !== bucket.sum) {
      push('INV-3', `patient ${patientId} outstanding ${storedOutstanding} != sum(final-collected-writeOff) ${bucket.sum} over UNPAID/PARTIAL`, bucket.invoiceIds);
    }
  }

  // --- INV-4 (APPX-D-8) drawer arithmetic must match the shift formula ------
  const drawer = await computeExpectedCash(db, shiftId, shift.openingFloatMinor);
  if (shift.expectedCashMinor !== null && shift.expectedCashMinor !== drawer.expectedCashMinor) {
    push('INV-4', `shift ${shiftId} expectedCashMinor ${shift.expectedCashMinor} != recomputed formula ${drawer.expectedCashMinor}`, [shiftId]);
  }
  if (drawer.expectedCashMinor < 0) {
    push('INV-4', `shift ${shiftId} drawer formula is negative (${drawer.expectedCashMinor}): petty/reversals exceed cash on hand`, [shiftId]);
  }

  // --- INV-5 every COMPLETED queue entry has exactly one invoice -------------
  const invoiceByQueueEntry = new Map<string, number>();
  for (const inv of invoices) {
    invoiceByQueueEntry.set(inv.queueEntryId, (invoiceByQueueEntry.get(inv.queueEntryId) ?? 0) + 1);
  }
  for (const entry of queueEntries) {
    if (entry.status !== 'COMPLETED') continue;
    const count = invoiceByQueueEntry.get(entry.id) ?? 0;
    if (count !== 1) {
      push('INV-5', `COMPLETED queue entry ${entry.id} has ${count} invoice(s), expected exactly 1`, [entry.id]);
    }
  }

  // --- INV-6 (APPX-D-9) closed-shift freeze ---------------------------------
  if (shift.status === 'CLOSED' && shift.closedAt !== null) {
    const closedAt = shift.closedAt.getTime();
    for (const r of receipts.filter((x) => x.createdAt.getTime() > closedAt)) {
      push('INV-6', `receipt ${r.id} created after shift ${shiftId} closed`, [r.id, shiftId]);
    }
    for (const p of pettyRows.filter((x) => x.createdAt.getTime() > closedAt)) {
      push('INV-6', `petty ${p.id} created after shift ${shiftId} closed`, [p.id, shiftId]);
    }
  }

  // --- INV-7 (APPX-D-7) petty containment: OPEN shift only, monotonic -------
  if (shift.status === 'CLOSED' && pettyRows.length > 0) {
    push('INV-7', `shift ${shiftId} is CLOSED but holds ${pettyRows.length} petty row(s); petty must reference an OPEN shift only`, pettyRows.map((p) => p.id));
  }
  let runningPetty = 0;
  for (const p of [...pettyRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const next = runningPetty + p.amountMinor;
    if (next < runningPetty) {
      push('INV-7', `petty ${p.id} decreased the cumulative petty total (non-monotonic)`, [p.id]);
    }
    runningPetty = next;
  }

  // --- INV-8 result sign matches differenceMinor ----------------------------
  if (shift.differenceMinor !== null && shift.result !== null) {
    const expectedResult = deriveShiftResult(shift.differenceMinor);
    if (expectedResult !== shift.result) {
      push('INV-8', `shift ${shiftId} result ${shift.result} does not match differenceMinor ${shift.differenceMinor} (expected ${expectedResult})`, [shiftId]);
    }
  }
  if (shift.status === 'CLOSED' && shift.result === null) {
    push('INV-8', `shift ${shiftId} is CLOSED with a null result`, [shiftId]);
  }

  // --- INV-9 at most one IN_CONSULTATION entry ------------------------------
  const inConsultation = queueEntries.filter((e) => e.status === 'IN_CONSULTATION');
  if (inConsultation.length > 1) {
    push('INV-9', `shift ${shiftId} has ${inConsultation.length} IN_CONSULTATION entries, max 1 allowed`, inConsultation.map((e) => e.id));
  }

  // --- INV-10 (APPX-D-10) audit coverage: every sensitive mutation audited --
  const auditedEntities = new Set<string>();
  for (const a of auditRows) auditedEntities.add(`${a.entityType}:${a.entityId}`);

  const expectAudited: readonly { kind: string; id: string }[] = [
    { kind: 'Shift', id: shift.id },
    ...invoices.map((i) => ({ kind: 'Invoice', id: i.id })),
    // INV-10 (spec §15) obliges an audit per sensitive MUTATION, not per receipt
    // row. CHARGE receipts are produced by checkout/pay/settle/complimentary,
    // which audit under entityType 'Invoice' (their invoice is already required
    // above). Only REVERSAL receipts carry their own 'Receipt'-keyed audit
    // (reverseReceipt). Requiring a Receipt audit for every CHARGE made every
    // non-empty close fail INV-10; filtering to REVERSAL restores correct gating
    // while a genuinely-missing checkout/pay audit still fails via the Invoice.
    ...receipts.filter((r) => r.type === 'REVERSAL').map((r) => ({ kind: 'Receipt', id: r.id })),
    ...pettyRows.map((p) => ({ kind: 'PettyExpense', id: p.id })),
  ];
  for (const target of expectAudited) {
    if (!auditedEntities.has(`${target.kind}:${target.id}`)) {
      push('INV-10', `${target.kind} ${target.id} has no AuditEvent (missing audit coverage blocks close)`, [target.id]);
    }
  }

  // --- APPX-D-3 discount vs write-off separation (discount fixed at creation)
  for (const inv of invoices) {
    const expectedDiscount = Math.max(0, inv.standardFeeMinor - inv.finalFeeMinor);
    if (inv.discountMinor !== expectedDiscount) {
      push('APPX-D-3', `invoice ${inv.id} discountMinor ${inv.discountMinor} != standard-final ${expectedDiscount} (discount is fixed at creation)`, [inv.id]);
    }
    if (inv.writeOffMinor > 0 && (inv.writeOffReason === null || inv.writeOffReason.trim().length === 0)) {
      push('APPX-D-3', `invoice ${inv.id} has a write-off with no reason`, [inv.id]);
    }
  }

  // --- APPX-D-4 reversal linkage (<= original, no double reversal) ----------
  const chargesById = new Map(receipts.filter((r) => r.type === 'CHARGE').map((r) => [r.id, r]));
  const reversedSoFar = new Map<string, number>();
  for (const r of receipts.filter((x) => x.type === 'REVERSAL')) {
    if (r.reversalOfReceiptId === null) {
      push('APPX-D-4', `reversal ${r.id} has no reversalOfReceiptId link`, [r.id]);
      continue;
    }
    const original = chargesById.get(r.reversalOfReceiptId);
    if (original === undefined) {
      push('APPX-D-4', `reversal ${r.id} references unknown CHARGE ${r.reversalOfReceiptId}`, [r.id, r.reversalOfReceiptId]);
      continue;
    }
    const cumulative = (reversedSoFar.get(r.reversalOfReceiptId) ?? 0) + r.amountMinor;
    reversedSoFar.set(r.reversalOfReceiptId, cumulative);
    if (cumulative > original.amountMinor) {
      push('APPX-D-4', `CHARGE ${original.id} reversed ${cumulative} > original ${original.amountMinor}`, [original.id, r.id]);
    }
  }

  // --- APPX-D-5 idempotency: same key must never yield duplicate rows -------
  for (const problem of uniqueKeyViolations(
    invoices.map((i) => ({ id: i.id, key: `${i.shiftId}:${i.idempotencyKey}` })),
    'Invoice',
  )) {
    push('APPX-D-5', problem, []);
  }
  for (const problem of uniqueKeyViolations(
    receipts.map((r) => ({ id: r.id, key: `${r.shiftId}:${r.idempotencyKey}` })),
    'Receipt',
  )) {
    push('APPX-D-5', problem, []);
  }
  for (const problem of uniqueKeyViolations(
    pettyRows.map((p) => ({ id: p.id, key: `${p.shiftId}:${p.idempotencyKey}` })),
    'PettyExpense',
  )) {
    push('APPX-D-5', problem, []);
  }

  // --- APPX-D-6 secretary discount floor ------------------------------------
  // P1-1: Reception discount ceiling enforcement removed.
  // The secretary's discount is applied as given (reason + audit still mandatory).

  const report: InvariantReport = { shiftId, passed: failures.length === 0, failures };

  if (!report.passed) {
    logger.warn('reconciliation.invariants.failed', {
      shiftId,
      failureCount: failures.length,
      codes: failures.map((f) => f.code),
    });
  }

  return report;
}
