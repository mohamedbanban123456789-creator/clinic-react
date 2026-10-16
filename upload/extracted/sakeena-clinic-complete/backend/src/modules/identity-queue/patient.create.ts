import type { PrismaClient, RegistrationStatus } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { toSecretPatientDto } from './patient.dto.js';
import { normalizeDigits, normalizeName } from './patient.normalize.js';
import type { CreatePatientInput } from './patient.validators.js';
import { isUniqueViolation, toDisplayOrNull, writePatientAudit, type ActorRef } from './patient.support.js';

export type { ActorRef };

export async function createPatient(
  input: CreatePatientInput,
  actor: ActorRef,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toSecretPatientDto>> {
  const fullNameNorm = normalizeName(input.fullName);
  const phoneNorm = normalizeDigits(input.phone);
  const nationalIdNorm = normalizeDigits(input.nationalId);
  const guardianPhoneNorm = normalizeDigits(input.guardianPhone);
  const emergencyPhoneNorm = normalizeDigits(input.emergencyContactPhone);
  const crisis = input.crisis === true;
  const anchor = nationalIdNorm ?? phoneNorm ?? guardianPhoneNorm ?? emergencyPhoneNorm;
  if (anchor === null) {
    throw new AppError('UNPROCESSABLE', 'At least one identity anchor is required', [
      { field: 'nationalId', issue: 'one of nationalId, phone, or guardian phone is required', expected: 'identity anchor' },
    ]);
  }
  const emergencyName = toDisplayOrNull(input.emergencyContactName);
  const emergencyPhone = toDisplayOrNull(input.emergencyContactPhone);
  const emergencyRelation = toDisplayOrNull(input.emergencyContactRelation);
  const physicalAddress = toDisplayOrNull(input.physicalAddress);
  const adminNotes = toDisplayOrNull(input.adminNotes);
  let registrationStatus: RegistrationStatus;
  if (crisis) {
    registrationStatus = 'INCOMPLETE';
  } else {
    const field =
      emergencyName === null
        ? 'emergencyContactName'
        : emergencyPhone === null
          ? 'emergencyContactPhone'
          : emergencyRelation === null
            ? 'emergencyContactRelation'
            : physicalAddress === null
              ? 'physicalAddress'
              : null;
    if (field !== null) {
      throw new AppError('UNPROCESSABLE', 'Non-crisis registration requires emergency contact and address', [
        { field, issue: 'required for COMPLETE registration', expected: 'provide field or set crisis:true' },
      ]);
    }
    registrationStatus = 'COMPLETE';
  }
  if (nationalIdNorm !== null) {
    const exact = await db.patient.findUnique({ where: { nationalIdNorm }, select: { id: true } });
    if (exact !== null) {
      throw new AppError('CONFLICT', 'Patient with this nationalId already exists', [
        { field: 'nationalId', issue: 'duplicate nationalId', expected: `candidate:${exact.id}` },
      ]);
    }
  }
  if (input.confirmNotDuplicate !== true) {
    const dob = new Date(input.dateOfBirth);
    const nameDobMatch =
      fullNameNorm.length > 0
        ? await db.patient.findFirst({
            where: { fullNameNorm, dateOfBirth: dob, duplicateOfPatientId: null },
            select: { id: true },
          })
        : null;
    const phoneMatch =
      phoneNorm !== null
        ? await db.patient.findFirst({ where: { phoneNorm, duplicateOfPatientId: null }, select: { id: true } })
        : null;
    const candidate = nameDobMatch ?? phoneMatch;
    if (candidate !== null) {
      throw new AppError('POSSIBLE_DUPLICATE', 'Possible duplicate patient', [
        { field: 'nationalId', issue: 'POSSIBLE_DUPLICATE', expected: `candidate:${candidate.id}` },
      ]);
    }
  }
  try {
    const created = await db.patient.create({
      data: {
        fullName: input.fullName.trim(),
        fullNameNorm,
        dateOfBirth: new Date(input.dateOfBirth),
        phone: toDisplayOrNull(input.phone),
        phoneNorm,
        nationalId: toDisplayOrNull(input.nationalId),
        nationalIdNorm,
        guardianPhone: toDisplayOrNull(input.guardianPhone),
        guardianPhoneNorm,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        emergencyContactRelation: emergencyRelation,
        physicalAddress,
        adminNotes,
        registrationStatus,
        createdByUserId: actor.userId,
      },
    });
    await writePatientAudit(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'PATIENT_CREATE',
      entityId: created.id,
    });
    return toSecretPatientDto(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'Patient with this nationalId already exists', [
        { field: 'nationalId', issue: 'duplicate nationalId', expected: 'unique nationalId' },
      ]);
    }
    throw err;
  }
}
