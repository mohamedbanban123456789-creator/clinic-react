import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { verifyAccessToken, type AccessClaims } from '../utils/jwt.js';
import { prisma } from '../prisma.js';

export interface AuthContext {
  userId: string;
  role: 'DOCTOR' | 'SECRETARY';
  tokenVersion: number;
  mustChangePassword: boolean;
}

export type AuthedRequest = Request & { auth?: AuthContext };

function readAuth(req: Request): AuthContext | undefined {
  return req.auth;
}

/**
 * BE-102 authenticate: verifies access JWT {sub, role, tv}, rejects
 * deactivated users (403) and stale token versions (401).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(AppError.unauthorized());
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    next(AppError.unauthorized());
    return;
  }
  let claims: AccessClaims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    next(AppError.unauthorized());
    return;
  }
  prisma.user
    .findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, isActive: true, tokenVersion: true, passwordMustChange: true },
    })
    .then((user) => {
      if (user === null) {
        next(AppError.unauthorized());
        return;
      }
      if (!user.isActive) {
        // Stable machine-readable deactivation signal (403): business 403s
        // (FLOOR_VIOLATION, FORBIDDEN role denial) must never be confusable
        // with the fail-closed session-teardown signal on the wire.
        next(new AppError('ACCOUNT_DEACTIVATED', 'Account is deactivated'));
        return;
      }
      if (user.role !== claims.role || user.tokenVersion !== claims.tv) {
        next(AppError.unauthorized('Session revoked, sign in again'));
        return;
      }
      req.auth = {
        userId: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
        mustChangePassword: user.passwordMustChange,
      };
      next();
    })
    .catch(next);
}

/**
 * BE-102 passwordMustChange gate: users flagged for rotation may only call
 * /api/v1/auth/* until they complete change-password (403 otherwise).
 */
export function requireFreshPassword(req: Request, _res: Response, next: NextFunction): void {
  const auth = readAuth(req);
  // NOTE (BE-104): check originalUrl, not req.path — Express strips the mount
  // prefix (e.g. /api/v1/settings) from req.path inside mounted routers, so a
  // req.path check would mis-gate every mounted route.
  const fullPath: string = req.originalUrl.split('?')[0] ?? req.originalUrl;
  if (auth !== undefined && auth.mustChangePassword && !fullPath.startsWith('/api/v1/auth')) {
    next(
      new AppError('PASSWORD_CHANGE_REQUIRED', 'Password change required before continuing', [
        { field: 'password', issue: 'passwordMustChange is true', expected: 'POST /api/v1/auth/change-password' },
      ]),
    );
    return;
  }
  next();
}

export function requireAuth(req: Request): AuthContext {
  const auth = readAuth(req);
  if (auth === undefined) throw AppError.unauthorized();
  return auth;
}

