import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/utils/logger.js';

export interface ActorRef {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

const SEARCH_WINDOW_MS = 60_000;
const SEARCH_MAX_PER_WINDOW = 30;
const searchBuckets = new Map<string, number[]>();

export function checkPatientSearchRateLimit(userId: string): void {
  const now = Date.now();
  const prev = searchBuckets.get(userId) ?? [];
  const fresh = prev.filter((at) => now - at < SEARCH_WINDOW_MS);
  if (fresh.length >= SEARCH_MAX_PER_WINDOW) {
    searchBuckets.set(userId, fresh);
    throw new AppError('RATE_LIMITED', 'Patient search rate limit exceeded (30/min)', [
      { field: 'q', issue: 'too many search requests', expected: 'retry after 60 seconds' },
    ]);
  }
  fresh.push(now);
  searchBuckets.set(userId, fresh);
}

export function resetPatientSearchRateLimitForTest(): void {
  searchBuckets.clear();
}

export type PatientAuditAction = 'PATIENT_CREATE' | 'PATIENT_UPDATE' | 'PATIENT_SEARCH' | 'PATIENT_FLAGGED_DUPLICATE';

export async function writePatientAudit(
  db: PrismaClient,
  row: {
    actorUserId: string;
    actorRole: 'DOCTOR' | 'SECRETARY';
    action: PatientAuditAction;
    entityId: string;
    queryHash?: string;
    resultCount?: number;
    reasonText?: string;
  },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: 'Patient',
        entityId: row.entityId,
        reasonText: row.reasonText ?? null,
        requestId: randomUUID(),
        ...(row.queryHash !== undefined || row.resultCount !== undefined
          ? {
              afterState: {
                ...(row.queryHash !== undefined ? { queryHash: row.queryHash } : {}),
                ...(row.resultCount !== undefined ? { resultCount: row.resultCount } : {}),
              },
            }
          : {}),
      },
    });
  } catch (err) {
    logger.warn('patient.audit.writeFailed', { action: row.action });
    void err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2002';
}

export function toDisplayOrNull(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
