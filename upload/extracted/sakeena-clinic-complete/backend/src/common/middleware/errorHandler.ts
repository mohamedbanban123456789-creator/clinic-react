import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

interface FailureEnvelope {
  error: {
    code: string;
    message: string;
    details: readonly { field?: string; issue: string; expected?: string }[];
  };
}

/** body-parser / raw-body errors carry a `type` + `status`/`statusCode` + `expose`. */
interface BodyParserLikeError {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly expose?: unknown;
}

/** Prisma known-request errors expose a `Pxxxx` code (e.g. P2002 unique, P2025 not found). */
interface PrismaLikeError {
  readonly code?: unknown;
}

function isBodyParserError(err: unknown): err is BodyParserLikeError {
  if (typeof err !== 'object' || err === null) return false;
  const t = (err as BodyParserLikeError).type;
  return typeof t === 'string' && t.startsWith('entity.');
}

function prismaCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as PrismaLikeError).code;
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) return code;
  return null;
}

/**
 * Global error boundary — last middleware in src/app.ts.
 * Success payloads never contain `error`; failures always match the envelope.
 *
 * Observability contract: EVERY non-AppError (i.e. every genuine 500) is logged
 * server-side with the same requestId that is returned to the client, so a
 * production 500 is debuggable from logs. Body-parser and Prisma errors are
 * translated to their correct HTTP status instead of surfacing as a bare 500.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  if (err instanceof AppError) {
    const body: FailureEnvelope = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  const requestId = randomUUID();

  // Malformed JSON / oversized bodies from express.json() are CLIENT faults, not
  // server 500s: body-parser already computed the right status + expose flag.
  if (isBodyParserError(err)) {
    const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 400;
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_JSON';
    const message = status === 413 ? 'Request body too large' : 'Malformed JSON body';
    logger.warn('http.body_parse_error', { requestId, status, type: String(err.type) });
    res.status(status).json({ error: { code, message, details: [] } } satisfies FailureEnvelope);
    return;
  }

  // Unmapped Prisma errors -> correct HTTP status (never a bare 500).
  const pCode = prismaCode(err);
  if (pCode === 'P2002') {
    logger.warn('http.prisma_unique_violation', { requestId, code: pCode });
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Conflicting record', details: [] } } satisfies FailureEnvelope);
    return;
  }
  if (pCode === 'P2025') {
    logger.warn('http.prisma_not_found', { requestId, code: pCode });
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found', details: [] } } satisfies FailureEnvelope);
    return;
  }
  if (pCode !== null) {
    logger.error('http.prisma_error', { requestId, code: pCode, err: String(err) });
    res.status(500).json({ error: { code: 'INTERNAL', message: `Internal server error (requestId=${requestId})`, details: [] } } satisfies FailureEnvelope);
    return;
  }

  // Genuine unexpected 500: log with the SAME requestId returned to the client.
  logger.error('http.unhandled_error', {
    requestId,
    err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  const body: FailureEnvelope = {
    error: {
      code: 'INTERNAL',
      message: `Internal server error (requestId=${requestId})`,
      details: [],
    },
  };
  res.status(500).json(body);
}
