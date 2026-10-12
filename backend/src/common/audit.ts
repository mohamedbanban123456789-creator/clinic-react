import { randomUUID } from 'node:crypto';
import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';
import { logger } from './utils/logger.js';

/**
 * BE-701 canonical immutable-audit writer (DB-19 / RPS-2).
 *
 * Every sensitive mutation writes exactly one AuditEvent with a unique
 * `requestId`. `beforeState`/`afterState` are OPERATIONAL allowlisted structs
 * only — callers pass ids, statuses, versions, reasons, boolean/int flags.
 * NEVER clinical content (SOAP/MSE/transcript/diagnoses/notes). The runtime
 * grant REVOKEs UPDATE/DELETE on audit_events (canon.sql), so this is
 * append-only; there is no update/delete path (tripwire C-6).
 *
 * Dedup (DB-19): a repeated `requestId` (an idempotent replay racing the first
 * write) hits the unique index (P2002) and is swallowed — the original event
 * already stands. Audit is best-effort and must never break the calling
 * operation, so any other failure is logged and dropped.
 */
export type AuditTx = PrismaClient | Prisma.TransactionClient;

export interface WriteAuditInput {
  readonly actorUserId: string;
  readonly actorRole: 'DOCTOR' | 'SECRETARY';
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly requestId?: string;
  readonly idempotencyKey?: string | null;
  readonly reasonText?: string | null;
  readonly beforeState?: Prisma.InputJsonValue;
  readonly afterState?: Prisma.InputJsonValue;
}

export async function writeAudit(tx: AuditTx, input: WriteAuditInput): Promise<void> {
  try {
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: input.requestId ?? randomUUID(),
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.reasonText !== undefined ? { reasonText: input.reasonText } : {}),
        ...(input.beforeState !== undefined ? { beforeState: input.beforeState } : {}),
        ...(input.afterState !== undefined ? { afterState: input.afterState } : {}),
      },
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
      // Duplicate requestId — the original audit event already stands (idempotent replay).
      logger.info('audit.duplicateRequestId.skipped', {
        action: input.action,
        requestId: input.requestId ?? null,
      });
      return;
    }
    logger.warn('audit.writeFailed', { action: input.action, err: String(err) });
  }
}

/** Strip any non-operational key helper is intentionally NOT provided (CONV-02):
 *  beforeState/afterState are operational structs BY CONSTRUCTION at every call
 *  site. This guard is a defense-in-depth tripwire for accidental clinical keys. */
const FORBIDDEN_STATE_KEY_PREFIXES: readonly string[] = [
  'soap',
  'mse',
  'transcript',
  'diagnos',
  'assessment',
  'plan',
  'medication',
  'therapy',
  'vault',
  'consent',
  'scribedraft',
];

/** True when an operational audit-state object accidentally carries a clinical key. */
export function auditStateHasClinicalKey(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  for (const key of Object.keys(state as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_STATE_KEY_PREFIXES.some((p) => lower.startsWith(p))) return true;
  }
  return false;
}
