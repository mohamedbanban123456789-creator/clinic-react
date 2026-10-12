import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../prisma.js';
import { logger } from '../utils/logger.js';
import { markSecretSafe } from '../types/secretSafe.js';

/**
 * BE-301..303 Idempotency middleware (DB-08 / CONV RPS-2).
 *
 * Enforces a mandatory `Idempotency-Key: <uuid-v4>` header on financial write
 * endpoints and stores the cached 2xx response for 24h keyed by
 * (scope, actor, key):
 *   - Missing / non-uuid key      -> 422 IDEMPOTENCY_KEY_REQUIRED
 *   - Replay, identical payload   -> 200 cached body + `Idempotent-Replayed: true`
 *                                    + `replayed: true` (zero duplicate rows)
 *   - Replay, differing payload   -> 409 IDEMPOTENCY_KEY_CONFLICT
 *
 * MUST be mounted after `authenticate` + `requireRole` (needs req.auth.userId)
 * and before `validate` so the canonical (pre-parse) body/params are hashed.
 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const UUID = z.string().uuid('Idempotency-Key must be a uuid v4');

function readKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  const parsed = UUID.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid v4) is required');
  }
  return parsed.data;
}

function hashRequest(scope: string, actorUserId: string, key: string, req: Request): string {
  const canonical = JSON.stringify({
    scope,
    actorUserId,
    key,
    params: req.params ?? {},
    body: req.body ?? {},
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function idempotency(scope: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    let key: string;
    try {
      key = readKey(req);
    } catch (err) {
      next(err);
      return;
    }
    const actorUserId = req.auth?.userId;
    if (actorUserId === undefined) {
      next(AppError.unauthorized());
      return;
    }
    const requestHash = hashRequest(scope, actorUserId, key, req);

    prisma.idempotencyRecord
      .findUnique({
        where: { scope_actorUserId_key: { scope, actorUserId, key } },
      })
      .then((existing) => {
        const now = Date.now();
        if (existing !== null && existing.expiresAt.getTime() > now) {
          if (existing.requestHash !== requestHash) {
            next(new AppError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key was reused with a different payload'));
            return;
          }
          // Replay: return the cached response verbatim, re-branded SecretSafe so
          // the global SECRETARY sanitizer passes (JSON round-trip drops the marker).
          // The recorded status is preserved (201-created replays must not downgrade
          // to 200); records only exist for 2xx originals, so guard the restore.
          const cached = existing.responseBody as Record<string, unknown>;
          res.set('Idempotent-Replayed', 'true');
          const replayStatus =
            typeof existing.responseStatus === 'number' && existing.responseStatus >= 200 && existing.responseStatus < 300
              ? existing.responseStatus
              : 200;
          res.status(replayStatus).json(markSecretSafe<Record<string, unknown>>({ ...cached, replayed: true }));
          // CONV-03: replays log exactly one IDEMPOTENT_REPLAY audit (ids only,
          // best-effort — an audit failure must never break the replay).
          void prisma.auditEvent
            .create({
              data: {
                actorUserId,
                actorRole: req.auth?.role ?? 'SECRETARY',
                action: 'IDEMPOTENT_REPLAY',
                entityType: 'IdempotencyRecord',
                entityId: key,
                requestId: randomUUID(),
                idempotencyKey: key,
                afterState: { scope, responseStatus: existing.responseStatus },
              },
            })
            .catch((err: unknown) => logger.warn('idempotency.replayAuditFailed', { scope, err: String(err) }));
          return;
        }
        if (existing !== null) {
          // Expired record: clear it so the fresh run can upsert cleanly.
          void prisma.idempotencyRecord
            .delete({ where: { id: existing.id } })
            .catch((err: unknown) => logger.warn('idempotency.expiredDeleteFailed', { scope, err: String(err) }));
        }

        let stored = false;
        const originalJson = res.json.bind(res) as (body: unknown) => Response;
        const wrapped = (body: unknown): Response => {
          const status = res.statusCode;
          if (!stored && status >= 200 && status < 300) {
            stored = true;
            const expiresAt = new Date(now + IDEMPOTENCY_TTL_MS);
            void prisma.idempotencyRecord
              .upsert({
                where: { scope_actorUserId_key: { scope, actorUserId, key } },
                create: { scope, key, actorUserId, requestHash, responseStatus: status, responseBody: body as object, expiresAt },
                update: { requestHash, responseStatus: status, responseBody: body as object, expiresAt },
              })
              .catch((err: unknown) => logger.warn('idempotency.persistFailed', { scope, err: String(err) }));
          }
          return originalJson(body);
        };
        res.json = wrapped as typeof res.json;
        next();
      })
      .catch(next);
  };
}
