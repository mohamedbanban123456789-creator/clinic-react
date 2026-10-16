import { createHash, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { loadEnv } from '../../config/env.js';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from '../../config/auth.js';

const AccessPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['DOCTOR', 'SECRETARY']),
  tv: z.number().int().nonnegative(),
});

const RefreshPayloadSchema = z.object({
  sub: z.string().min(1),
  tv: z.number().int().nonnegative(),
  familyId: z.string().min(1),
  jti: z.string().min(1),
});

export interface AccessClaims {
  readonly sub: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
  readonly tv: number;
}

export interface RefreshClaims {
  readonly sub: string;
  readonly tv: number;
  readonly familyId: string;
  readonly jti: string;
}

export function signAccessToken(claims: AccessClaims): string {
  const env = loadEnv();
  const expiresIn = (env.JWT_ACCESS_TTL || ACCESS_TOKEN_TTL) as unknown as SignOptions['expiresIn'];
  const opts: SignOptions = { ...(expiresIn === undefined ? {} : { expiresIn }) };
  return jwt.sign({ sub: claims.sub, role: claims.role, tv: claims.tv }, env.JWT_SECRET, opts);
}

/** Decode + validate an access JWT, surfacing the numeric `exp` for the WS gateway. */
export function verifyAccessTokenDetailed(token: string): { claims: AccessClaims; exp: number | null } {
  const env = loadEnv();
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  const claims = AccessPayloadSchema.parse({
    sub: decoded.sub,
    role: decoded.role,
    tv: (decoded as { tv?: unknown }).tv,
  });
  const exp = typeof decoded.exp === 'number' ? decoded.exp : null;
  return { claims, exp };
}

export function verifyAccessToken(token: string): AccessClaims {
  return verifyAccessTokenDetailed(token).claims;
}

export function newRefreshIdentity(): { familyId: string; tokenId: string } {
  return { familyId: randomUUID(), tokenId: randomUUID() };
}

export function newRotatedTokenId(): string {
  return randomUUID();
}

export function signRefreshToken(claims: RefreshClaims): string {
  const env = loadEnv();
  const expiresIn = (env.JWT_REFRESH_TTL || REFRESH_TOKEN_TTL) as unknown as SignOptions['expiresIn'];
  const opts: SignOptions = { jwtid: claims.jti, ...(expiresIn === undefined ? {} : { expiresIn }) };
  return jwt.sign({ sub: claims.sub, tv: claims.tv, familyId: claims.familyId }, env.JWT_REFRESH_SECRET, opts);
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const env = loadEnv();
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
  const raw = decoded as { tv?: unknown; familyId?: unknown };
  return RefreshPayloadSchema.parse({
    sub: decoded.sub,
    tv: raw.tv,
    familyId: raw.familyId,
    jti: decoded.jti,
  });
}

/** sha256 hex of the raw refresh JWT — only the hash is persisted (RefreshTokenFamily.tokenHash). */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Parses '15m' | '7d' | '30s' style TTLs into an absolute expiry Date. Falls back to 7d. */
export function refreshExpiryDate(ttl: string = REFRESH_TOKEN_TTL): Date {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  const now = Date.now();
  if (m === null) return new Date(now + 7 * 24 * 3600 * 1000);
  const amountText: string | undefined = m[1];
  const unitText: string | undefined = m[2];
  if (amountText === undefined || unitText === undefined) return new Date(now + 7 * 24 * 3600 * 1000);
  const amount = Number(amountText);
  const unit = unitText as 's' | 'm' | 'h' | 'd';
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return new Date(now + amount * mult);
}
