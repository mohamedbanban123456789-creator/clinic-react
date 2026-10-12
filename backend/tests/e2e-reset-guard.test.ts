import assert from 'node:assert/strict';
import {
  RESET_CONFIRM_ENV,
  RESET_CONFIRM_VALUE,
  assertResetAllowed,
  isDisposableDbName,
  redactUrl,
} from '../scripts/db/e2e-reset.mjs';

/**
 * R9 regression gate: scripts/db/e2e-reset.mjs is destructive (deletes the
 * singleton clinic-settings row among others), so its guard must FAIL CLOSED
 * for every realistic mistake and only allow an explicitly-confirmed,
 * disposable-named target. Importing this module must have NO side effects.
 */

// Naming rule.
assert.equal(isDisposableDbName('clinic_e2e'), true);
assert.equal(isDisposableDbName('disposable-pg-abc'), true);
assert.equal(isDisposableDbName('clinic_test'), true);
assert.equal(isDisposableDbName('clinic'), false, 'production-like name is not disposable');
assert.equal(isDisposableDbName('clinic-prod'), false);
assert.equal(isDisposableDbName(''), false);
assert.equal(isDisposableDbName(undefined), false);
assert.equal(isDisposableDbName(null), false);

// Redaction: credentials never leak into displayable output.
{
  const redacted = redactUrl('postgresql://owner:s3cret-pw@db.prod.internal:5432/clinic');
  assert.equal(redacted.includes('s3cret-pw'), false, 'password must never be printed');
  assert.equal(redacted, 'postgresql://db.prod.internal:5432/clinic');
  assert.equal(redactUrl('not a url'), '<unparseable-url>');
}

// Guard matrix — every reject path throws with an actionable message.
function rejects(rawUrl: unknown, confirm: unknown, label: string): void {
  let thrown: unknown = null;
  try {
    assertResetAllowed(rawUrl, confirm);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, `${label}: guard must refuse`);
  assert.equal(String((thrown as Error).message).includes('password'), false, `${label}: refusal text must not leak secrets`);
}

// 1. Production-like URL, even WITH explicit opt-in → refused (name rule).
rejects('postgresql://owner:pw@prod-db:5432/clinic', RESET_CONFIRM_VALUE, 'prod-like name with opt-in');
rejects('postgresql://owner:pw@127.0.0.1:5432/clinic', RESET_CONFIRM_VALUE, 'default-looking name with opt-in');

// 2. Missing opt-in, even on a disposable target → refused.
rejects('postgresql://owner:pw@127.0.0.1:5433/clinic_e2e', undefined, 'missing opt-in');
rejects('postgresql://owner:pw@127.0.0.1:5433/clinic_e2e', 'yes', 'wrong opt-in value');

// 3. Missing/unparseable URL → refused.
rejects('', RESET_CONFIRM_VALUE, 'empty URL');
rejects(undefined, RESET_CONFIRM_VALUE, 'missing URL');
rejects('not-a-url', RESET_CONFIRM_VALUE, 'unparseable URL');

// 4. Valid disposable configuration → allowed (no throw).
assertResetAllowed('postgresql://owner:pw@127.0.0.1:5433/clinic_e2e', RESET_CONFIRM_VALUE);
assertResetAllowed('postgresql://owner:pw@localhost:55432/clinic_disposable_2026_10_11', RESET_CONFIRM_VALUE);

// 5. The documented confirmation contract stays stable (scripts reference it).
assert.equal(RESET_CONFIRM_ENV, 'CLINIC_E2E_RESET_CONFIRM');
assert.equal(RESET_CONFIRM_VALUE, 'I-UNDERSTAND-THIS-DELETES-DATA');

// eslint-disable-next-line no-console
console.log('R9 e2e-reset fail-closed guard tests passed.');
