import type { Prisma, PrismaClient, Role } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { writeAudit } from '../../common/audit.js';
import { broadcastIntercom } from '../../common/realtime.js';
import {
  toSecretFollowUpDto,
  toSecretFollowUpListDto,
  toSecretIntercomDto,
  toSecretIntercomListDto,
} from './intercom.dto.js';
import { ownershipAllows, type IntercomSendInput } from './intercom.validators.js';

/**
 * BE-402 In-Clinic Intercom + Follow-Up service (RPS-2).
 *
 * Invariants enforced here:
 *  - Role-type ownership: a caller may only send types its role owns (else 403).
 *  - DOCTOR_COMPLIMENTARY is NOTIFICATION-ONLY: chat NEVER executes a financial
 *    write. The billing complimentary path stays a separate REST endpoint.
 *  - DOCTOR_FOLLOWUP creates a FollowUpTask in the SAME transaction as the message.
 *  - Every send audits INTERCOM_SEND (+ FOLLOWUP_CREATE) with operational-only
 *    state (DB-19) — no clinical content is copied into the audit snapshot.
 */

export interface Actor {
  readonly userId: string;
  readonly role: Role;
}

const DEFAULT_LIMIT = 50;

/**
 * The persisted note is the DOCTOR'S OWN INSTRUCTION (the actionable payload
 * the desk works from). The structured followUpType/window are persisted on
 * their own columns (Decision 5), so the note no longer needs to carry them.
 * Capacity (R11): the canonical text budget is MAX_TEXT=1000 (validator-capped)
 * and migration 0013 widened the column to VARCHAR(1000), so validator-compliant
 * instructions persist VERBATIM — the slice below is a last-resort capacity
 * invariant, never a silent truncation path for valid input.
 */
function composeFollowUpNote(input: IntercomSendInput): string {
  return (input.text ?? 'Follow-up requested').slice(0, 1000);
}

export interface SendIntercomResult {
  readonly message: ReturnType<typeof toSecretIntercomDto>;
  readonly followUp: ReturnType<typeof toSecretFollowUpDto> | null;
}

/**
 * Persist an intercom message (and optional follow-up task), audit it, and
 * broadcast `intercom.received` to clinic:intercom. Role ownership must already
 * be validated by the caller (WS handler or route) — this trusts `actor.role`.
 */
export async function sendIntercom(
  input: IntercomSendInput,
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<SendIntercomResult> {
  if (!ownershipAllows(actor.role, input.type)) {
    throw new AppError('FORBIDDEN', 'Role is not permitted to send this intercom type');
  }

  const result = await db.$transaction(async (tx) => {
    const message = await tx.intercomMessage.create({
      data: {
        fromUserId: actor.userId,
        fromRole: actor.role,
        messageType: input.type,
        bodyText: input.text ?? null,
        relatedQueueEntryId: input.relatedQueueEntryId ?? null,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    });

    let followUp = null;
    if (input.type === 'DOCTOR_FOLLOWUP') {
      const descriptor = input.followUp;
      if (descriptor === undefined) {
        throw new AppError('BAD_REQUEST', 'DOCTOR_FOLLOWUP requires a followUp descriptor');
      }
      // Resolve the patient from the related queue entry (operational correlation).
      let patientId: string | null = null;
      if (input.relatedQueueEntryId !== undefined) {
        const entry = await tx.queueEntry.findUnique({
          where: { id: input.relatedQueueEntryId },
          select: { patientId: true },
        });
        patientId = entry?.patientId ?? null;
      }
      if (patientId === null) {
        throw new AppError('BAD_REQUEST', 'DOCTOR_FOLLOWUP requires a valid relatedQueueEntryId');
      }
      followUp = await tx.followUpTask.create({
        data: {
          patientId,
          requestedByUserId: actor.userId,
          note: composeFollowUpNote(input),
          // Decision 5: the descriptor persists structurally (its own columns),
          // not flattened into the note.
          followUpType: descriptor.followUpType,
          window: descriptor.window,
          status: 'REQUESTED',
          sourceMessageId: message.id,
        },
      });
    }

    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'INTERCOM_SEND',
      entityType: 'IntercomMessage',
      entityId: message.id,
      idempotencyKey: input.idempotencyKey ?? null,
      // Operational-only state: type + refs + presence flags. NO clinical text.
      afterState: {
        type: input.type,
        relatedQueueEntryId: input.relatedQueueEntryId ?? null,
        hasText: input.text !== undefined && input.text.length > 0,
        code1: input.code1 ?? null,
        code2: input.code2 ?? null,
        relatedReceiptId: input.relatedReceiptId ?? null,
      },
    });

    if (followUp !== null) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'FOLLOWUP_CREATE',
        entityType: 'FollowUpTask',
        entityId: followUp.id,
        afterState: {
          patientId: followUp.patientId,
          sourceMessageId: message.id,
          status: 'REQUESTED',
        },
      });
    }

    return { message, followUp };
  });

  const messageDto = toSecretIntercomDto(result.message);
  const followUpDto = result.followUp === null ? null : toSecretFollowUpDto(result.followUp);
  broadcastIntercom(messageDto);
  return { message: messageDto, followUp: followUpDto };
}

/** GET /api/v1/intercom — paginated history (SecretSafe, newest first). */
export async function listIntercom(
  query: { limit?: number | undefined; cursor?: string | undefined },
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretIntercomListDto>> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const rows = await db.intercomMessage.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return toSecretIntercomListDto(page, nextCursor);
}

/** GET /api/v1/followups — paginated follow-up tasks filtered by patient/status. */
export async function listFollowUps(
  query: {
    patientId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  },
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretFollowUpListDto>> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const where: Prisma.FollowUpTaskWhereInput = {
    ...(query.patientId !== undefined ? { patientId: query.patientId } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
  };
  const rows = await db.followUpTask.findMany({
    where,
    // id tie-breaker: same-second creates must not skip/duplicate across pages.
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return toSecretFollowUpListDto(page, nextCursor);
}

/** Which target statuses each role may set on a follow-up task (ticket). */
const FOLLOWUP_ROLE_TRANSITIONS: Readonly<Record<Role, readonly string[]>> = {
  SECRETARY: ['SCHEDULED', 'DONE'],
  DOCTOR: ['CANCELLED'],
};

/**
 * Canonical from-state machine (Decision 5): REQUESTED → SCHEDULED|DONE|
 * CANCELLED; SCHEDULED → DONE|CANCELLED; DONE and CANCELLED are terminal.
 * Combined with the role matrix above the supported moves are exactly:
 * SECRETARY REQUESTED→SCHEDULED, SECRETARY REQUESTED|SCHEDULED→DONE,
 * DOCTOR REQUESTED|SCHEDULED→CANCELLED.
 */
const FOLLOWUP_FROM_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  REQUESTED: ['SCHEDULED', 'DONE', 'CANCELLED'],
  SCHEDULED: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

/** PATCH /api/v1/followups/:id — role-scoped status update. */
export async function updateFollowUpStatus(
  id: string,
  status: 'REQUESTED' | 'SCHEDULED' | 'DONE' | 'CANCELLED',
  actor: Actor,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretFollowUpDto>> {
  const allowed = FOLLOWUP_ROLE_TRANSITIONS[actor.role];
  if (allowed === undefined || !allowed.includes(status)) {
    throw new AppError('FORBIDDEN', 'Role may not set this follow-up status');
  }
  const existing = await db.followUpTask.findUnique({ where: { id }, select: { id: true, status: true } });
  if (existing === null) throw AppError.notFound('Follow-up task not found');
  const fromTargets = FOLLOWUP_FROM_TRANSITIONS[existing.status] ?? [];
  if (!fromTargets.includes(status)) {
    throw new AppError('ILLEGAL_TRANSITION', `Follow-up transition ${existing.status} -> ${status} is not allowed`, [
      { field: 'status', issue: `${existing.status} is ${fromTargets.length === 0 ? 'terminal' : `only movable to ${fromTargets.join('|')}`}`, expected: fromTargets.join('|') || 'none' },
    ]);
  }

  const terminal = status === 'DONE' || status === 'CANCELLED';
  const updated = await db.followUpTask.update({
    where: { id },
    data: {
      status,
      resolvedAt: terminal ? new Date() : null,
    },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'FOLLOWUP_UPDATE',
    entityType: 'FollowUpTask',
    entityId: id,
    afterState: { status, fromStatus: existing.status },
  });
  return toSecretFollowUpDto(updated);
}
