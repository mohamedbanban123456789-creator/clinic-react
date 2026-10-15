import assert from 'node:assert/strict';
import {
  emergencyToggleSchema,
  reorderSchema,
  waitTimesQuerySchema,
} from '../src/modules/identity-queue/queue.validators.js';
import { computeEstimatedWaitMin } from '../src/modules/identity-queue/queue.support.js';
import { normalizeArabic, normalizeName } from '../src/modules/identity-queue/patient.normalize.js';
import { searchPatients } from '../src/modules/identity-queue/patient.search.js';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors/AppError.js';
import { toggleEmergency } from '../src/modules/identity-queue/queue.service.js';

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

  // Fractional elapsed consult minutes must round to an integer (P0-4 fix).
  const fractionalResult = computeEstimatedWaitMin({
    precedingWaitingCount: 0,
    avgConsultDurationMin: 20,
    inConsultation: true,
    elapsedConsultMin: 5.465,
  });
  assert.equal(fractionalResult, 15, '20 - 5.465 = 14.535 must round to integer 15');
  assert.equal(Number.isInteger(fractionalResult), true, 'Must be an integer');
}

// ---------------------------------------------------------------------------
// P0-3: Arabic normalization tests (bidirectional, alef/taa/yaa, tashkeel)
// ---------------------------------------------------------------------------
{
  // Alef forms equivalence
  assert.equal(normalizeName('أحمد'), normalizeName('احمد'));
  assert.equal(normalizeName('إبراهيم'), normalizeName('ابراهيم'));
  assert.equal(normalizeName('آدم'), normalizeName('ادم'));

  // Yaa and Alef Maksura equivalence
  assert.equal(normalizeName('ندى'), normalizeName('ندي'));
  assert.equal(normalizeName('منى'), normalizeName('مني'));

  // Taa Marbuta and Haa equivalence
  assert.equal(normalizeName('فاطمة'), normalizeName('فاطمه'));
  assert.equal(normalizeName('سارة'), normalizeName('ساره'));

  // Tashkeel / diacritics stripping
  assert.equal(normalizeName('مُحَمَّد'), 'محمد');
  assert.equal(normalizeName('أَحْمَدُ'), 'احمد');

  // Single token matching: "محمد" matches "محمد أحمد"
  const ptNorm = normalizeName('محمد أحمد علي');
  const queryNorm1 = normalizeName('محمد');
  assert.ok(ptNorm.includes(queryNorm1), '"محمد" must match in "محمد أحمد علي"');

  const queryNorm2 = normalizeName('احمد');
  assert.ok(ptNorm.includes(queryNorm2), '"احمد" must match in "محمد أحمد علي"');

  const queryNorm3 = normalizeName('علي');
  assert.ok(ptNorm.includes(queryNorm3), '"علي" must match in "محمد أحمد علي"');
}

// ---------------------------------------------------------------------------
// P0-3: Token-based patient search query construction & execution
// ---------------------------------------------------------------------------
{
  let capturedWhere: any = null;
  const mockDb = {
    patient: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [
          {
            id: 'p1',
            fullName: 'محمد أحمد',
            dateOfBirth: new Date('1990-01-01'),
            phoneNorm: '01012345678',
            nationalIdNorm: '29001011234567',
            outstandingBalanceMinor: 0,
            lastVisitAt: null,
            registrationStatus: 'COMPLETE',
          },
        ];
      },
    },
    patientAudit: {
      create: async () => ({ id: 'aud1' }),
    },
  } as unknown as PrismaClient;

  const actor = { userId: 'u-doc', role: 'DOCTOR' as const };

  // Single token search: "محمد"
  const res1 = await searchPatients('محمد', actor, mockDb);
  assert.equal(res1.length, 1);
  assert.ok(capturedWhere.AND[1].OR.length > 0);

  // Multi token search: "احمد محمد"
  const res2 = await searchPatients('احمد محمد', actor, mockDb);
  assert.equal(res2.length, 1);

  // Phone search: "010123"
  const res3 = await searchPatients('010123', actor, mockDb);
  assert.equal(res3.length, 1);

  // Less than 3 characters returns empty without DB query
  capturedWhere = null;
  const resEmpty = await searchPatients('مح', actor, mockDb);
  assert.equal(resEmpty.length, 0);
  assert.equal(capturedWhere, null, 'Under 3 chars must not query database');
}

// ---------------------------------------------------------------------------
// P1-3: Secretary B unflags Secretary A's emergency flag -> succeeds, audit correct.
// ---------------------------------------------------------------------------
{
  const entry: Record<string, unknown> = {
    id: 'entry-1',
    shiftId: 'shift-1',
    patientId: 'patient-1',
    status: 'WAITING',
    position: 1,
    isEmergency: true,
    emergencyFlaggedAt: new Date(Date.now() - 3600 * 1000), // Flagged 1 hour ago (past old 120s grace window)
    emergencyFlaggedByUserId: 'sec-a', // Flagged by Secretary A
    emergencyReasonCode: 'DOCTOR_DIRECTED',
    checkedInAt: new Date(Date.now() - 3600 * 1000),
    calledAt: null,
    skippedAt: null,
    completedAt: null,
    noShowAt: null,
    abandonAt: null,
    debtAckAt: null,
    undoWindowUntil: null,
    patient: { fullName: 'مريض تجريبي' },
  };

  const writtenAudits: Array<Record<string, unknown>> = [];

  const txMock = {
    $queryRaw: async () => [],
    queueEntry: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(entry, args.data);
        return entry;
      },
      findMany: async () => [entry],
      findUnique: async () => entry,
    },
    auditEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        writtenAudits.push(args.data);
        return { id: 'aud-1' };
      },
    },
    shift: {
      update: async () => ({ id: 'shift-1', queueVersion: 2 }),
      findUnique: async () => ({ id: 'shift-1', queueVersion: 2 }),
    },
  };

  const mockDb = {
    shift: {
      findFirst: async () => ({ id: 'shift-1', queueVersion: 1, status: 'OPEN' }),
    },
    queueEntry: {
      findUnique: async () => entry,
      findMany: async () => [],
    },
    $transaction: async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
  } as unknown as PrismaClient;

  // Secretary B (sec-b) unflags Secretary A's (sec-a) emergency flag after grace period
  const actorSecB = { userId: 'sec-b', role: 'SECRETARY' as const };
  const res = await toggleEmergency('entry-1', { isEmergency: false }, actorSecB, mockDb);

  assert.equal(res.isEmergency, false, 'Entry must be unflagged');
  assert.equal(entry.isEmergency, false);
  assert.equal(writtenAudits.length, 1);
  assert.equal(writtenAudits[0].action, 'EMERGENCY_UNFLAG');
  assert.equal(writtenAudits[0].actorUserId, 'sec-b');
  assert.equal(writtenAudits[0].actorRole, 'SECRETARY');
}

// eslint-disable-next-line no-console
console.log('BE-203 reorder/emergency/wait-time validator + formula + P0-3 search + P1-3 unflag tests passed.');
