import type { PrismaClient, RegistrationStatus } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { toSecretPatientDto } from './patient.dto.js';
import { normalizeDigits } from './patient.normalize.js';
import type { PatchPatientInput } from './patient.validators.js';
import { toDisplayOrNull, writePatientAudit, type ActorRef } from './patient.support.js';

export async function patchPatient(
  patientId: string,
  input: PatchPatientInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretPatientDto>> {
  const row = await db.patient.findUnique({ where: { id: patientId } });
  if (row === null) throw AppError.notFound('Patient not found');
  const nextName = input.emergencyContactName !== undefined ? toDisplayOrNull(input.emergencyContactName) : row.emergencyContactName;
  const nextPhone = input.emergencyContactPhone !== undefined ? toDisplayOrNull(input.emergencyContactPhone) : row.emergencyContactPhone;
  const nextRel =
    input.emergencyContactRelation !== undefined ? toDisplayOrNull(input.emergencyContactRelation) : row.emergencyContactRelation;
  const nextAddr = input.physicalAddress !== undefined ? toDisplayOrNull(input.physicalAddress) : row.physicalAddress;
  let registrationStatus: RegistrationStatus = row.registrationStatus;
  if (
    row.registrationStatus === 'INCOMPLETE' &&
    nextName !== null &&
    nextPhone !== null &&
    nextRel !== null &&
    nextAddr !== null
  ) {
    registrationStatus = 'COMPLETE';
  }
  const updated = await db.patient.update({
    where: { id: patientId },
    data: {
      ...(input.phone !== undefined ? { phone: toDisplayOrNull(input.phone), phoneNorm: normalizeDigits(input.phone) } : {}),
      ...(input.guardianPhone !== undefined
        ? { guardianPhone: toDisplayOrNull(input.guardianPhone), guardianPhoneNorm: normalizeDigits(input.guardianPhone) }
        : {}),
      ...(input.emergencyContactName !== undefined ? { emergencyContactName: nextName } : {}),
      ...(input.emergencyContactPhone !== undefined ? { emergencyContactPhone: nextPhone } : {}),
      ...(input.emergencyContactRelation !== undefined ? { emergencyContactRelation: nextRel } : {}),
      ...(input.physicalAddress !== undefined ? { physicalAddress: nextAddr } : {}),
      ...(input.adminNotes !== undefined ? { adminNotes: toDisplayOrNull(input.adminNotes) } : {}),
      registrationStatus,
    },
  });
  await writePatientAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'PATIENT_UPDATE',
    entityId: patientId,
  });
  return toSecretPatientDto(updated);
}

export async function flagPatientDuplicate(
  patientId: string,
  canonicalPatientId: string,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretPatientDto>> {
  if (patientId === canonicalPatientId) {
    throw new AppError('UNPROCESSABLE', 'A patient cannot be a duplicate of itself', [
      { field: 'canonicalPatientId', issue: 'self-reference', expected: 'different patient id' },
    ]);
  }
  const [target, canonical] = await Promise.all([
    db.patient.findUnique({ where: { id: patientId }, select: { id: true } }),
    db.patient.findUnique({ where: { id: canonicalPatientId }, select: { id: true, duplicateOfPatientId: true } }),
  ]);
  if (target === null) throw AppError.notFound('Patient not found');
  if (canonical === null) throw AppError.notFound('Canonical patient not found');
  if (canonical.duplicateOfPatientId !== null) {
    throw new AppError('UNPROCESSABLE', 'Canonical patient is itself flagged as a duplicate', [
      { field: 'canonicalPatientId', issue: 'canonical is a duplicate', expected: 'canonical root patient' },
    ]);
  }
  const updated = await db.patient.update({
    where: { id: patientId },
    data: { duplicateOfPatientId: canonicalPatientId },
  });
  await writePatientAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'PATIENT_FLAGGED_DUPLICATE',
    entityId: patientId,
    reasonText: `canonical:${canonicalPatientId}`,
  });
  return toSecretPatientDto(updated);
}
