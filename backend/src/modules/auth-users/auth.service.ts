import { randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { LOGIN_MAX_FAILED, LOGIN_RETRY_AFTER_MIN, LOGIN_WINDOW_MINUTES } from '../../config/auth.js';
import { verifyPassword } from '../../common/utils/hash.js';
import {
  hashRefreshToken,
  newRefreshIdentity,
  refreshExpiryDate,
  signAccessToken,
  signRefreshToken,
} from '../../common/utils/jwt.js';
import { toAuthUserDto } from './auth.dto.js';
import type { LoginInput } from './auth.validators.js';

interface FailedBucket {
  count: number;
  firstAtMs: number;
}

/** In-memory brute-force buckets keyed by normalized identifier (BE-102; BE-701 hardens audit). */
const failedLogins = new Map<string, FailedBucket>();

export function resetLoginThrottleForTest(): void {
  failedLogins.clear();
}

function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

function lockoutError(): AppError {
  return new AppError('TOO_MANY_ATTEMPTS', 'Too many login attempts, try again later', [
    { field: 'identifier', issue: 'Too many failed attempts', expected: `retryAfterMin:${LOGIN_RETRY_AFTER_MIN}` },
  ]);
}

function checkLockout(identifier: string): void {
  const bucket = failedLogins.get(normalizeIdentifier(identifier));
  if (bucket === undefined) return;
  if (Date.now() - bucket.firstAtMs > LOGIN_WINDOW_MINUTES * 60_000) {
    failedLogins.delete(normalizeIdentifier(identifier));
    return;
  }
  if (bucket.count >= LOGIN_MAX_FAILED) throw lockoutError();
}

function recordFailure(identifier: string): FailedBucket {
  const key = normalizeIdentifier(identifier);
  const now = Date.now();
  const prev = failedLogins.get(key);
  if (prev === undefined || now - prev.firstAtMs > LOGIN_WINDOW_MINUTES * 60_000) {
    const fresh: FailedBucket = { count: 1, firstAtMs: now };
    failedLogins.set(key, fresh);
    return fresh;
  }
  const next: FailedBucket = { count: prev.count + 1, firstAtMs: prev.firstAtMs };
  failedLogins.set(key, next);
  return next;
}

function clearFailures(identifier: string): void {
  failedLogins.delete(normalizeIdentifier(identifier));
}

export async function writeAuthAudit(
  db: PrismaClient,
  row: {
    actorUserId: string;
    actorRole: Role;
    action: 'LOGIN' | 'LOGIN_LOCKOUT' | 'REFRESH' | 'LOGOUT' | 'PASSWORD_CHANGE';
  },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: 'User',
        entityId: row.actorUserId,
        requestId: randomUUID(),
      },
    });
  } catch {
    // Audit must never break auth; BE-701 owns durable delivery.
  }
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  readonly user: { id: string; name: string; role: 'DOCTOR' | 'SECRETARY'; gender: 'MALE' | 'FEMALE' };
  readonly mustChangePassword: boolean;
}

export async function login(input: LoginInput, db: PrismaClient = prisma): Promise<LoginResult> {
  checkLockout(input.identifier);
  const user = await db.user.findUnique({ where: { identifier: input.identifier.trim() } });
  const ok = user !== null && (await verifyPassword(user.passwordHash, input.password));
  if (!ok) {
    const bucket = recordFailure(input.identifier);
    if (bucket.count >= LOGIN_MAX_FAILED) {
      if (user !== null) {
        await writeAuthAudit(db, { actorUserId: user.id, actorRole: user.role, action: 'LOGIN_LOCKOUT' });
      }
      throw lockoutError();
    }
    // Do NOT reveal account existence/deactivation before the password verifies:
    // returning 403 'deactivated' here (vs 401 elsewhere) is an enumeration
    // oracle. Deactivation is surfaced only AFTER a correct password (below).
    throw new AppError('UNAUTHORIZED', 'Invalid credentials');
  }
  if (!user.isActive) throw new AppError('FORBIDDEN', 'Account is deactivated');
  clearFailures(input.identifier);

  const env = loadEnv();
  const ids = newRefreshIdentity();
  const refreshToken = signRefreshToken({ sub: user.id, tv: user.tokenVersion, familyId: ids.familyId, jti: ids.tokenId });
  const expiresAt = refreshExpiryDate(env.JWT_REFRESH_TTL);
  await db.refreshTokenFamily.create({
    data: { familyId: ids.familyId, tokenId: ids.tokenId, userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt },
  });
  const updated = await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: { id: true, name: true, role: true, gender: true, passwordMustChange: true, lastLoginAt: true },
  });
  await writeAuthAudit(db, { actorUserId: user.id, actorRole: user.role, action: 'LOGIN' });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion }),
    refreshToken,
    refreshExpiresAt: expiresAt,
    user: toAuthUserDto(updated) as unknown as LoginResult['user'],
    mustChangePassword: updated.passwordMustChange,
  };
}
