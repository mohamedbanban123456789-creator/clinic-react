import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { isSecretSafe } from '../types/secretSafe.js';
import { logger } from '../utils/logger.js';

/**
 * BE-103 allowlist-first guard (CONV-02). NOT a denylist stripper: C-4 bans
 * `delete obj.soap` stripping. SECRETARY 2xx JSON must already be SecretSafe;
 * otherwise fail closed with 500 + correlation id (never leak, never strip-send).
 * Mount globally in app.ts; role read lazily at res.json time (after authenticate).
 */
export const SECRETARY_DENYLIST_EXACT: readonly string[] = [
  'content', 'drugname', 'dosage', 'frequency', 'instructions',
  'cessationreason', 'addendumtext', 'signedencounterid', 'scribedraftid',
  'origin', 'transcript', 'transcriptreference', 'audioreference',
  'audioref', 'ciphertext', 'wrappeddek', 'nonce', 'diagnoses',
  'prescriptions', 'medications', 'psychotherapynotes', 'assessment',
  'clinicalsummary', 'failurereason',
];

export const SECRETARY_DENYLIST_PREFIXES: readonly string[] = [
  'soap', 'mse', 'therapynote', 'vault', 'scribedraft', 'consent',
];

function isForbiddenKey(lowerKey: string): boolean {
  if ((SECRETARY_DENYLIST_EXACT as readonly string[]).includes(lowerKey)) return true;
  for (const prefix of SECRETARY_DENYLIST_PREFIXES) {
    if (lowerKey.startsWith(prefix)) return true;
  }
  return false;
}

export interface ForbiddenScan {
  readonly forbidden: boolean;
  readonly hits: readonly string[];
}

/** Deep cycle-safe scan; reports key names only (never values). */
export function scanForbiddenKeys(payload: unknown): ForbiddenScan {
  const hits: string[] = [];
  const seen = new WeakSet<object>();
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== 'object' || current === null) continue;
    const obj = current as object;
    if (seen.has(obj)) continue;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) stack.push(item);
      continue;
    }
    for (const key of Object.keys(obj)) {
      if (isForbiddenKey(key.toLowerCase()) && !hits.includes(key)) hits.push(key);
      stack.push((obj as Record<string, unknown>)[key]);
    }
  }
  return { forbidden: hits.length > 0, hits };
}

function isAuthSafeEnvelope(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).sort();
  if (keys.length === 2 && keys[0] === 'accessToken' && keys[1] === 'user') {
    return isSecretSafe(body['user']);
  }
  if (keys.length === 3 && keys[0] === 'accessToken' && keys[1] === 'mustChangePassword' && keys[2] === 'user') {
    return (
      typeof body['accessToken'] === 'string' &&
      typeof body['mustChangePassword'] === 'boolean' &&
      isSecretSafe(body['user'])
    );
  }
  if (keys.length === 1 && keys[0] === 'accessToken') {
    return typeof body['accessToken'] === 'string';
  }
  if (keys.length === 1 && keys[0] === 'ok') {
    return body['ok'] === true;
  }
  return false;
}

function isDataWrapper(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'data') return false;
  const data = body['data'];
  if (isSecretSafe(data)) return true;
  if (Array.isArray(data)) {
    if (data.length === 0) return true;
    return data.every((item) => isSecretSafe(item));
  }
  return false;
}

function failClosed(
  res: Response,
  originalJson: (body: unknown) => Response,
  req: Request,
  reason: string,
  hits: readonly string[],
): Response {
  const correlationId = randomUUID();
  logger.error('secretary.sanitize.blocked', {
    correlationId,
    method: req.method,
    path: req.originalUrl ?? req.path,
    role: req.auth?.role ?? 'unknown',
    reason,
    keys: hits.slice(0, 12),
  });
  return originalJson({
    error: { code: 'INTERNAL', message: `Internal server error (requestId=${correlationId})`, details: [] },
  });
}

/** Global interceptor; enforcement deferred to send time (after authenticate). */
export function sanitizeSecretaryResponses(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res) as (body: unknown) => Response;
  const wrapped = (body: unknown): Response => {
    if (req.auth?.role !== 'SECRETARY') return originalJson(body);
    if (res.statusCode >= 400) return originalJson(body);
    if (typeof body !== 'object' || body === null) {
      return failClosed(res, originalJson, req, 'non-object-secretary-payload', []);
    }
    const record = body as Record<string, unknown>;
    if ('error' in record) return originalJson(body);
    const scan = scanForbiddenKeys(body);
    if (scan.forbidden) return failClosed(res, originalJson, req, 'denylist-hit', scan.hits);
    if (isSecretSafe(body)) return originalJson(body);
    if (isAuthSafeEnvelope(record) || isDataWrapper(record)) return originalJson(body);
    return failClosed(res, originalJson, req, 'unbranded-secretary-payload', []);
  };
  res.json = wrapped as typeof res.json;
  next();
}

