import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../errors/AppError.js';

/**
 * BE-103 RBAC gate (Invariant W5 + CONV-02).
 *
 * MUST be mounted as `authenticate` -> `requireRole(...)` -> validate -> handler.
 * Role verification executes BEFORE any resource lookup or service execution.
 * On mismatch the request fails immediately with a generic 403 envelope so
 * unauthorized callers cannot probe whether clinical IDs exist (no existence oracle).
 *
 * Failure envelope (via global errorHandler):
 * `{ "error": { "code": "FORBIDDEN", "message": "Access denied for role", "details": [] } }`
 */
export function requireRole(
  ...allowedRoles: readonly Role[]
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (role === undefined) {
      next(AppError.unauthorized());
      return;
    }
    if (!allowedRoles.includes(role)) {
      next(new AppError('FORBIDDEN', 'Access denied for role', []));
      return;
    }
    next();
  };
}
