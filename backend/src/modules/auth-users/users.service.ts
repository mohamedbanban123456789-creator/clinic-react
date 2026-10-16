import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { hashPassword } from '../../common/utils/hash.js';
import { revokeUserSessions } from '../../common/realtime.js';
import { toActivationDto, toManagedUserDto } from './users.dto.js';
import type { CreateSecretaryInput } from './users.validators.js';

export interface ActorRef {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

type UserAuditAction = 'USER_CREATE' | 'USER_ACTIVATE' | 'USER_DEACTIVATE' | 'PASSWORD_CHANGE';

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2002';
}

async function writeUserAudit(
  db: PrismaClient,
  row: { actorUserId: string; actorRole: Role; action: UserAuditAction; entityId: string },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: 'User',
        entityId: row.entityId,
        requestId: randomUUID(),
      },
    });
  } catch {
    // Audit must never break user management; BE-701 owns durable delivery.
  }
}

export async function createSecretary(
  input: CreateSecretaryInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toManagedUserDto>> {
  const passwordHash = await hashPassword(input.password);
  try {
    const created = await db.user.create({
      data: {
        name: input.name,
        identifier: input.identifier,
        passwordHash,
        role: 'SECRETARY',
        gender: input.gender,
        isActive: true,
        passwordMustChange: true,
        createdByUserId: actor.userId,
      },
      select: { id: true, name: true, identifier: true, role: true, gender: true, isActive: true },
    });
    await writeUserAudit(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'USER_CREATE',
      entityId: created.id,
    });
    return toManagedUserDto(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'Identifier already exists', [
        { field: 'identifier', issue: 'identifier is already taken', expected: 'unique identifier' },
      ]);
    }
    throw err;
  }
}

export async function listUsers(
  db: PrismaClient = prisma,
): Promise<Array<ReturnType<typeof toManagedUserDto>>> {
  const rows = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, identifier: true, role: true, gender: true, isActive: true },
  });
  return rows.map((row) => toManagedUserDto(row));
}

export async function setUserActive(
  targetId: string,
  isActive: boolean,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toActivationDto>> {
  if (!isActive && targetId === actor.userId) {
    throw new AppError('BAD_REQUEST', 'Cannot deactivate your own account');
  }
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { id: true, isActive: true, role: true },
  });
  if (target === null) throw AppError.notFound('User not found');
  if (target.isActive === isActive) return toActivationDto(target);

  if (!isActive && target.role === 'DOCTOR') {
    const remaining = await db.user.count({
      where: { role: 'DOCTOR', isActive: true, id: { not: targetId } },
    });
    if (remaining === 0) {
      throw new AppError('BAD_REQUEST', 'Cannot deactivate the last active doctor');
    }
  }

  if (!isActive) {
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: targetId },
        data: { isActive: false, tokenVersion: { increment: 1 } },
        select: { id: true, isActive: true },
      });
      await tx.refreshTokenFamily.updateMany({
        where: { userId: targetId, isRevoked: false },
        data: { isRevoked: true },
      });
      return row;
    });
    revokeUserSessions(targetId);
    await writeUserAudit(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'USER_DEACTIVATE',
      entityId: targetId,
    });
    return toActivationDto(updated);
  }

  const reactivated = await db.user.update({
    where: { id: targetId },
    data: { isActive: true },
    select: { id: true, isActive: true },
  });
  await writeUserAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'USER_ACTIVATE',
    entityId: targetId,
  });
  return toActivationDto(reactivated);
}

export async function resetUserPassword(
  targetId: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<{ temporaryPassword: string }> {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { id: true },
  });
  if (target === null) throw AppError.notFound('User not found');

  const temporaryPassword = `${randomBytes(12).toString('base64url')}!1Aa`;
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetId },
      data: {
        passwordHash,
        passwordMustChange: true,
        tokenVersion: { increment: 1 },
        lastPasswordChangeAt: new Date(),
      },
    });
    await tx.refreshTokenFamily.updateMany({
      where: { userId: targetId, isRevoked: false },
      data: { isRevoked: true },
    });
  });
  revokeUserSessions(targetId);
  await writeUserAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'PASSWORD_CHANGE',
    entityId: targetId,
  });
  return { temporaryPassword };
}
