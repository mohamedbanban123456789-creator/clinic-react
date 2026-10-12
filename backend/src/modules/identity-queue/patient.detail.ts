import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { toSecretPatientDetailDto } from './patient.dto.js';
import type { ActorRef } from './patient.support.js';

export async function getPatientById(
  patientId: string,
  _actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretPatientDetailDto>> {
  const row = await db.patient.findUnique({ where: { id: patientId } });
  if (row === null) throw AppError.notFound('Patient not found');
  const visits = await db.queueEntry.findMany({
    where: { patientId },
    select: { checkedInAt: true },
    orderBy: { checkedInAt: 'asc' },
  });
  return toSecretPatientDetailDto(
    row,
    visits.map((v) => v.checkedInAt.toISOString()),
  );
}
