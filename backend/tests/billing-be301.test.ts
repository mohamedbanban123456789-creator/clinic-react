import assert from 'node:assert/strict';
import {
  checkoutSchema,
  complimentarySchema,
  payInvoiceSchema,
  reverseSchema,
  settleSchema,
  receiptsQuerySchema,
} from '../src/modules/cashier-shift/billing.validators.js';
import {
  assertSecretaryDiscountFloor,
  computeOutstanding,
  deriveInvoiceStatus,
} from '../src/modules/cashier-shift/billing.support.js';
import { AppError } from '../src/common/errors/AppError.js';

// ---------------------------------------------------------------------------
// BE-301..303 acceptance: new AppError codes carry the contract-mandated status.
// ---------------------------------------------------------------------------
{
  assert.equal(new AppError('IDEMPOTENCY_KEY_CONFLICT', 'x').statusCode, 409, 'IDEMPOTENCY_KEY_CONFLICT must be 409');
  assert.equal(new AppError('DISCOUNT_BELOW_FLOOR', 'x').statusCode, 422, 'DISCOUNT_BELOW_FLOOR must be 422');
  assert.equal(new AppError('OVERPAYMENT_REJECTED', 'x').statusCode, 422, 'OVERPAYMENT_REJECTED must be 422');
  assert.equal(new AppError('REVERSAL_EXCEEDS_ORIGINAL', 'x').statusCode, 422, 'REVERSAL_EXCEEDS_ORIGINAL must be 422');
  assert.equal(new AppError('MUST_REVERSE_FIRST', 'x').statusCode, 409, 'MUST_REVERSE_FIRST must be 409');
  assert.equal(new AppError('IDEMPOTENCY_KEY_REQUIRED', 'x').statusCode, 422, 'missing key stays 422 (validated decision)');
  assert.equal(new AppError('NO_OPEN_SHIFT', 'x').statusCode, 409, 'NO_OPEN_SHIFT must be 409');
}

// ---------------------------------------------------------------------------
// BE-301 checkout validator — queueEntryId required, discountReason length, strict.
// ---------------------------------------------------------------------------
{
  assert.equal(checkoutSchema.safeParse({ queueEntryId: 'q1' }).success, true, 'minimal checkout valid');
  assert.equal(checkoutSchema.parse({ queueEntryId: 'q1' }).collectedMinor, 0, 'collectedMinor defaults to 0');
  assert.equal(
    checkoutSchema.safeParse({
      queueEntryId: 'q1',
      collectedMinor: 10000,
      finalFeeMinor: 8000,
      discountReason: 'Goodwill adjustment for wait',
      method: 'CASH',
    }).success,
    true,
    'full checkout valid',
  );
  assert.equal(checkoutSchema.safeParse({}).success, false, 'queueEntryId required');
  assert.equal(
    checkoutSchema.safeParse({ queueEntryId: 'q1', discountReason: 'short' }).success,
    false,
    'discountReason must be >= 10 chars',
  );
  assert.equal(checkoutSchema.safeParse({ queueEntryId: 'q1', collectedMinor: -1 }).success, false, 'no negative collected');
  assert.equal(checkoutSchema.safeParse({ queueEntryId: 'q1', extra: 1 }).success, false, 'strict checkout');
}

// ---------------------------------------------------------------------------
// BE-301 complimentary validator — XOR of queueEntryId / invoiceId.
// ---------------------------------------------------------------------------
{
  assert.equal(complimentarySchema.safeParse({ queueEntryId: 'q1' }).success, true, 'entry target valid');
  assert.equal(complimentarySchema.safeParse({ invoiceId: 'i1' }).success, true, 'invoice target valid');
  assert.equal(complimentarySchema.safeParse({}).success, false, 'must pick exactly one target');
  assert.equal(
    complimentarySchema.safeParse({ queueEntryId: 'q1', invoiceId: 'i1' }).success,
    false,
    'both targets rejected (XOR)',
  );
}

// ---------------------------------------------------------------------------
// BE-302 pay validator — accepts amountMinor OR collectedMinor, normalizes to amountMinor.
// ---------------------------------------------------------------------------
{
  assert.equal(payInvoiceSchema.parse({ amountMinor: 5000 }).amountMinor, 5000, 'amountMinor passthrough');
  assert.equal(payInvoiceSchema.parse({ collectedMinor: 7500 }).amountMinor, 7500, 'collectedMinor normalizes');
  assert.equal(payInvoiceSchema.parse({ amountMinor: 5000, method: 'CASH' }).method, 'CASH', 'method preserved');
  assert.equal(payInvoiceSchema.safeParse({}).success, false, 'one of amount/collected required');
  assert.equal(payInvoiceSchema.safeParse({ amountMinor: 0 }).success, false, 'amount must be > 0');
  assert.equal(payInvoiceSchema.safeParse({ amountMinor: -5 }).success, false, 'amount must be positive');
  assert.equal(payInvoiceSchema.safeParse({ collectedMinor: 1.5 }).success, false, 'amount must be an integer');
}

// ---------------------------------------------------------------------------
// BE-302 settle validator — amountMinor > 0, strict.
// ---------------------------------------------------------------------------
{
  assert.equal(settleSchema.safeParse({ amountMinor: 5000 }).success, true, 'settle valid');
  assert.equal(settleSchema.safeParse({ amountMinor: 5000, method: 'CASH' }).success, true, 'settle with method');
  assert.equal(settleSchema.safeParse({ amountMinor: 0 }).success, false, 'amount must be > 0');
  assert.equal(settleSchema.safeParse({}).success, false, 'amount required');
}

// ---------------------------------------------------------------------------
// BE-303 reversal validator — amountMinor > 0 + coded reason, strict.
// ---------------------------------------------------------------------------
{
  assert.equal(reverseSchema.safeParse({ amountMinor: 1000, reason: 'Charged wrong visit type' }).success, true);
  assert.equal(reverseSchema.safeParse({ amountMinor: 0, reason: 'x' }).success, false, 'amount must be > 0');
  assert.equal(reverseSchema.safeParse({ amountMinor: 1000 }).success, false, 'reason required');
  assert.equal(reverseSchema.safeParse({ amountMinor: 1000, reason: '' }).success, false, 'reason not empty');
}

// ---------------------------------------------------------------------------
// BE-303 receipts archive query — optional filters, limit coerced + bounded.
// ---------------------------------------------------------------------------
{
  assert.equal(receiptsQuerySchema.safeParse({}).success, true, 'empty query valid');
  assert.equal(receiptsQuerySchema.parse({ patientId: 'p1', limit: '50' }).limit, 50, 'limit coerced string->number');
  assert.equal(receiptsQuerySchema.safeParse({ limit: 500 }).success, false, 'limit capped at 200');
  assert.equal(receiptsQuerySchema.safeParse({ limit: -1 }).success, false, 'limit must be positive');
}

// ---------------------------------------------------------------------------
// DB-07 / INV-2 money helpers — outstanding floored at 0, status derivation.
// ---------------------------------------------------------------------------
{
  assert.equal(computeOutstanding(100000, 30000, 10000), 60000, 'final - collected - writeOff');
  assert.equal(computeOutstanding(100000, 120000, 0), 0, 'outstanding floored at 0');
  assert.equal(computeOutstanding(50000, 0, 0), 50000, 'fully unpaid');

  assert.equal(deriveInvoiceStatus(100000, 0, false), 'UNPAID');
  assert.equal(deriveInvoiceStatus(100000, 40000, false), 'PARTIAL');
  assert.equal(deriveInvoiceStatus(100000, 100000, false), 'PAID');
  assert.equal(deriveInvoiceStatus(100000, 0, true), 'COMPLIMENTARY', 'complimentary wins regardless of money');
  assert.equal(deriveInvoiceStatus(100000, 120000, false), 'PAID', 'over-collected still PAID');
}

// ---------------------------------------------------------------------------
// P1-1: Secretary discount ceiling removed — ANY discount allowed with mandatory reason.
// DOCTOR still bypasses the floor entirely.
// ---------------------------------------------------------------------------
{
  const fees = { standardFeeMinor: 100000, secretaryMaxDiscountMinor: 5000, secretaryMaxDiscountPct: 10 };

  assert.doesNotThrow(() => assertSecretaryDiscountFloor('SECRETARY', 100000, 100000, fees), 'no discount allowed');
  assert.doesNotThrow(() => assertSecretaryDiscountFloor('SECRETARY', 100000, 110000, fees), 'upcharge allowed');
  assert.doesNotThrow(() => assertSecretaryDiscountFloor('SECRETARY', 100000, 95000, fees), 'discount at previous cap allowed');
  // P1-1: discount 6000 over previous cap 5000 now allowed for secretary
  assert.doesNotThrow(
    () => assertSecretaryDiscountFloor('SECRETARY', 100000, 94000, fees),
    'discount over previous cap is allowed under P1-1',
  );

  // Large discount (e.g. 500 EGP fee discounted by 200 EGP -> 300 EGP) allowed for secretary
  const pctTight = { standardFeeMinor: 100000, secretaryMaxDiscountMinor: 20000, secretaryMaxDiscountPct: 5 };
  assert.doesNotThrow(
    () => assertSecretaryDiscountFloor('SECRETARY', 100000, 30000, pctTight),
    'large discount allowed for secretary under P1-1',
  );
  assert.doesNotThrow(() => assertSecretaryDiscountFloor('SECRETARY', 100000, 95000, pctTight), 'within pct cap allowed');

  // DOCTOR bypasses the floor entirely
  assert.doesNotThrow(() => assertSecretaryDiscountFloor('DOCTOR', 100000, 10000, fees), 'doctor bypasses floor');
}

// eslint-disable-next-line no-console
console.log('BE-301..303 billing validator + money/discount-floor tests passed.');
