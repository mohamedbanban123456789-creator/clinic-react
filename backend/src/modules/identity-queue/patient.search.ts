import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { logger } from '../../common/utils/logger.js';
import { toSecretPatientSearchDto } from './patient.dto.js';
import { normalizeDigits, normalizeName, sha256Hex } from './patient.normalize.js';
import { checkPatientSearchRateLimit, writePatientAudit, type ActorRef } from './patient.support.js';

export async function searchPatients(
  rawQuery: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<Array<ReturnType<typeof toSecretPatientSearchDto>>> {
  checkPatientSearchRateLimit(actor.userId);
  const q = rawQuery.trim();
  const normName = normalizeName(q);
  const normDigits = normalizeDigits(q);
  const orFilters: Array<Record<string, unknown>> = [];
  if (normDigits !== null && normDigits.length >= 3) {
    orFilters.push({ nationalIdNorm: { contains: normDigits } });
    orFilters.push({ phoneNorm: { contains: normDigits } });
    orFilters.push({ guardianPhoneNorm: { contains: normDigits } });
  }
  if (normName.length >= 3) {
    const tokens = normName.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 1) {
      orFilters.push({
        OR: [
          { fullNameNorm: { contains: tokens[0] } },
          { fullName: { contains: tokens[0], mode: 'insensitive' as const } },
        ],
      });
    } else if (tokens.length > 1) {
      orFilters.push({
        AND: tokens.map((token) => ({
          OR: [
            { fullNameNorm: { contains: token } },
            { fullName: { contains: token, mode: 'insensitive' as const } },
          ],
        })),
      });
    }
  }
  const rows =
    orFilters.length === 0
      ? []
      : await db.patient.findMany({
          where: { AND: [{ duplicateOfPatientId: null }, { OR: orFilters as never }] },
          orderBy: [{ lastVisitAt: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          select: {
            id: true,
            fullName: true,
            dateOfBirth: true,
            phone: true,
            phoneNorm: true,
            nationalIdNorm: true,
            outstandingBalanceMinor: true,
            lastVisitAt: true,
            registrationStatus: true,
          },
        });
  const queryHash = sha256Hex(`${normName}|${normDigits ?? ''}`);
  logger.info('patient.search', { actorUserId: actor.userId, queryHash, count: rows.length });
  await writePatientAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'PATIENT_SEARCH',
    entityId: actor.userId,
    queryHash,
    resultCount: rows.length,
  });
  return rows.map((row) => toSecretPatientSearchDto(row));
}
