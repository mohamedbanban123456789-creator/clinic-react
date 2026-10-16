import { loadEnv } from './env.js';

/**
 * BE-102 auth tunables (RPS-2 §auth).
 * Access ~15m, refresh ~7d, refresh cookie HttpOnly/Secure/Lax on /api/v1/auth.
 */
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const LOGIN_MAX_FAILED = 5;
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_RETRY_AFTER_MIN = 15;

export function getRefreshReuseGraceSeconds(): number {
  return loadEnv().REFRESH_REUSE_GRACE_SECONDS;
}

export function isCookieSecure(): boolean {
  return loadEnv().COOKIE_SECURE;
}
