import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { writeAudit } from '../../common/audit.js';
import type {
  AdjustMedicationInput,
  CreateMedicationInput,
  DiscontinueMedicationInput,
  MedicationListQuery,
} from './medication.validators.js';

export interface DoctorActor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

type Db = PrismaClient | Prisma.TransactionClient;

async function assertPatientExists(db: Db, patientId: string): Promise<void> {
  const row = await (db as PrismaClient).patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (row === null) throw new AppError('NOT_FOUND', 'Patient not found');
}

function toMedDto(row: {
  id: string;
  patientId: string;
  encounterRef: string | null;
  drugName: string;
  dosage: string;
  frequency: string;
  instructions: string;
  status: string;
  cessationReason: string | null;
  cessationNote: string | null;
  supersededByMedicationId: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
}): {
  medicationId: string;
  patientId: string;
  encounterId: string | null;
  drugName: string;
  dosage: string;
  frequency: string;
  instructions: string;
  status: string;
  cessationReasonCode: string | null;
  cessationNote: string | null;
  supersededByMedicationId: string | null;
  startedAt: string;
  stoppedAt: string | null;
} {
  return {
    medicationId: row.id,
    patientId: row.patientId,
    encounterId: row.encounterRef,
    drugName: row.drugName,
    dosage: row.dosage,
    frequency: row.frequency,
    instructions: row.instructions,
    status: row.status,
    cessationReasonCode: row.cessationReason,
    cessationNote: row.cessationNote,
    supersededByMedicationId: row.supersededByMedicationId,
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/patients/:id/medications [DOCTOR] -> 201 ACTIVE
// ---------------------------------------------------------------------------
export async function createMedication(
  patientId: string,
  input: CreateMedicationInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toMedDto>> {
  await assertPatientExists(db, patientId);
  const row = await db.medication.create({
    data: {
      patientId,
      encounterRef: input.encounterId ?? null,
      drugName: input.drugName,
      dosage: input.dosage,
      frequency: input.frequency,
      instructions: input.instructions,
      status: 'ACTIVE',
      prescribedByUserId: actor.userId,
    },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'MEDICATION_CREATE',
    entityType: 'Medication',
    entityId: row.id,
    requestId: randomUUID(),
    afterState: { status: 'ACTIVE', patientId, drugName: input.drugName },
  });
  return toMedDto(row);
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/medications/:id/discontinue [DOCTOR]
// ---------------------------------------------------------------------------
export async function discontinueMedication(
  id: string,
  input: DiscontinueMedicationInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<ReturnType<typeof toMedDto>> {
  const cur = await db.medication.findUnique({ where: { id } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Medication not found');
  if (cur.status === 'DISCONTINUED') {
    throw new AppError('CONFLICT', 'Medication is already discontinued');
  }
  const stoppedAt = new Date();
  const updated = await db.medication.update({
    where: { id },
    data: {
      status: 'DISCONTINUED',
      cessationReason: input.cessationReasonCode,
      cessationNote: input.cessationNote ?? null,
      stoppedAt,
    },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'MEDICATION_DISCONTINUE',
    entityType: 'Medication',
    entityId: id,
    requestId: randomUUID(),
    beforeState: { status: 'ACTIVE' },
    afterState: { status: 'DISCONTINUED', cessationReasonCode: input.cessationReasonCode },
  });
  return toMedDto(updated);
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/medications/:id/adjust [DOCTOR] — titration.
// Marks old row DISCONTINUED (DOSE_ADJUSTED), creates new ACTIVE row linked
// via supersededByMedicationId. Atomic in one transaction.
// ---------------------------------------------------------------------------
export async function adjustMedication(
  id: string,
  input: AdjustMedicationInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ oldMedication: ReturnType<typeof toMedDto>; newMedication: ReturnType<typeof toMedDto> }> {
  const cur = await db.medication.findUnique({ where: { id } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Medication not found');
  if (cur.status === 'DISCONTINUED') {
    throw new AppError('CONFLICT', 'Discontinued medications cannot be adjusted; create a new regimen');
  }
  const stoppedAt = new Date();
  const result = await db.$transaction(async (tx) => {
    const created = await tx.medication.create({
      data: {
        patientId: cur.patientId,
        encounterRef: cur.encounterRef,
        drugName: cur.drugName,
        dosage: input.dosage ?? cur.dosage,
        frequency: input.frequency ?? cur.frequency,
        instructions: input.instructions ?? cur.instructions,
        status: 'ACTIVE',
        prescribedByUserId: actor.userId,
      },
    });
    const old = await tx.medication.update({
      where: { id },
      data: {
        status: 'DISCONTINUED',
        cessationReason: 'DOSE_ADJUSTED',
        cessationNote: null,
        stoppedAt,
        supersededByMedicationId: created.id,
      },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'MEDICATION_ADJUST',
      entityType: 'Medication',
      entityId: id,
      requestId: randomUUID(),
      beforeState: {
        status: 'ACTIVE',
        dosage: cur.dosage,
        frequency: cur.frequency,
        instructions: cur.instructions,
      },
      afterState: { status: 'DISCONTINUED', cessationReasonCode: 'DOSE_ADJUSTED', newMedicationId: created.id },
    });
    return { old, created };
  });
  return { oldMedication: toMedDto(result.old), newMedication: toMedDto(result.created) };
}

// ---------------------------------------------------------------------------
// GET /api/v1/ehr/patients/:id/medications?status= [DOCTOR]
// ---------------------------------------------------------------------------
export async function listMedications(
  patientId: string,
  query: MedicationListQuery,
  _actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ patientId: string; medications: Array<ReturnType<typeof toMedDto>> }> {
  await assertPatientExists(db, patientId);
  const rows = await db.medication.findMany({
    where: { patientId, ...(query.status !== undefined ? { status: query.status } : {}) },
    orderBy: { startedAt: 'desc' },
  });
  return { patientId, medications: rows.map(toMedDto) };
}
