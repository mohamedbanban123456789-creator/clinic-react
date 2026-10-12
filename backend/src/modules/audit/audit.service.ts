import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import type { SecretSafe } from '../../common/types/secretSafe.js';
import { toSecretAuditEventDto, toSecretAuditEventListDto, type AuditEventListDto } from './audit.dto.js';
import type { AuditQuery } from './audit.validators.js';

export interface AuditActor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

/**
 * Vault/scribe entity types are filtered out of the SECRETARY view
 * (WBS BE-701: "GET /audit [DOCTOR full; SECRETARY own operational,
 * vault/scribe filtered]").
 */
const SECRETARY_HIDDEN_ENTITY_TYPES = ['TherapyNote', 'ScribeSession', 'ScribeDraft'] as const;

/**
 * BE-701 GET /audit — immutable-audit query with filters (date/actor/entity)
 * and cursor pagination. DOCTOR sees the full feed; SECRETARY sees only their
 * own operational events with vault/scribe entities excluded.
 */
export async function queryAuditEvents(
  query: AuditQuery,
  actor: AuditActor,
  db: PrismaClient = prisma,
): Promise<SecretSafe<AuditEventListDto>> {
  const isSecretary = actor.role === 'SECRETARY';
  const hidden = SECRETARY_HIDDEN_ENTITY_TYPES as readonly string[];

  // A SECRETARY can never target a vault/scribe entity type directly — the
  // explicit filter must not override the role-based exclusion.
  if (isSecretary && query.entityType !== undefined && hidden.includes(query.entityType)) {
    return toSecretAuditEventListDto([], null);
  }

  const where: Prisma.AuditEventWhereInput = {};
  if (query.action !== undefined) where.action = query.action;
  if (query.entityId !== undefined) where.entityId = query.entityId;
  if (query.startDate !== undefined || query.endDate !== undefined) {
    where.createdAt = {
      ...(query.startDate !== undefined ? { gte: query.startDate } : {}),
      ...(query.endDate !== undefined ? { lte: query.endDate } : {}),
    };
  }
  if (query.entityType !== undefined) {
    where.entityType = query.entityType;
  } else if (isSecretary) {
    where.entityType = { notIn: [...hidden] };
  }
  if (isSecretary) {
    // Own operational scope only — never other actors' events. An explicit
    // actorUserId filter is overridden with the caller's own id.
    where.actorUserId = actor.userId;
  } else if (query.actorUserId !== undefined) {
    where.actorUserId = query.actorUserId;
  }

  const limit = query.limit ?? 50;
  const rows = await db.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return toSecretAuditEventListDto(page.map((row) => toSecretAuditEventDto(row)), nextCursor);
}
