import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { getRefreshReuseGraceSeconds } from '../../config/auth.js';
import {
  hashRefreshToken,
  newRotatedTokenId,
  refreshExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshClaims,
} from '../../common/utils/jwt.js';
import { writeAuthAudit } from './auth.service.js';

export interface RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

async function revokeFamily(db: PrismaClient, familyId: string): Promise<void> {
  await db.refreshTokenFamily.updateMany({
    where: { familyId },
    data: { isRevoked: true, reuseDetected: true },
  });
}

/**
 * Refresh rotation with reuse detection (RPS-2):
 * valid current token -> rotate; recently-rotated token within grace -> replay;
 * otherwise revoke the whole family + 401.
 */
export async function refresh(rawToken: string | undefined, db: PrismaClient = prisma): Promise<RefreshResult> {
  if (rawToken === undefined || rawToken.length === 0) throw AppError.unauthorized('Missing refresh token');
  let claims: RefreshClaims;
  try {
    claims = verifyRefreshToken(rawToken);
  } catch {
    throw AppError.unauthorized('Invalid refresh token');
  }
  const row = await db.refreshTokenFamily.findUnique({ where: { tokenId: claims.jti } });
  if (row === null || row.familyId !== claims.familyId || row.userId !== claims.sub) {
    throw AppError.unauthorized('Invalid refresh token');
  }
  const user = await db.user.findUnique({
    where: { id: row.userId },
    select: { id: true, role: true, isActive: true, tokenVersion: true },
  });
  if (user === null || !user.isActive) throw AppError.unauthorized('Invalid refresh token');
  if (claims.tv !== user.tokenVersion || row.tokenHash !== hashRefreshToken(rawToken)) {
    await revokeFamily(db, row.familyId);
    throw AppError.unauthorized('Refresh token reuse detected');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.refreshTokenFamily.update({ where: { id: row.id }, data: { isRevoked: true } });
    throw AppError.unauthorized('Refresh token expired');
  }
  if (row.isRevoked) {
    const successor = await db.refreshTokenFamily.findFirst({
      where: { familyId: row.familyId, rotatedFromId: row.id, isRevoked: false },
      orderBy: { issuedAt: 'desc' },
    });
    if (successor !== null && successor.expiresAt.getTime() > Date.now()) {
      const ageMs = Date.now() - successor.issuedAt.getTime();
      if (ageMs <= getRefreshReuseGraceSeconds() * 1000) {
        return {
          accessToken: signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion }),
          refreshToken: rawToken,
          refreshExpiresAt: successor.expiresAt,
        };
      }
    }
    await revokeFamily(db, row.familyId);
    throw AppError.unauthorized('Refresh token reuse detected');
  }

  const env = loadEnv();
  const nextTokenId = newRotatedTokenId();
  const nextToken = signRefreshToken({ sub: user.id, tv: user.tokenVersion, familyId: row.familyId, jti: nextTokenId });
  const expiresAt = refreshExpiryDate(env.JWT_REFRESH_TTL);
  await db.refreshTokenFamily.update({ where: { id: row.id }, data: { isRevoked: true } });
  await db.refreshTokenFamily.create({
    data: {
      familyId: row.familyId,
      tokenId: nextTokenId,
      userId: user.id,
      tokenHash: hashRefreshToken(nextToken),
      expiresAt,
      rotatedFromId: row.id,
    },
  });
  await writeAuthAudit(db, { actorUserId: user.id, actorRole: user.role, action: 'REFRESH' });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion }),
    refreshToken: nextToken,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(rawToken: string | undefined, db: PrismaClient = prisma): Promise<{ ok: true }> {
  if (rawToken !== undefined && rawToken.length > 0) {
    try {
      const claims = verifyRefreshToken(rawToken);
      await db.refreshTokenFamily.updateMany({
        where: { familyId: claims.familyId, userId: claims.sub },
        data: { isRevoked: true },
      });
      const user = await db.user.findUnique({ where: { id: claims.sub }, select: { id: true, role: true } });
      if (user !== null) await writeAuthAudit(db, { actorUserId: user.id, actorRole: user.role, action: 'LOGOUT' });
    } catch {
      // Invalid cookie still clears client-side; never leak which half failed.
    }
  }
  return { ok: true as const };
}
