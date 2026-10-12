import assert from 'node:assert/strict';
import {
  emergencyToggleSchema,
  reorderSchema,
  waitTimesQuerySchema,
} from '../src/modules/identity-queue/queue.validators.js';
import { computeEstimatedWaitMin } from '../src/modules/identity-queue/queue.support.js';
import { AppError } from '../src/common/errors/AppError.js';

// ---------------------------------------------------------------------------
// BE-203 acceptance gate 1: reorder OCC error code carries 409 (STALE_QUEUE).
// ---------------------------------------------------------------------------
{
  assert.equal(new AppError('STALE_QUEUE', 'x').statusCode, 409, 'STALE_QUEUE must be 409');
}

// ---------------------------------------------------------------------------
// BE-203: reorder validator — OCC version + strict body + no duplicates.
// ---------------------------------------------------------------------------
{
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: 0, orderedEntryIds: ['a'] }).success, true);
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: 3, orderedEntryIds: ['a', 'b'] }).success, true);

  // missing version
  assert.equal(reorderSchema.safeParse({ orderedEntryIds: ['a'] }).success, false);
  // negative version
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: -1, orderedEntryIds: ['a'] }).success, false);
  // non-integer version
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: 1.5, orderedEntryIds: ['a'] }).success, false);
  // empty ids
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: 0, orderedEntryIds: [] }).success, false);
  // missing ids
  assert.equal(reorderSchema.safeParse({ lastSeenQueueVersion: 0 }).success, false);
  // duplicate ids rejected
  assert.equal(
    reorderSchema.safeParse({ lastSeenQueueVersion: 0, orderedEntryIds: ['a', 'a'] }).success,
    false,
    'duplicate ids must be rejected',
  );
  // strict: unknown key rejected
  assert.equal(
    reorderSchema.safeParse({ lastSeenQueueVersion: 0, orderedEntryIds: ['a'], extra: 1 }).success,
    false,
  );
}

// ---------------------------------------------------------------------------
// BE-203: emergency toggle validator — coded reason required on flag; no free text.
// ---------------------------------------------------------------------------
{
  const valid = ['DOCTOR_DIRECTED', 'VISIBLE_DISTRESS', 'FAMILY_ESCALATION', 'PRE_ARRANGED_URGENT', 'OTHER_URGENT'];
  for (const code of valid) {
    assert.equal(
      emergencyToggleSchema.safeParse({ isEmergency: true, reasonCode: code }).success,
      true,
      `reason ${code} must be accepted`,
    );
  }

  // flag requires a coded reason
  assert.equal(emergencyToggleSchema.safeParse({ isEmergency: true }).success, false);
  // free text is NOT a valid reason
  assert.equal(
    emergencyToggleSchema.safeParse({ isEmergency: true, reasonCode: 'patient looks sad' }).success,
    false,
    'free-text reason must be rejected',
  );
  // unflag does not require a reason
  assert.equal(emergencyToggleSchema.safeParse({ isEmergency: false }).success, true);
  // optional OCC version accepted when present
  assert.equal(
    emergencyToggleSchema.safeParse({ isEmergency: true, reasonCode: 'DOCTOR_DIRECTED', lastSeenQueueVersion: 2 }).success,
    true,
  );
  // strict
  assert.equal(emergencyToggleSchema.safeParse({ isEmergency: false, extra: 1 }).success, false);
}

// ---------------------------------------------------------------------------
// BE-203: wait-times query validator.
// ---------------------------------------------------------------------------
{
  assert.equal(waitTimesQuerySchema.safeParse({}).success, true);
  assert.equal(waitTimesQuerySchema.safeParse({ shiftId: 'sh1' }).success, true);
  assert.equal(waitTimesQuerySchema.safeParse({ shiftId: '' }).success, false);
  assert.equal(waitTimesQuerySchema.safeParse({ shiftId: 'sh1', extra: 1 }).success, false);
}

// ---------------------------------------------------------------------------
// BE-203 acceptance gate 3: wait-time formula incorporates the running
// in-consultation remainder term (RPS-2).
// ---------------------------------------------------------------------------
{
  // No active consultation: preceding * avg.
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 0, avgConsultDurationMin: 20, inConsultation: false, elapsedConsultMin: 0 }),
    0,
  );
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 2, avgConsultDurationMin: 20, inConsultation: false, elapsedConsultMin: 0 }),
    40,
  );

  // Active consultation, none elapsed: adds the FULL remaining slot.
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 0, avgConsultDurationMin: 20, inConsultation: true, elapsedConsultMin: 0 }),
    20,
  );
  // Head of queue with 1 preceding and 8 of 20 min elapsed: 1*20 + (20-8) = 32.
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 1, avgConsultDurationMin: 20, inConsultation: true, elapsedConsultMin: 8 }),
    32,
  );
  // Consult ran past the slot: remainder floors at 0 (no negative wait).
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 1, avgConsultDurationMin: 20, inConsultation: true, elapsedConsultMin: 35 }),
    20,
  );
  // Elapsed exactly equals avg: remainder 0.
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 3, avgConsultDurationMin: 20, inConsultation: true, elapsedConsultMin: 20 }),
    60,
  );
  // Negative elapsed is clamped (defensive).
  assert.equal(
    computeEstimatedWaitMin({ precedingWaitingCount: 0, avgConsultDurationMin: 20, inConsultation: true, elapsedConsultMin: -5 }),
    20,
  );
}

// eslint-disable-next-line no-console
console.log('BE-203 reorder/emergency/wait-time validator + formula tests passed.');
