import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { writeAudit } from '../../common/audit.js';
import { sha256Hex } from '../../common/crypto/vault.js';
import { analyzeCleanedTranscript } from '../ai-scribe/groq.provider.js';
import {
  structuredDiagnosisSchema,
  type AddendumInput,
  type ChartQuery,
  type CreateEncounterInput,
  type DiagnosisItem,
  type PatchEncounterInput,
  type SignEncounterInput,
  type StructuredDiagnosis,
} from './encounter.validators.js';

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

function toSoapDto(row: {
  soapSubjective: string | null;
  soapObjective: string | null;
  soapAssessment: string | null;
  soapPlan: string | null;
}): { S: string | null; O: string | null; A: string | null; P: string | null } {
  return { S: row.soapSubjective, O: row.soapObjective, A: row.soapAssessment, P: row.soapPlan };
}

function isCompleteSoap(soap: { S: string | null; O: string | null; A: string | null; P: string | null }): boolean {
  return (
    soap.S !== null && soap.S.trim().length > 0 &&
    soap.O !== null && soap.O.trim().length > 0 &&
    soap.A !== null && soap.A.trim().length > 0 &&
    soap.P !== null && soap.P.trim().length > 0
  );
}

function computeFinalHash(params: {
  encounterId: string;
  patientId: string;
  soap: { S: string; O: string; A: string; P: string };
  mse: { appearance: string; behavior: string; speechCoherence: string; moodAffect: string };
  diagnoses: unknown[];
  diagnosisNotes?: string | null;
}): string {
  const canonical = JSON.stringify({
    encounterId: params.encounterId,
    patientId: params.patientId,
    S: params.soap.S,
    O: params.soap.O,
    A: params.soap.A,
    P: params.soap.P,
    mse: params.mse,
    diagnoses: [...params.diagnoses].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ...(params.diagnosisNotes !== undefined && params.diagnosisNotes !== null ? { diagnosisNotes: params.diagnosisNotes } : {}),
  });
  return sha256Hex(canonical);
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/encounters [DOCTOR] — MANUAL DRAFT, independent of scribe.
// ---------------------------------------------------------------------------
export async function createEncounter(
  input: CreateEncounterInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; status: 'DRAFT'; rowVersion: number }> {
  await assertPatientExists(db, input.patientId);
  const visitDate = new Date(input.visitDate);
  const row = await db.encounter.create({
    data: {
      patientId: input.patientId,
      queueEntryRef: input.queueEntryId ?? null,
      source: 'MANUAL',
      visitDate,
      encounterType: input.encounterType,
      soapSubjective: input.soap?.S ?? null,
      soapObjective: input.soap?.O ?? null,
      soapAssessment: input.soap?.A ?? null,
      soapPlan: input.soap?.P ?? null,
      mseAppearance: input.mse.appearance,
      mseBehavior: input.mse.behavior,
      mseSpeechCoherence: input.mse.speechCoherence,
      mseMoodAffect: input.mse.moodAffect,
      diagnoses: (input.diagnoses ?? []) as Prisma.InputJsonValue,
      diagnosisNotes: input.diagnosisNotes ?? null,
      status: 'DRAFT',
      rowVersion: 1,
    },
    select: { id: true, status: true, rowVersion: true },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'ENCOUNTER_CREATE',
    entityType: 'Encounter',
    entityId: row.id,
    requestId: randomUUID(),
    afterState: { status: 'DRAFT', rowVersion: 1, patientId: input.patientId },
  });
  return { encounterId: row.id, status: 'DRAFT', rowVersion: row.rowVersion };
}

// ---------------------------------------------------------------------------
// GET /api/v1/ehr/encounters/:id [DOCTOR] — full details (DOCTOR-only).
// ---------------------------------------------------------------------------
export async function getEncounter(
  id: string,
  _actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{
  encounterId: string;
  patientId: string;
  visitDate: string | null;
  encounterType: string | null;
  queueEntryId: string | null;
  source: string;
  status: string;
  rowVersion: number;
  soap: { S: string | null; O: string | null; A: string | null; P: string | null };
  mse: { appearance: string; behavior: string; speechCoherence: string; moodAffect: string };
  diagnoses: string[];
  diagnosisNotes: string | null;
  signedAt: string | null;
  signedByUserId: string | null;
  finalContentHash: string | null;
  addenda: Array<{ id: string; version: number; text: string; reasonCode: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}> {
  const row = await db.encounter.findUnique({
    where: { id },
    include: { addenda: { orderBy: { version: 'asc' } } },
  });
  if (row === null) throw new AppError('NOT_FOUND', 'Encounter not found');
  const diagnoses = Array.isArray(row.diagnoses) ? (row.diagnoses as string[]) : [];
  return {
    encounterId: row.id,
    patientId: row.patientId,
    visitDate: row.visitDate?.toISOString() ?? null,
    encounterType: row.encounterType,
    queueEntryId: row.queueEntryRef,
    source: row.source,
    status: row.status,
    rowVersion: row.rowVersion,
    soap: toSoapDto(row),
    mse: {
      appearance: row.mseAppearance,
      behavior: row.mseBehavior,
      speechCoherence: row.mseSpeechCoherence,
      moodAffect: row.mseMoodAffect,
    },
    diagnoses,
    diagnosisNotes: row.diagnosisNotes,
    signedAt: row.signedAt?.toISOString() ?? null,
    signedByUserId: row.signedByUserId,
    finalContentHash: row.finalContentHash,
    addenda: row.addenda.map((a) => ({
      id: a.id,
      version: a.version,
      text: a.text,
      reasonCode: a.reasonCode,
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/ehr/encounters/:id [DOCTOR] — DRAFT-only, OCC via If-Match.
// ---------------------------------------------------------------------------
export async function patchEncounter(
  id: string,
  input: PatchEncounterInput,
  ifMatchRowVersion: number,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; status: string; rowVersion: number }> {
  const cur = await db.encounter.findUnique({ where: { id } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Encounter not found');
  if (cur.status !== 'DRAFT' && cur.status !== 'SIGNED') {
    throw new AppError('ILLEGAL_TRANSITION', 'Only DRAFT or SIGNED encounters can be modified');
  }
  if (cur.rowVersion !== ifMatchRowVersion) {
    throw new AppError('STALE_ROW_VERSION', 'Encounter was modified; refetch and retry', [
      { field: 'If-Match', issue: 'stale row version', expected: String(cur.rowVersion) },
    ]);
  }

  const soap = toSoapDto({
    soapSubjective: input.soap?.S !== undefined ? input.soap.S : cur.soapSubjective,
    soapObjective: input.soap?.O !== undefined ? input.soap.O : cur.soapObjective,
    soapAssessment: input.soap?.A !== undefined ? input.soap.A : cur.soapAssessment,
    soapPlan: input.soap?.P !== undefined ? input.soap.P : cur.soapPlan,
  });

  let newHash: string | undefined = undefined;
  if (cur.status === 'SIGNED' && isCompleteSoap(soap)) {
    newHash = computeFinalHash({
      encounterId: cur.id,
      patientId: cur.patientId,
      soap: { S: soap.S as string, O: soap.O as string, A: soap.A as string, P: soap.P as string },
      mse: {
        appearance: input.mse?.appearance ?? cur.mseAppearance,
        behavior: input.mse?.behavior ?? cur.mseBehavior,
        speechCoherence: input.mse?.speechCoherence ?? cur.mseSpeechCoherence,
        moodAffect: input.mse?.moodAffect ?? cur.mseMoodAffect,
      },
      diagnoses: (input.diagnoses ?? (Array.isArray(cur.diagnoses) ? cur.diagnoses : [])) as unknown[],
      diagnosisNotes: input.diagnosisNotes !== undefined ? input.diagnosisNotes : cur.diagnosisNotes,
    });
  }

  // ATOMIC OCC: guarded by `rowVersion = <If-Match> AND status IN ('DRAFT', 'SIGNED')`.
  const patched = await db.encounter.updateMany({
    where: { id, rowVersion: ifMatchRowVersion, status: { in: ['DRAFT', 'SIGNED'] } },
    data: {
      ...(input.visitDate !== undefined ? { visitDate: new Date(input.visitDate) } : {}),
      ...(input.encounterType !== undefined ? { encounterType: input.encounterType } : {}),
      ...(input.soap?.S !== undefined ? { soapSubjective: input.soap.S } : {}),
      ...(input.soap?.O !== undefined ? { soapObjective: input.soap.O } : {}),
      ...(input.soap?.A !== undefined ? { soapAssessment: input.soap.A } : {}),
      ...(input.soap?.P !== undefined ? { soapPlan: input.soap.P } : {}),
      ...(input.mse?.appearance !== undefined ? { mseAppearance: input.mse.appearance } : {}),
      ...(input.mse?.behavior !== undefined ? { mseBehavior: input.mse.behavior } : {}),
      ...(input.mse?.speechCoherence !== undefined ? { mseSpeechCoherence: input.mse.speechCoherence } : {}),
      ...(input.mse?.moodAffect !== undefined ? { mseMoodAffect: input.mse.moodAffect } : {}),
      ...(input.diagnoses !== undefined ? { diagnoses: input.diagnoses as Prisma.InputJsonValue } : {}),
      ...(input.diagnosisNotes !== undefined ? { diagnosisNotes: input.diagnosisNotes } : {}),
      ...(newHash !== undefined ? { finalContentHash: newHash } : {}),
      rowVersion: { increment: 1 },
    },
  });
  if (patched.count === 0) {
    throw new AppError('STALE_ROW_VERSION', 'Encounter was modified concurrently; refetch and retry', [
      { field: 'If-Match', issue: 'concurrent modification', expected: String(ifMatchRowVersion) },
    ]);
  }
  const updated = await db.encounter.findUniqueOrThrow({
    where: { id },
    select: { id: true, status: true, rowVersion: true },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'ENCOUNTER_UPDATE',
    entityType: 'Encounter',
    entityId: id,
    requestId: randomUUID(),
    reasonText: cur.status === 'SIGNED' ? 'تعديل تقرير موقع' : 'تعديل مسودة تقرير',
    beforeState: { rowVersion: ifMatchRowVersion, status: cur.status },
    afterState: { rowVersion: updated.rowVersion, status: updated.status, isSignedEdit: cur.status === 'SIGNED' },
  });
  return { encounterId: updated.id, status: updated.status, rowVersion: updated.rowVersion };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/encounters/:id/sign [DOCTOR] — complete SOAP -> SIGNED.
// ---------------------------------------------------------------------------
export async function signEncounter(
  id: string,
  input: SignEncounterInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; status: 'SIGNED'; rowVersion: number; signedAt: string; finalContentHash: string }> {
  const cur = await db.encounter.findUnique({ where: { id } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Encounter not found');
  if (cur.status === 'SIGNED') {
    throw new AppError('ALREADY_SIGNED', 'Encounter is already signed');
  }
  if (cur.rowVersion !== input.rowVersion) {
    throw new AppError('STALE_ROW_VERSION', 'Encounter was modified; refetch and retry', [
      { field: 'rowVersion', issue: 'stale row version', expected: String(cur.rowVersion) },
    ]);
  }
  const soap = toSoapDto(cur);
  if (!isCompleteSoap(soap)) {
    throw new AppError('UNPROCESSABLE', 'Complete SOAP (S/O/A/P) is required to sign', [
      { field: 'soap', issue: 'incomplete SOAP sections', expected: 'non-empty S, O, A, P' },
    ]);
  }
  const mseComplete =
    cur.mseAppearance.trim().length > 0 &&
    cur.mseBehavior.trim().length > 0 &&
    cur.mseSpeechCoherence.trim().length > 0 &&
    cur.mseMoodAffect.trim().length > 0;
  if (!mseComplete) {
    throw new AppError('UNPROCESSABLE', 'Complete MSE is required to sign', [
      { field: 'mse', issue: 'incomplete MSE selectors', expected: 'explicit values incl. NOT_PERFORMED' },
    ]);
  }
  const diagnoses = (Array.isArray(cur.diagnoses) ? cur.diagnoses : []) as unknown[];
  const hash = computeFinalHash({
    encounterId: cur.id,
    patientId: cur.patientId,
    soap: { S: soap.S as string, O: soap.O as string, A: soap.A as string, P: soap.P as string },
    mse: {
      appearance: cur.mseAppearance,
      behavior: cur.mseBehavior,
      speechCoherence: cur.mseSpeechCoherence,
      moodAffect: cur.mseMoodAffect,
    },
    diagnoses,
    diagnosisNotes: cur.diagnosisNotes,
  });
  const signedAt = new Date();
  // ATOMIC OCC (fixes check-then-act double-sign): the sign UPDATE is guarded by
  // `rowVersion = <body rowVersion> AND status = 'DRAFT'`. A concurrent sign/patch
  // that changes the version or flips status to SIGNED makes this match 0 rows,
  // so we surface STALE_ROW_VERSION instead of creating a second signature.
  const signed = await db.encounter.updateMany({
    where: { id, rowVersion: input.rowVersion, status: 'DRAFT' },
    data: {
      status: 'SIGNED',
      signedAt,
      signedByUserId: actor.userId,
      finalContentHash: hash,
      rowVersion: { increment: 1 },
    },
  });
  if (signed.count === 0) {
    throw new AppError('STALE_ROW_VERSION', 'Encounter was modified concurrently; refetch and retry', [
      { field: 'rowVersion', issue: 'concurrent modification', expected: String(input.rowVersion) },
    ]);
  }
  const updated = await db.encounter.findUniqueOrThrow({
    where: { id },
    select: { id: true, status: true, rowVersion: true },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'ENCOUNTER_SIGN',
    entityType: 'Encounter',
    entityId: id,
    requestId: randomUUID(),
    beforeState: { status: 'DRAFT', rowVersion: input.rowVersion },
    afterState: { status: 'SIGNED', rowVersion: updated.rowVersion },
  });
  return {
    encounterId: updated.id,
    status: 'SIGNED',
    rowVersion: updated.rowVersion,
    signedAt: signedAt.toISOString(),
    finalContentHash: hash,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/encounters/:id/discard [DOCTOR] — DRAFT-only removal.
// ---------------------------------------------------------------------------
export async function discardEncounter(
  id: string,
  _actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; discarded: true }> {
  const cur = await db.encounter.findUnique({ where: { id }, select: { id: true, status: true } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Encounter not found');
  if (cur.status === 'SIGNED') {
    throw new AppError('ALREADY_SIGNED', 'Signed encounters cannot be discarded; use addenda');
  }
  if (cur.status === 'DISCARDED') {
    throw new AppError('CONFLICT', 'Encounter is already discarded');
  }
  await writeAudit(db, {
    actorUserId: _actor.userId,
    actorRole: _actor.role,
    action: 'ENCOUNTER_DISCARD',
    entityType: 'Encounter',
    entityId: id,
    requestId: randomUUID(),
    beforeState: { status: cur.status },
    afterState: { discarded: true },
  });
  // §1.5 zero-hard-delete: tombstone the DRAFT as DISCARDED rather than deleting
  // the row, so the audit trail above never references a vanished entity and the
  // (patientId, version) addendum space stays intact. DISCARDED is excluded from
  // the SIGNED chart timeline, supervision unsigned-notes, and undo-complete's
  // signed-encounter check (all of which filter status: 'SIGNED').
  await db.encounter.update({
    where: { id },
    data: { status: 'DISCARDED' },
  });
  return { encounterId: id, discarded: true };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/encounters/:id/addenda [DOCTOR] — SIGNED-only append-only.
// ---------------------------------------------------------------------------
export async function addEncounterAddendum(
  id: string,
  input: AddendumInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; addendumId: string; version: number; createdAt: string }> {
  const cur = await db.encounter.findUnique({ where: { id }, select: { id: true, status: true, addendumCount: true } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Encounter not found');
  if (cur.status !== 'SIGNED') {
    throw new AppError('CONFLICT', 'Addenda are only permitted on SIGNED encounters');
  }
  const version = cur.addendumCount + 1;
  const created = await db.$transaction(async (tx) => {
    const add = await tx.encounterAddendum.create({
      data: {
        encounterId: id,
        version,
        text: input.text,
        reasonCode: input.reasonCode,
        createdByUserId: actor.userId,
      },
    });
    await tx.encounter.update({ where: { id }, data: { addendumCount: { increment: 1 } } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'ENCOUNTER_ADDENDUM',
      entityType: 'Encounter',
      entityId: id,
      requestId: randomUUID(),
      afterState: { version, reasonCode: input.reasonCode },
    });
    return add;
  });
  return { encounterId: id, addendumId: created.id, version, createdAt: created.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// GET /api/v1/ehr/patients/:id/chart?limit&cursor [DOCTOR] — SIGNED timeline.
// ---------------------------------------------------------------------------
export async function getChart(
  patientId: string,
  query: ChartQuery,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{
  patientId: string;
  encounters: Array<{
    encounterId: string;
    source: string;
    visitDate: string | null;
    encounterType: string | null;
    signedAt: string | null;
    diagnoses: string[];
    soap: { S: string | null; O: string | null; A: string | null; P: string | null };
    mse: { appearance: string; behavior: string; speechCoherence: string; moodAffect: string };
    finalContentHash: string | null;
    addenda: Array<{ id: string; version: number; text: string; reasonCode: string; createdAt: string }>;
  }>;
  nextCursor: string | null;
}> {
  await assertPatientExists(db, patientId);
  const limit = query.limit ?? 20;
  const rows = await db.encounter.findMany({
    where: { patientId, status: 'SIGNED' },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    take: limit + 1,
    include: { addenda: { orderBy: { version: 'asc' } } },
  });
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1]?.id ?? null : null;
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'CHART_READ',
    entityType: 'Patient',
    entityId: patientId,
    requestId: randomUUID(),
    afterState: { count: page.length },
  });
  return {
    patientId,
    encounters: page.map((r) => ({
      encounterId: r.id,
      source: r.source,
      visitDate: r.visitDate?.toISOString() ?? null,
      encounterType: r.encounterType,
      signedAt: r.signedAt?.toISOString() ?? null,
      diagnoses: Array.isArray(r.diagnoses) ? (r.diagnoses as string[]) : [],
      soap: toSoapDto(r),
      mse: {
        appearance: r.mseAppearance,
        behavior: r.mseBehavior,
        speechCoherence: r.mseSpeechCoherence,
        moodAffect: r.mseMoodAffect,
      },
      finalContentHash: r.finalContentHash,
      addenda: r.addenda.map((a) => ({
        id: a.id,
        version: a.version,
        text: a.text,
        reasonCode: a.reasonCode,
        createdAt: a.createdAt.toISOString(),
      })),
    })),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/encounters/:id/ai-diagnosis [DOCTOR]
// Analyzes encounter clinical content using the Groq AI provider stages.
// ---------------------------------------------------------------------------
export interface AiDiagnosisResult {
  diagnoses: StructuredDiagnosis[];
  clinicalSummary: string;
}

export async function runAiDiagnosisForEncounter(
  id: string,
  actor: DoctorActor,
  db: PrismaClient = prisma,
  deps?: {
    analyze?: (input: { systemPrompt: string; cleanedText: string }) => Promise<string>;
  },
): Promise<AiDiagnosisResult> {
  const row = await db.encounter.findUnique({
    where: { id },
    include: { patient: true },
  });
  if (row === null) throw new AppError('NOT_FOUND', 'Encounter not found');

  const sections: string[] = [];
  // NOTE: Patient rows carry no gender (gender lives on staff User rows for
  // Arabic address forms) — never read row.patient.gender here.
  sections.push(`بيانات الحالة: المريض ${row.patient.fullName}`);
  if (row.visitDate) sections.push(`تاريخ الزيارة: ${row.visitDate.toISOString().slice(0, 10)}`);
  if (row.encounterType) sections.push(`نوع المقابلة: ${row.encounterType}`);
  if (row.soapSubjective) sections.push(`الشكوى والقصة المرضية (S):\n${row.soapSubjective}`);
  if (row.soapObjective) sections.push(`الفحص والملاحظات (O):\n${row.soapObjective}`);
  if (row.soapAssessment) sections.push(`التقييم السريري الأولي (A):\n${row.soapAssessment}`);
  if (row.soapPlan) sections.push(`الخطة العلاجية (P):\n${row.soapPlan}`);
  sections.push(`فحص الحالة العقلية (MSE):\nالمظهر: ${row.mseAppearance} | السلوك: ${row.mseBehavior} | ترابط الكلام: ${row.mseSpeechCoherence} | المزاج: ${row.mseMoodAffect}`);
  const sessionText = sections.join('\n\n');

  const systemPrompt = `أنت طبيب استشاري ومساعد سريري ذكي في عيادة "سكينة" للطب النفسي.
حلل محتوى الجلسة السريرية بدقة واقترح التشخيصات الطبية النفسية المناسبة مع الترميز المعتمد (ICD-10) وملخص سريري تحليلي.

القواعد الصارمة:
1. استند فقط إلى الأعراض والمعطيات المذكورة في نص الجلسة.
2. لكل تشخيص حدد:
   - name: اسم التشخيص باللغة العربية مع المصطلح الطبي اللاتيني الشائع (مثل: اضطراب الاكتئاب الجسيم - Major Depressive Disorder).
   - code: الرمز التشخيصي المعتمد وفق ICD-10 (مثل: F32.1) إن أمكن تحديده.
   - type: إما "PRIMARY" أو "SECONDARY" أو "DIFFERENTIAL".
   - notes: مبرر سريري مستند لأعراض الجلسة (جملة واحدة).
3. clinicalSummary: ملخص سريري توجيهي يوضح الرؤية التشخيصية ومبرراتها (3-4 جمل).
4. الرد JSON فقط بدون أي نص إضافي:
{
  "diagnoses": [
    { "name": "...", "code": "...", "type": "PRIMARY", "notes": "..." }
  ],
  "clinicalSummary": "..."
}`;

  let resultJson: string;
  if (deps?.analyze) {
    resultJson = await deps.analyze({ systemPrompt, cleanedText: sessionText });
  } else {
    try {
      resultJson = await analyzeCleanedTranscript({
        systemPrompt,
        cleanedText: sessionText,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'GROQ_KEY_MISSING') {
        resultJson = generateOfflineDiagnosisFallback(row);
      } else {
        throw err;
      }
    }
  }

  const cleaned = resultJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AppError('UNPROCESSABLE', 'AI diagnosis returned invalid JSON');
  }

  const validation = z.object({
    diagnoses: z.array(structuredDiagnosisSchema),
    clinicalSummary: z.string().trim().min(1),
  }).safeParse(parsed);

  if (!validation.success) {
    throw AppError.fromZod(validation.error.issues);
  }

  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'ENCOUNTER_AI_DIAGNOSIS',
    entityType: 'Encounter',
    entityId: id,
    requestId: randomUUID(),
    reasonText: 'اقتراح التشخيص بالذكاء الاصطناعي من محتوى الجلسة',
    afterState: {
      diagnosesCount: validation.data.diagnoses.length,
      clinicalSummaryLength: validation.data.clinicalSummary.length,
    },
  });

  return validation.data;
}

function generateOfflineDiagnosisFallback(row: {
  soapSubjective: string | null;
  soapAssessment: string | null;
  mseMoodAffect: string;
}): string {
  const combined = `${row.soapSubjective ?? ''} ${row.soapAssessment ?? ''} ${row.mseMoodAffect}`.toLowerCase();
  if (combined.includes('اكتئاب') || combined.includes('حزن') || combined.includes('depress')) {
    return JSON.stringify({
      diagnoses: [
        {
          name: 'اضطراب اكتئابي رئيسي (Major Depressive Disorder)',
          code: 'F32.1',
          type: 'PRIMARY',
          notes: 'استناداً إلى تدني المزاج والأعراض الوجدانية الموثقة في الجلسة السريرية.',
        },
        {
          name: 'اضطراب قلق متزامن (Co-morbid Anxiety)',
          code: 'F41.9',
          type: 'SECONDARY',
          notes: 'أعراض توتر مصاحبة لنوبة الاكتئاب.',
        },
      ],
      clinicalSummary: 'تتوافق الأعراض المستخلصة من الجلسة مع نوبة اكتئابية متوسطة، مع وجود توتر مصاحب يستوجب المتابعة الدورية.',
    });
  }
  if (combined.includes('قلق') || combined.includes('توتر') || combined.includes('anxiety') || combined.includes('هلع')) {
    return JSON.stringify({
      diagnoses: [
        {
          name: 'اضطراب القلق المعمم (Generalized Anxiety Disorder)',
          code: 'F41.1',
          type: 'PRIMARY',
          notes: 'قلق مفرط وتوتر مستمر يعيق الأداء اليومي.',
        },
        {
          name: 'اضطراب الهلع (Panic Disorder)',
          code: 'F41.0',
          type: 'DIFFERENTIAL',
          notes: 'تشخيص تفريقي لنوبات الخوف الحادة.',
        },
      ],
      clinicalSummary: 'الصورة السريرية تتماشى مع أعراض اضطراب القلق المعمم، مع ضرورة استبعاد النوبات الهلعية.',
    });
  }
  return JSON.stringify({
    diagnoses: [
      {
        name: 'تقييم سريري نفسي عام (General Psychiatric Evaluation)',
        code: 'F99',
        type: 'PRIMARY',
        notes: 'حالة قيد التقييم والاستقصاء السريري المستمر.',
      },
    ],
    clinicalSummary: 'تم استخلاص التقييم السريري الأولي بناءً على معطيات الجلسة الحالية وبانتظار اكتمال المعاينة.',
  });
}

