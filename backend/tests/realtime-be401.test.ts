import assert from 'node:assert/strict';
import { AppError } from '../src/common/errors/AppError.js';
import { roomsForRole, ROOM_INTERCOM, ROOM_QUEUE_DOCTOR, ROOM_QUEUE_OPS, ROOM_SCRIBE_DOCTOR, userRoom } from '../src/common/rooms.js';
import { isSecretSafe } from '../src/common/types/secretSafe.js';
import {
  toSecretIntercomDto,
  toSecretFollowUpDto,
} from '../src/modules/intercom-realtime/intercom.dto.js';
import {
  followUpWindowSchema,
  followUpTypeSchema,
  intercomSendSchema,
  ownershipAllows,
} from '../src/modules/intercom-realtime/intercom.validators.js';
import {
  sendIntercom,
  updateFollowUpStatus,
  type Actor,
} from '../src/modules/intercom-realtime/intercom.service.js';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// BE-401 gate 1: rooms segregate strictly by role.
// ---------------------------------------------------------------------------
{
  const sec = roomsForRole('SECRETARY', 'u-sec');
  assert.ok(sec.includes(ROOM_QUEUE_OPS), 'SECRETARY joins clinic:queue:ops');
  assert.ok(sec.includes(ROOM_INTERCOM), 'SECRETARY joins clinic:intercom');
  assert.ok(sec.includes(userRoom('u-sec')), 'SECRETARY joins own user room');
  assert.ok(!sec.includes(ROOM_QUEUE_DOCTOR), 'SECRETARY never joins clinic:queue:doctor');
  assert.ok(!sec.includes(ROOM_SCRIBE_DOCTOR), 'SECRETARY never joins scribe doctor room');

  const doc = roomsForRole('DOCTOR', 'u-doc');
  assert.ok(doc.includes(ROOM_QUEUE_DOCTOR), 'DOCTOR joins clinic:queue:doctor');
  assert.ok(doc.includes(ROOM_INTERCOM), 'DOCTOR joins clinic:intercom');
  assert.ok(doc.includes(ROOM_SCRIBE_DOCTOR), 'DOCTOR joins clinic:scribe:doctor');
  assert.ok(doc.includes(userRoom('u-doc')), 'DOCTOR joins own user room');
  assert.ok(!doc.includes(ROOM_QUEUE_OPS), 'DOCTOR never joins clinic:queue:ops');

  assert.equal(userRoom('abc'), 'user:abc');
}

// ---------------------------------------------------------------------------
// BE-402 gate 3: role-type ownership matrix. Forged types are rejected.
// ---------------------------------------------------------------------------
{
  // DOCTOR-owned types (exclusive: NEXT + FOLLOWUP; CUSTOM_TEXT is shared, tested below)
  for (const t of ['DOCTOR_NEXT', 'DOCTOR_FOLLOWUP'] as const) {
    assert.equal(ownershipAllows('DOCTOR', t), true, `DOCTOR may send ${t}`);
    assert.equal(ownershipAllows('SECRETARY', t), false, `SECRETARY may NOT send ${t}`);
  }
  // SECRETARY-owned types
  for (const t of ['SEC_DISRUPTION', 'SEC_PHARMACY_LAB', 'SEC_CORRECTION_REQUEST', 'CUSTOM_TEXT'] as const) {
    assert.equal(ownershipAllows('SECRETARY', t), true, `SECRETARY may send ${t}`);
  }
  // CUSTOM_TEXT is shared by BOTH roles.
  assert.equal(ownershipAllows('DOCTOR', 'CUSTOM_TEXT'), true);
  assert.equal(ownershipAllows('SECRETARY', 'CUSTOM_TEXT'), true);
  // SECRETARY may NOT send DOCTOR_FOLLOWUP (forged) — the key invariant.
  assert.equal(ownershipAllows('SECRETARY', 'DOCTOR_FOLLOWUP'), false);
  assert.equal(ownershipAllows('DOCTOR', 'SEC_DISRUPTION'), false);
  // DOCTOR_COMPLIMENTARY is notification-only: NOT sendable by chat for either role.
  assert.equal(ownershipAllows('DOCTOR', 'DOCTOR_COMPLIMENTARY'), false);
  assert.equal(ownershipAllows('SECRETARY', 'DOCTOR_COMPLIMENTARY'), false);
}

// ---------------------------------------------------------------------------
// BE-402: intercom.send payload validation.
// ---------------------------------------------------------------------------
{
  assert.equal(intercomSendSchema.safeParse({ type: 'DOCTOR_NEXT', relatedQueueEntryId: 'e1' }).success, true);
  assert.equal(intercomSendSchema.safeParse({ type: 'CUSTOM_TEXT', text: 'hi' }).success, true);
  assert.equal(intercomSendSchema.safeParse({ type: 'SEC_PHARMACY_LAB', code1: 'PH1', code2: 'LB2' }).success, true);

  // CUSTOM_TEXT requires non-blank text.
  assert.equal(intercomSendSchema.safeParse({ type: 'CUSTOM_TEXT' }).success, false);
  assert.equal(intercomSendSchema.safeParse({ type: 'CUSTOM_TEXT', text: '   ' }).success, false);

  // DOCTOR_FOLLOWUP requires a followUp descriptor.
  assert.equal(intercomSendSchema.safeParse({ type: 'DOCTOR_FOLLOWUP', relatedQueueEntryId: 'e1' }).success, false);

  // Decision 5 canonical vocabulary: only GENERAL / NEXT_VISIT are valid, and
  // the free-string vocabulary of earlier builds is rejected (422).
  assert.equal(
    intercomSendSchema.safeParse({
      type: 'DOCTOR_FOLLOWUP',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' },
    }).success,
    true,
  );
  assert.equal(
    intercomSendSchema.safeParse({
      type: 'DOCTOR_FOLLOWUP',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'LAB_RESULT', window: '48h' },
    }).success,
    false,
  );
  assert.equal(
    intercomSendSchema.safeParse({
      type: 'DOCTOR_FOLLOWUP',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'GENERAL' },
    }).success,
    false,
  ); // window required

  // Unknown type rejected; strict rejects unknown keys; text capped.
  assert.equal(intercomSendSchema.safeParse({ type: 'NOT_A_TYPE' }).success, false);
  assert.equal(intercomSendSchema.safeParse({ type: 'DOCTOR_NEXT', extra: 1 }).success, false);
  assert.equal(intercomSendSchema.safeParse({ type: 'CUSTOM_TEXT', text: 'x'.repeat(1001) }).success, false);

  // idempotencyKey must be a uuid when present.
  assert.equal(intercomSendSchema.safeParse({ type: 'DOCTOR_NEXT', idempotencyKey: 'not-a-uuid' }).success, false);
  assert.equal(
    intercomSendSchema.safeParse({ type: 'DOCTOR_NEXT', idempotencyKey: '11111111-1111-4111-8111-111111111111' }).success,
    true,
  );
}

// ---------------------------------------------------------------------------
// BE-402 gate 5: secretary-facing DTOs are branded SecretSafe allowlists.
// ---------------------------------------------------------------------------
{
  const intercom = toSecretIntercomDto({
    id: 'm1',
    fromUserId: 'u1',
    fromRole: 'DOCTOR',
    messageType: 'DOCTOR_NEXT',
    bodyText: null,
    relatedQueueEntryId: 'e1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.equal(isSecretSafe(intercom), true);
  assert.deepEqual({ ...intercom }, {
    id: 'm1',
    fromUserId: 'u1',
    fromRole: 'DOCTOR',
    type: 'DOCTOR_NEXT',
    text: null,
    relatedQueueEntryId: 'e1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const fu = toSecretFollowUpDto({
    id: 'f1',
    patientId: 'p1',
    requestedByUserId: 'u1',
    note: 'Repeat review of sleep hygiene plan',
    followUpType: 'GENERAL',
    window: 'NEXT_VISIT',
    status: 'REQUESTED',
    sourceMessageId: 'm1',
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    resolvedAt: null,
  });
  assert.equal(isSecretSafe(fu), true);
  assert.equal({ ...fu }.status, 'REQUESTED');
  // Decision 5: the canonical descriptor rides on the DTO (structural, not note-flattened).
  assert.equal({ ...fu }.followUpType, 'GENERAL');
  assert.equal({ ...fu }.window, 'NEXT_VISIT');
  assert.equal({ ...fu }.note, 'Repeat review of sleep hygiene plan');
}

// ---------------------------------------------------------------------------
// BE-402 service level (Decision 5): structural descriptor persistence, the
// doctor's note is preserved (not flattened), and the canonical status machine
// is enforced with role + from-state checks and FOLLOWUP_UPDATE audits.
// ---------------------------------------------------------------------------
{
  // Canonical vocabulary is exported for the contract surface.
  assert.deepEqual([...followUpTypeSchema.options], ['GENERAL']);
  assert.deepEqual([...followUpWindowSchema.options], ['NEXT_VISIT']);

  interface FollowUpRow {
    id: string;
    patientId: string;
    requestedByUserId: string;
    note: string;
    followUpType: string;
    window: string;
    status: string;
    requestedAt: Date;
    resolvedAt: Date | null;
    sourceMessageId: string | null;
  }
  const followUps: FollowUpRow[] = [];
  const audits: Array<{ action: string; entityId: string; afterState: Record<string, unknown> | null }> = [];

  const tx = {
    intercomMessage: {
      create: (): Promise<{ id: string; createdAt: Date }> =>
        Promise.resolve({ id: 'm1', createdAt: new Date('2026-10-11T00:00:00Z') }),
    },
    queueEntry: {
      findUnique: (args: { where: { id: string } }): Promise<{ patientId: string } | null> =>
        Promise.resolve(args.where.id === 'e1' ? { patientId: 'p1' } : null),
    },
    followUpTask: {
      create: (args: { data: Record<string, unknown> }): Promise<FollowUpRow> => {
        const row: FollowUpRow = {
          id: `f${followUps.length + 1}`,
          patientId: String(args.data['patientId']),
          requestedByUserId: String(args.data['requestedByUserId']),
          note: String(args.data['note']),
          followUpType: String(args.data['followUpType']),
          window: String(args.data['window']),
          status: String(args.data['status']),
          requestedAt: new Date('2026-10-11T00:00:00Z'),
          resolvedAt: null,
          sourceMessageId: String(args.data['sourceMessageId'] ?? null),
        };
        followUps.push(row);
        return Promise.resolve(row);
      },
      findUnique: (args: { where: { id: string } }): Promise<Pick<FollowUpRow, 'id' | 'status'> | null> => {
        const row = followUps.find((f) => f.id === args.where.id);
        return Promise.resolve(row === undefined ? null : { id: row.id, status: row.status });
      },
      update: (args: { where: { id: string }; data: { status: string; resolvedAt: Date | null } }): Promise<FollowUpRow> => {
        const row = followUps.find((f) => f.id === args.where.id);
        if (row === undefined) return Promise.reject(new Error('not found'));
        row.status = args.data.status;
        row.resolvedAt = args.data.resolvedAt;
        return Promise.resolve(row);
      },
    },
    auditEvent: {
      create: (args: { data: { action: string; entityId: string; afterState?: Record<string, unknown> } }): Promise<{ id: string }> => {
        audits.push({ action: args.data.action, entityId: args.data.entityId, afterState: args.data.afterState ?? null });
        return Promise.resolve({ id: 'a1' });
      },
    },
  };
  const db = { $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx), ...tx } as unknown as PrismaClient;

  const DOCTOR_ACTOR: Actor = { userId: 'u-doc', role: 'DOCTOR' };
  const SEC_ACTOR: Actor = { userId: 'u-sec', role: 'SECRETARY' };

  // Creation: descriptor persists structurally; the doctor's note is preserved.
  const sent = await sendIntercom(
    {
      type: 'DOCTOR_FOLLOWUP',
      text: 'Review sleep hygiene plan in two weeks',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' },
    },
    DOCTOR_ACTOR,
    db,
  );
  assert.equal(followUps.length, 1, 'DOCTOR_FOLLOWUP creates exactly one follow-up task');
  const row = followUps[0]!;
  assert.equal(row.followUpType, 'GENERAL', 'type persisted structurally');
  assert.equal(row.window, 'NEXT_VISIT', 'window persisted structurally');
  assert.equal(row.note, 'Review sleep hygiene plan in two weeks', "the doctor's note is preserved (no flattening)");
  assert.equal(row.status, 'REQUESTED');
  assert.equal(sent.followUp !== null, true);
  assert.equal({ ...(sent.followUp as unknown as Record<string, unknown>) }['note'], row.note);
  assert.ok(audits.some((a) => a.action === 'FOLLOWUP_CREATE'));

  // R11 boundary: the note persists VERBATIM up to the canonical 1000-char
  // budget (column widened by migration 0013) — meaningful trailing text is
  // never clipped, and one char over the budget is rejected by the validator.
  {
    const exact = 'Review plan: ' + 'x'.repeat(982) + '-TAIL'; // 13 + 982 + 5 = 1000
    assert.equal(exact.length, 1000);
    followUps.length = 0;
    await sendIntercom(
      {
        type: 'DOCTOR_FOLLOWUP',
        text: exact,
        relatedQueueEntryId: 'e1',
        followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' },
      },
      DOCTOR_ACTOR,
      db,
    );
    assert.equal(followUps[0]!.note.length, 1000, 'exactly-1000 note is accepted');
    assert.equal(followUps[0]!.note.endsWith('-TAIL'), true, 'trailing instruction text survives persistence');
    assert.equal(followUps[0]!.note, exact, 'verbatim persistence (no truncation)');
    assert.equal(
      intercomSendSchema.safeParse({ type: 'DOCTOR_FOLLOWUP', text: 'x'.repeat(1000), relatedQueueEntryId: 'e1', followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' } }).success,
      true,
      'validator accepts the exact maximum',
    );
    assert.equal(
      intercomSendSchema.safeParse({ type: 'DOCTOR_FOLLOWUP', text: 'x'.repeat(1001), relatedQueueEntryId: 'e1', followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' } }).success,
      false,
      'validator rejects one char over the budget',
    );
  }

  // Invalid descriptor values are rejected upstream by the validator; the
  // service-level contract for unsupported types is 422 (validated, never stored).
  assert.equal(
    intercomSendSchema.safeParse({
      type: 'DOCTOR_FOLLOWUP',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'ROUTINE_REVIEW', window: '72_HOURS' },
    }).success,
    false,
  );

  // Canonical status machine (role + from-state):
  // SECRETARY REQUESTED -> SCHEDULED: legal.
  await updateFollowUpStatus('f1', 'SCHEDULED', SEC_ACTOR, db);
  assert.equal(followUps[0]!.status, 'SCHEDULED');
  assert.ok(audits.filter((a) => a.action === 'FOLLOWUP_UPDATE').length >= 1);

  // SECRETARY SCHEDULED -> DONE: legal (terminal, resolvedAt set).
  await updateFollowUpStatus('f1', 'DONE', SEC_ACTOR, db);
  assert.equal(followUps[0]!.status, 'DONE');
  assert.ok(followUps[0]!.resolvedAt !== null);

  // DONE is terminal: even SECRETARY cannot move it back.
  let thrown: unknown = null;
  try {
    await updateFollowUpStatus('f1', 'SCHEDULED', SEC_ACTOR, db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'ILLEGAL_TRANSITION');

  // Role guard: DOCTOR may only CANCEL.
  thrown = null;
  try {
    await updateFollowUpStatus('f1', 'DONE', DOCTOR_ACTOR, db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'FORBIDDEN');

  // DOCTOR cancel on a fresh REQUESTED task: legal.
  await sendIntercom(
    {
      type: 'DOCTOR_FOLLOWUP',
      text: 'Second task',
      relatedQueueEntryId: 'e1',
      followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' },
    },
    DOCTOR_ACTOR,
    db,
  );
  await updateFollowUpStatus('f2', 'CANCELLED', DOCTOR_ACTOR, db);
  assert.equal(followUps[1]!.status, 'CANCELLED');
  assert.ok(followUps[1]!.resolvedAt !== null);
}

// eslint-disable-next-line no-console
console.log('BE-401/402 rooms, intercom ownership + validators + SecretSafe DTO tests passed.');
