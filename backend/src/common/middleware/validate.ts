import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';

type Source = 'body' | 'query' | 'params';

/**
 * Zod request validator (CONV: Zod sole validation).
 * Failure -> 422 envelope, never 500.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  source: Source = 'body',
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      next(AppError.fromZod(parsed.error.issues));
      return;
    }
    req[source] = parsed.data as unknown as Record<string, unknown>;
    next();
  };
}

const UUID_V4 = z.string().uuid();

/**
 * Idempotency-Key guard (CONV-03 / API-01 scaffolding).
 * Cash/queue-complimentary routes require it from BE-202 onward.
 * Missing key -> 422 IDEMPOTENCY_KEY_REQUIRED.
 */
export function requireIdempotencyKey(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header('Idempotency-Key');
  const parsed = UUID_V4.safeParse(raw);
  if (!parsed.success) {
    next(new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid v4) is required'));
    return;
  }
  next();
}
