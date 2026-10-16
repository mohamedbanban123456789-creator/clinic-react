import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { AuthContext } from '../src/common/middleware/authenticate.js';
import { authenticate, requireFreshPassword } from '../src/common/middleware/authenticate.js';
import { requireRole } from '../src/common/middleware/requireRole.js';
import { AppError } from '../src/common/errors/AppError.js';
import {
  createSecretarySchema,
  resetPasswordSchema,
  userIdParamSchema,
} from '../src/modules/auth-users/users.validators.js';
import { toActivationDto, toManagedUserDto } from '../src/modules/auth-users/users.dto.js';
import { toMeDto } from '../src/modules/auth-users/auth.dto.js';
import { getMe } from '../src/modules/auth-users/auth.profile.js';
import { isSecretSafe } from '../src/common/types/secretSafe.js';
import type { PrismaClient } from '@prisma/client';

function runChain(
  req: Request,
  res: Response,
  fns: Array<(req: Request, res: Response, next: NextFunction) => void>,
): Promise<unknown> {
  return new Promise((resolve) => {
    let i = 0;
    const next: NextFunction = (err?: unknown): void => {
      if (err !== undefined) {
        resolve(err);
        return;
      }
      const fn = fns[i];
      i += 1;
      if (fn === undefined) {
        resolve(undefined);
        return;
      }
      fn(req, res, next);
    };
    next();
  });
}

function mockAuthReq(role: 'DOCTOR' | 'SECRETARY', mustChangePassword: boolean): Request {
  const req = {
    method: 'GET',
    originalUrl: '/api/v1/users',
    path: '/',
    params: { id: 'u-target' },
    body: {},
  } as unknown as Request;
  (req as Request & { auth: AuthContext }).auth = {
    userId: 'u-actor',
    role,
    tokenVersion: 1,
    mustChangePassword,
  };
  return req;
}

function mockRes(): Response {
  return { statusCode: 200 } as Response;
}

/** BE-104 (1): SECRETARY calling /users/* chain receives 403 FORBIDDEN even with mustChangePassword. */
{
  const req = mockAuthReq('SECRETARY', true);
  const err = (await runChain(req, mockRes(), [
    requireRole('DOCTOR'),
    requireFreshPassword,
  ])) as AppError;
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'FORBIDDEN');
  assert.equal(err.statusCode, 403);
}

/** BE-104 (2): DOCTOR with fresh password passes; stale password gets PASSWORD_CHANGE_REQUIRED. */
{
  const fresh = await runChain(mockAuthReq('DOCTOR', false), mockRes(), [
    requireRole('DOCTOR'),
    requireFreshPassword,
  ]);
  assert.equal(fresh, undefined);
  const stale = (await runChain(mockAuthReq('DOCTOR', true), mockRes(), [
    requireRole('DOCTOR'),
    requireFreshPassword,
  ])) as AppError;
  assert.ok(stale instanceof AppError);
  assert.equal(stale.code, 'PASSWORD_CHANGE_REQUIRED');
}

/** BE-104 (3): create-secretary Zod — all fields required non-blank; password min 8; gender defaults to FEMALE or accepts MALE/FEMALE. */
{
  assert.equal(createSecretarySchema.safeParse({ name: 'A', identifier: 's1', password: 'longenough1' }).success, true);
  const parsedDefault = createSecretarySchema.parse({ name: 'A', identifier: 's1', password: 'longenough1' });
  assert.equal(parsedDefault.gender, 'FEMALE');
  const parsedMale = createSecretarySchema.parse({ name: 'أحمد علي', identifier: 'ahmed_sec', password: 'longenough1', gender: 'MALE' });
  assert.equal(parsedMale.gender, 'MALE');
  assert.equal(createSecretarySchema.safeParse({ name: 'سارة محمود أحمد', identifier: 'sara_sec', password: 'longenough1', gender: 'FEMALE' }).success, true, 'Arabic secretary name accepted');
  assert.equal(createSecretarySchema.safeParse({ name: 'A', identifier: 's1', password: 'longenough1', gender: 'OTHER' }).success, false, 'Invalid gender rejected');
  for (const bad of [
    { name: '   ', identifier: 's1', password: 'longenough1' },
    { name: 'A', identifier: '', password: 'longenough1' },
    { name: 'A', identifier: 's1', password: 'short' },
    { name: 'A', identifier: 's1' },
  ]) {
    assert.equal(createSecretarySchema.safeParse(bad).success, false);
  }
  assert.equal(userIdParamSchema.safeParse({ id: 'u1' }).success, true);
  assert.equal(userIdParamSchema.safeParse({ id: '' }).success, false);
  assert.equal(resetPasswordSchema.safeParse({}).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: 'x' }).success, false);
}

/** BE-104 (4): DTOs are allowlisted SecretSafe (no passwordHash/tokenVersion keys). */
{
  const dto = toManagedUserDto({ id: 'u1', name: 'سارة محمود', identifier: 'sec-1', role: 'SECRETARY', gender: 'FEMALE', isActive: true });
  assert.equal(isSecretSafe(dto), true);
  assert.deepEqual({ ...dto }, { id: 'u1', name: 'سارة محمود', identifier: 'sec-1', role: 'SECRETARY', gender: 'FEMALE', isActive: true });
  assert.equal(dto.name, 'سارة محمود', 'Arabic name preserved verbatim');
  assert.equal(dto.gender, 'FEMALE');

  const dtoMale = toManagedUserDto({ id: 'u2', name: 'أحمد علي', identifier: 'sec-2', role: 'SECRETARY', gender: 'MALE', isActive: true });
  assert.equal(dtoMale.gender, 'MALE');

  const act = toActivationDto({ id: 'u1', isActive: false });
  assert.equal(isSecretSafe(act), true);
  assert.deepEqual({ ...act }, { id: 'u1', isActive: false });
}

/** BE-104 (5): authenticate export shape intact for router chain. */
{
  assert.equal(typeof authenticate, 'function');
  assert.equal(typeof requireFreshPassword, 'function');
}

/** 5A: /auth/me is the canonical session-state source — it MUST carry the
 *  password-rotation flag so the gate survives session restoration
 *  (browser reload / cold boot), not just the login envelope. */
{
  // DTO shape: always-present boolean, allowlisted.
  const me = toMeDto({ id: 'u1', name: 'Doc', role: 'DOCTOR', gender: 'MALE', lastLoginAt: new Date('2026-10-01T00:00:00Z'), passwordMustChange: true });
  assert.equal(isSecretSafe(me), true);
  assert.deepEqual({ ...me }, {
    id: 'u1', name: 'Doc', role: 'DOCTOR', gender: 'MALE',
    lastLoginAt: '2026-10-01T00:00:00.000Z',
    passwordMustChange: true,
  });
  const meClear = toMeDto({ id: 'u1', name: 'Doc', role: 'DOCTOR', lastLoginAt: null, passwordMustChange: false });
  assert.equal({ ...meClear }.passwordMustChange, false, 'flag is an explicit boolean, not omitted');
  assert.equal({ ...meClear }.gender, 'FEMALE', 'default gender is FEMALE');

  // getMe reads the flag from the DB and includes it in the response.
  const db = {
    user: {
      findUnique: (args: { where: { id: string } }): Promise<Record<string, unknown> | null> =>
        Promise.resolve(
          args.where.id === 'u1'
            ? { id: 'u1', name: 'Doc', role: 'DOCTOR', lastLoginAt: null, isActive: true, passwordMustChange: true }
            : null,
        ),
    },
  } as unknown as PrismaClient;
  const res = await getMe('u1', db);
  assert.equal({ ...res }.passwordMustChange, true, '/auth/me response carries passwordMustChange');
}

// eslint-disable-next-line no-console
console.log('BE-104 users route-guard checks green.');
