import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

/**
 * BE-701 audit query DTO (CONV-02 allowlist-first). AuditEvent rows are
 * operational-only by construction (DB-19): before/after snapshots are written
 * through the operational allowlist at write time and carry no clinical keys.
 */
export interface AuditEventDto {
  readonly id: string;
  readonly action: string;
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly requestId: string | null;
  readonly idempotencyKey: string | null;
  readonly reasonText: string | null;
  readonly beforeState: unknown | null;
  readonly afterState: unknown | null;
  readonly createdAt: string;
}

export interface AuditEventListDto {
  readonly data: readonly AuditEventDto[];
  readonly nextCursor: string | null;
}

interface AuditEventRow {
  readonly id: string;
  readonly action: string;
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly requestId: string | null;
  readonly idempotencyKey: string | null;
  readonly reasonText: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly createdAt: Date;
}

/** Allowlist-first mapper: only picked keys leave the server. */
export function toSecretAuditEventDto(row: AuditEventRow): SecretSafe<AuditEventDto> {
  return markSecretSafe<AuditEventDto>({
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    entityType: row.entityType,
    entityId: row.entityId,
    requestId: row.requestId ?? null,
    idempotencyKey: row.idempotencyKey,
    reasonText: row.reasonText,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toSecretAuditEventListDto(
  events: readonly SecretSafe<AuditEventDto>[],
  nextCursor: string | null,
): SecretSafe<AuditEventListDto> {
  return markSecretSafe<AuditEventListDto>({ data: events, nextCursor });
}
