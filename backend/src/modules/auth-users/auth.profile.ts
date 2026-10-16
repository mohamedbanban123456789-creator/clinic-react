import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { hashPassword, verifyPassword } from '../../common/utils/hash.js';
import { toMeDto } from './auth.dto.js';
import { revokeUserSessions } from '../../common/realtime.js';
import type { ChangePasswordInput, UpdateMeInput } from './auth.validators.js';
import { writeAuthAudit } from './auth.service.js';

export async function getMe(userId: string, db: PrismaClient = prisma): Promise<ReturnType<typeof toMeDto>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    // passwordMustChange is part of the canonical /auth/me contract so the
    // rotation gate survives session restoration (reload/cold boot); the
    // server-side requireFreshPassword enforcement is unaffected either way.
    select: { id: true, name: true, role: true, gender: true, lastLoginAt: true, isActive: true, passwordMustChange: true },
  });
  if (user === null || !user.isActive) throw AppError.unauthorized('Invalid credentials');
  return toMeDto(user);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  db: PrismaClient = prisma,
): Promise<{ ok: true }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (user === null || !user.isActive) throw AppError.unauthorized('Invalid credentials');
  const ok = await verifyPassword(user.passwordHash, input.oldPassword);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Current password is incorrect');
  if (input.oldPassword === input.newPassword) {
    throw new AppError('BAD_REQUEST', 'New password must differ from the current password');
  }
  const nextHash = await hashPassword(input.newPassword);
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: nextHash,
        tokenVersion: { increment: 1 },
        passwordMustChange: false,
        lastPasswordChangeAt: new Date(),
      },
    }),
    db.refreshTokenFamily.updateMany({ where: { userId: user.id, isRevoked: false }, data: { isRevoked: true } }),
  ]);
  await writeAuthAudit(db, { actorUserId: user.id, actorRole: user.role, action: 'PASSWORD_CHANGE' });
  // BE-401: tokenVersion bumped above invalidates the JWT; force any live WS
  // sockets for this user offline immediately (emit session.revoked + disconnect).
  revokeUserSessions(user.id);
  return { ok: true as const };
}

export async function updateMe(
  userId: string,
  input: UpdateMeInput,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toMeDto>> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (user === null || !user.isActive) throw AppError.unauthorized('Invalid credentials');
  const updated = await db.user.update({
    where: { id: userId },
    data: { name: input.name },
    select: { id: true, name: true, role: true, gender: true, lastLoginAt: true, isActive: true, passwordMustChange: true },
  });
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'USER_UPDATE',
        entityType: 'User',
        entityId: user.id,
        requestId: randomUUID(),
      },
    });
  } catch {
    // Audit must never break user profile update; BE-701 owns durable delivery.
  }
  return toMeDto(updated);
}
