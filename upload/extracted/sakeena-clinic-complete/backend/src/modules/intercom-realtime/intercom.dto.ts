import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';
import type { IntercomType, Role } from '@prisma/client';

/**
 * BE-402 intercom + follow-up DTOs (CONV-02 allowlist-first).
 *
 * IntercomMessage/FollowUpTask hold NO clinical columns (DB-02): `text` is a
 * capped operational free-text channel the doctor/secretary type. Structured
 * clinical content is NEVER auto-included. Both are branded SecretSafe so the
 * global sanitizer passes for SECRETARY responses and the WS frames carry only
 * allowlisted keys.
 */

export interface IntercomDto {
  readonly id: string;
  readonly fromUserId: string;
  readonly fromRole: Role;
  readonly type: IntercomType;
  readonly text: string | null;
  readonly relatedQueueEntryId: string | null;
  readonly createdAt: string;
}

export type FollowUpStatus = 'REQUESTED' | 'SCHEDULED' | 'DONE' | 'CANCELLED';

export type FollowUpType = 'GENERAL';
export type FollowUpWindow = 'NEXT_VISIT';

export interface FollowUpDto {
  readonly id: string;
  readonly patientId: string;
  readonly requestedByUserId: string;
  readonly note: string;
  readonly followUpType: FollowUpType;
  readonly window: FollowUpWindow;
  readonly status: FollowUpStatus;
  readonly sourceMessageId: string | null;
  readonly requestedAt: string;
  readonly resolvedAt: string | null;
}

export interface IntercomListDto {
  readonly data: readonly IntercomDto[];
  readonly nextCursor: string | null;
}

export interface FollowUpListDto {
  readonly data: readonly FollowUpDto[];
  readonly nextCursor: string | null;
}

interface IntercomRowLike {
  readonly id: string;
  readonly fromUserId: string;
  readonly fromRole: Role;
  readonly messageType: IntercomType;
  readonly bodyText: string | null;
  readonly relatedQueueEntryId: string | null;
  readonly createdAt: Date;
}

interface FollowUpRowLike {
  readonly id: string;
  readonly patientId: string;
  readonly requestedByUserId: string;
  readonly note: string;
  readonly followUpType: string;
  readonly window: string;
  readonly status: string;
  readonly sourceMessageId: string | null;
  readonly requestedAt: Date;
  readonly resolvedAt: Date | null;
}

export function toSecretIntercomDto(row: IntercomRowLike): SecretSafe<IntercomDto> {
  return markSecretSafe<IntercomDto>({
    id: row.id,
    fromUserId: row.fromUserId,
    fromRole: row.fromRole,
    type: row.messageType,
    text: row.bodyText,
    relatedQueueEntryId: row.relatedQueueEntryId,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toSecretFollowUpDto(row: FollowUpRowLike): SecretSafe<FollowUpDto> {
  return markSecretSafe<FollowUpDto>({
    id: row.id,
    patientId: row.patientId,
    requestedByUserId: row.requestedByUserId,
    note: row.note,
    followUpType: row.followUpType as FollowUpType,
    window: row.window as FollowUpWindow,
    status: row.status as FollowUpStatus,
    sourceMessageId: row.sourceMessageId,
    requestedAt: row.requestedAt.toISOString(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
  });
}

export function toSecretIntercomListDto(
  rows: readonly IntercomRowLike[],
  nextCursor: string | null,
): SecretSafe<IntercomListDto> {
  return markSecretSafe<IntercomListDto>({
    data: rows.map((r) => toSecretIntercomDto(r)),
    nextCursor,
  });
}

export function toSecretFollowUpListDto(
  rows: readonly FollowUpRowLike[],
  nextCursor: string | null,
): SecretSafe<FollowUpListDto> {
  return markSecretSafe<FollowUpListDto>({
    data: rows.map((r) => toSecretFollowUpDto(r)),
    nextCursor,
  });
}
