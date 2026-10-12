import assert from 'node:assert/strict';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  isOpenStatus,
  isWaitingPoolStatus,
} from '../src/modules/identity-queue/queue.state.js';
import {
  abandonSchema,
  checkInSchema,
  callNextSchema,
  callSchema,
  noShowSchema,
  requeueSchema,
  queueQuerySchema,
  undoCompleteSchema,
} from '../src/modules/identity-queue/queue.validators.js';
import { AppError } from '../src/common/errors/AppError.js';
import { estimateWaitMin } from '../src/modules/identity-queue/queue.support.js';

// ---------------------------------------------------------------------------
// BE-202 acceptance gate 1: complete state machine transitions.
// ---------------------------------------------------------------------------
{
  const legal: Array<[string, string]> = [
    ['WAITING', 'IN_CONSULTATION'],
    ['WAITING', 'SKIPPED'],
    ['WAITING', 'NO_SHOW'],
    ['IN_CONSULTATION', 'COMPLETED'],
    ['IN_CONSULTATION', 'SKIPPED'],
    ['IN_CONSULTATION', 'ABANDONED'],
    ['SKIPPED', 'WAITING'],
    ['SKIPPED', 'NO_SHOW'],
    // API-06 undo-complete: a premature completion reverts to the ACTIVE
    // consultation state (never WAITING — the patient was already called).
    ['COMPLETED', 'IN_CONSULTATION'],
  ];
  for (const [from, to] of legal) {
    assert.equal(canTransition(from as never, to as never), true, `expected ${from} -> ${to} legal`);
  }

  const illegal: Array<[string, string]> = [
    ['WAITING', 'COMPLETED'],
    ['WAITING', 'ABANDONED'],
    ['IN_CONSULTATION', 'WAITING'],
    ['IN_CONSULTATION', 'NO_SHOW'],
    ['SKIPPED', 'COMPLETED'],
    ['SKIPPED', 'IN_CONSULTATION'],
    // Undo-complete must NOT send the entry back to WAITING (API-06 canonical).
    ['COMPLETED', 'WAITING'],
    ['COMPLETED', 'SKIPPED'],
    ['NO_SHOW', 'WAITING'],
    ['NO_SHOW', 'IN_CONSULTATION'],
    ['ABANDONED', 'WAITING'],
    ['ABANDONED', 'COMPLETED'],
  ];
  for (const [from, to] of illegal) {
    assert.equal(canTransition(from as never, to as never), false, `expected ${from} -> ${to} illegal`);
  }

  // Terminal states have no outgoing edges.
  assert.deepEqual(ALLOWED_TRANSITIONS.NO_SHOW, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.ABANDONED, []);
}

// ---------------------------------------------------------------------------
// BE-202 acceptance gate 2: open-entry invariant helper matches canon unique.
// ---------------------------------------------------------------------------
{
  assert.equal(isOpenStatus('WAITING'), true);
  assert.equal(isOpenStatus('IN_CONSULTATION'), true);
  assert.equal(isOpenStatus('SKIPPED'), true);
  assert.equal(isOpenStatus('COMPLETED'), false);
  assert.equal(isOpenStatus('NO_SHOW'), false);
  assert.equal(isOpenStatus('ABANDONED'), false);
  assert.equal(isWaitingPoolStatus('WAITING'), true);
  assert.equal(isWaitingPoolStatus('SKIPPED'), false);
}

// ---------------------------------------------------------------------------
// BE-202: error codes carry the exact HTTP statuses the ticket mandates.
// ---------------------------------------------------------------------------
{
  const cases: Array<[string, number]> = [
    ['NO_OPEN_SHIFT', 409],
    ['ALREADY_ACTIVE', 409],
    ['ACTIVE_CONSULTATION_EXISTS', 409],
    ['OUT_OF_ORDER_REASON_REQUIRED', 422],
    ['UNDO_WINDOW_EXPIRED', 400],
    ['UNDO_BLOCKED', 409],
  ];
  for (const [code, status] of cases) {
    assert.equal(new AppError(code as never, 'x').statusCode, status, `${code} must be ${status}`);
  }
}

// ---------------------------------------------------------------------------
// BE-202: validators enforce reason-code + force/billable/branch rules (422).
// ---------------------------------------------------------------------------
{
  assert.equal(checkInSchema.safeParse({ patientId: 'p1' }).success, true);
  assert.equal(checkInSchema.safeParse({ patientId: 'p1', isEmergency: false }).success, true);
  assert.equal(
    checkInSchema.safeParse({ patientId: 'p1', isEmergency: true, emergencyReasonCode: 'CHEST_PAIN' }).success,
    true,
  );
  assert.equal(checkInSchema.safeParse({ patientId: 'p1', isEmergency: true }).success, false);
  assert.equal(checkInSchema.safeParse({ patientId: 'p1', isEmergency: true, emergencyReasonCode: '  ' }).success, false);
  assert.equal(checkInSchema.safeParse({}).success, false);
  assert.equal(checkInSchema.safeParse({ patientId: 'p1', extra: 'x' }).success, false); // strict

  assert.equal(callNextSchema.safeParse({}).success, true);
  assert.equal(callNextSchema.safeParse({ force: true }).success, true);
  assert.equal(callNextSchema.safeParse({ force: 'yes' }).success, false);

  assert.equal(callSchema.safeParse({}).success, true);
  assert.equal(callSchema.safeParse({ outOfOrderReasonCode: 'late-comer' }).success, true);
  assert.equal(callSchema.safeParse({ outOfOrderReasonCode: '' }).success, false);

  assert.equal(requeueSchema.safeParse({}).success, true);
  assert.equal(requeueSchema.safeParse({ position: 'FRONT' }).success, true);
  assert.equal(requeueSchema.safeParse({ position: 'ORIGINAL' }).success, true);
  assert.equal(requeueSchema.safeParse({ position: 'TAIL' }).success, false);

  assert.equal(noShowSchema.safeParse({ reasonCode: 'LEFT_BEFORE_CALL' }).success, true);
  assert.equal(noShowSchema.safeParse({ reasonCode: '' }).success, false);
  assert.equal(noShowSchema.safeParse({}).success, false);

  assert.equal(abandonSchema.safeParse({ reasonCode: 'R01', billable: true }).success, true);
  assert.equal(abandonSchema.safeParse({ reasonCode: 'R01' }).success, false);
  assert.equal(abandonSchema.safeParse({ reasonCode: 'R01', billable: 'yes' }).success, false);

  assert.equal(queueQuerySchema.safeParse({}).success, true);
  assert.equal(queueQuerySchema.safeParse({ status: 'WAITING' }).success, true);
  assert.equal(queueQuerySchema.safeParse({ status: 'TELEPORTED' }).success, false);

  // API-06 undo-complete body: { reason } required, lastSeenQueueVersion optional, strict.
  assert.equal(undoCompleteSchema.safeParse({ reason: 'Wrong patient completed' }).success, true);
  assert.equal(
    undoCompleteSchema.safeParse({ reason: 'Wrong patient completed', lastSeenQueueVersion: 7 }).success,
    true,
  );
  assert.equal(undoCompleteSchema.safeParse({}).success, false); // reason required
  assert.equal(undoCompleteSchema.safeParse({ reason: '   ' }).success, false); // non-blank
  assert.equal(undoCompleteSchema.safeParse({ reason: 'x' }).success, true); // non-blank (1 char ok per API-06)
  assert.equal(undoCompleteSchema.safeParse({ reason: 'r'.repeat(301) }).success, false); // max 300
  assert.equal(undoCompleteSchema.safeParse({ reason: 'ok', lastSeenQueueVersion: -1 }).success, false);
  assert.equal(undoCompleteSchema.safeParse({ reason: 'ok', extra: 1 }).success, false); // strict
}

// ---------------------------------------------------------------------------
// BE-202: estimated wait = (dense position - 1) * avg minutes, floored at 0.
// ---------------------------------------------------------------------------
{
  assert.equal(estimateWaitMin(1, 20), 0);
  assert.equal(estimateWaitMin(2, 20), 20);
  assert.equal(estimateWaitMin(5, 20), 80);
  assert.equal(estimateWaitMin(0, 20), 0);
}

// eslint-disable-next-line no-console
console.log('BE-202 queue state-machine + validator tests passed.');

