import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors/AppError.js';
import {
  createEncounter,
  getEncounter,
  patchEncounter,
  runAiDiagnosisForEncounter,
} from '../src/modules/clinical-ehr/encounter.service.js';
import {
  createEncounterSchema,
  patchEncounterSchema,
  structuredDiagnosisSchema,
} from '../src/modules/clinical-ehr/encounter.validators.js';

const DOCTOR = { userId: 'doc-p24-1', role: 'DOCTOR' } as const;

function createMockDb() {
  const encounters = new Map<string, any>();
  const patients = new Map<string, any>();
  const audits: any[] = [];

  // Seed patient
  patients.set('pat-1', {
    id: 'pat-1',
    fullName: 'محمود أحمد علي',
    gender: 'MALE',
  });

  const db = {
    patient: {
      findUnique: async ({ where }: { where: { id: string } }) => patients.get(where.id) ?? null,
    },
    encounter: {
      create: async ({ data }: { data: any }) => {
        const id = 'enc-' + randomUUID();
        const row = {
          id,
          ...data,
          addenda: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        encounters.set(id, row);
        return { id, status: row.status, rowVersion: row.rowVersion };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = encounters.get(where.id);
        if (!found) return null;
        return {
          ...found,
          patient: patients.get(found.patientId),
        };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = encounters.get(where.id);
        if (!found) throw new Error('Not found');
        return found;
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        const cur = encounters.get(where.id);
        if (!cur) return { count: 0 };
        if (where.rowVersion !== undefined && cur.rowVersion !== where.rowVersion) {
          return { count: 0 };
        }
        if (where.status?.in && !where.status.in.includes(cur.status)) {
          return { count: 0 };
        }
        const updated = {
          ...cur,
          ...data,
          rowVersion: data.rowVersion?.increment ? cur.rowVersion + 1 : (data.rowVersion ?? cur.rowVersion),
          updatedAt: new Date(),
        };
        encounters.set(where.id, updated);
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: any }) => {
        audits.push(data);
        return { id: 'aud-' + audits.length, ...data };
      },
    },
  } as unknown as PrismaClient;

  return { db, encounters, audits };
}

async function runTests() {
  console.log('Running P2-4 Post-Session Diagnosis Tests...');

  // 1. Validator tests
  const validStructured = structuredDiagnosisSchema.safeParse({
    name: 'Major Depressive Disorder',
    code: 'F32.1',
    type: 'PRIMARY',
    notes: 'Moderate single episode',
  });
  assert.equal(validStructured.success, true, 'Structured diagnosis schema validates correctly');

  const validMixedCreate = createEncounterSchema.safeParse({
    patientId: 'pat-1',
    visitDate: '2026-10-16T10:00:00.000Z',
    encounterType: 'CONSULTATION',
    mse: {
      appearance: 'APPROPRIATE',
      behavior: 'CALM',
      speechCoherence: 'NORMAL',
      moodAffect: 'DEPRESSED',
    },
    diagnoses: [
      'Simple String Diagnosis',
      { name: 'Generalized Anxiety Disorder', code: 'F41.1', type: 'SECONDARY' },
    ],
    diagnosisNotes: 'Patient presents with classic anxiety and depressive triad.',
  });
  assert.equal(validMixedCreate.success, true, 'createEncounterSchema accepts mixed string/structured diagnoses and diagnosisNotes');

  const validPatch = patchEncounterSchema.safeParse({
    diagnoses: [{ name: 'Bipolar I Disorder', code: 'F31.0', type: 'PRIMARY', notes: 'Initial onset' }],
    diagnosisNotes: 'Updated clinical impression post-session.',
  });
  assert.equal(validPatch.success, true, 'patchEncounterSchema allows patching diagnoses and diagnosisNotes independently');

  // 2. Service test: create encounter with manual diagnosis & free text
  const { db, audits } = createMockDb();

  const created = await createEncounter(
    {
      patientId: 'pat-1',
      visitDate: '2026-10-16T10:00:00.000Z',
      encounterType: 'CONSULTATION',
      soap: {
        S: 'المريض يشكو من حزن مستمر وصعوبة في النوم منذ ثلاثة أشهر',
        O: 'المريض واعٍ ومتجاوب، علامات الإجهاد واضحة',
        A: 'نوبة اكتئابية متوسطة الشدة',
        P: 'بدء علاج دوائي وجلسات علاج معرفي سلوكي',
      },
      mse: {
        appearance: 'مرتب ومناسب',
        behavior: 'هادئ ومائل للانعزال',
        speechCoherence: 'كلام مترابط بطيء النبرة',
        moodAffect: 'حزين ومكتئب',
      },
      diagnoses: [
        { name: 'اضطراب اكتئابي جسيم', code: 'F32.1', type: 'PRIMARY', notes: 'نوبة أولى متوسطة' },
      ],
      diagnosisNotes: 'تاريخ عائلي إيجابي للاكتئاب، لا توجد أفكار إيذاء ذاتي.',
    },
    DOCTOR,
    db,
  );

  assert.ok(created.encounterId, 'Encounter created');
  assert.equal(created.status, 'DRAFT');

  // Verify getEncounter returns diagnosis and notes
  const fetched = await getEncounter(created.encounterId, DOCTOR, db);
  assert.equal(fetched.diagnoses.length, 1);
  assert.deepEqual(fetched.diagnoses[0], {
    name: 'اضطراب اكتئابي جسيم',
    code: 'F32.1',
    type: 'PRIMARY',
    notes: 'نوبة أولى متوسطة',
  });
  assert.equal(fetched.diagnosisNotes, 'تاريخ عائلي إيجابي للاكتئاب، لا توجد أفكار إيذاء ذاتي.');

  // 3. Service test: editing, adding, and deleting diagnoses (free manual control)
  const patched = await patchEncounter(
    created.encounterId,
    {
      diagnoses: [
        { name: 'اضطراب اكتئابي جسيم', code: 'F32.1', type: 'PRIMARY', notes: 'معدل' },
        { name: 'أرق أولي', code: 'G47.0', type: 'SECONDARY', notes: 'عرض ثانوي' },
      ],
      diagnosisNotes: 'تمت إضافة تشخيص ثانوي للأرق بعد مراجعة نمط النوم.',
    },
    1,
    DOCTOR,
    db,
  );
  assert.equal(patched.rowVersion, 2);

  const fetchedAfterPatch = await getEncounter(created.encounterId, DOCTOR, db);
  assert.equal(fetchedAfterPatch.diagnoses.length, 2, 'Diagnoses updated to 2 entries');
  assert.equal(fetchedAfterPatch.diagnosisNotes, 'تمت إضافة تشخيص ثانوي للأرق بعد مراجعة نمط النوم.');

  // Delete an item manually (keeping 1)
  const patchedDelete = await patchEncounter(
    created.encounterId,
    {
      diagnoses: [{ name: 'اضطراب اكتئابي جسيم', code: 'F32.1', type: 'PRIMARY' }],
    },
    2,
    DOCTOR,
    db,
  );
  assert.equal(patchedDelete.rowVersion, 3);
  const fetchedAfterDelete = await getEncounter(created.encounterId, DOCTOR, db);
  assert.equal(fetchedAfterDelete.diagnoses.length, 1, 'Diagnosis successfully deleted manually');

  // 4. AI Diagnosis Analysis test (with mocked analyze stage)
  const aiResult = await runAiDiagnosisForEncounter(
    created.encounterId,
    DOCTOR,
    db,
    {
      analyze: async () => JSON.stringify({
        diagnoses: [
          {
            name: 'Major Depressive Disorder, Single Episode, Moderate',
            code: 'F32.1',
            type: 'PRIMARY',
            notes: 'Based on persistent depressed mood, sleep disturbance, and psychomotor slowing.',
          },
          {
            name: 'Generalized Anxiety Disorder',
            code: 'F41.1',
            type: 'DIFFERENTIAL',
            notes: 'Differential rule-out for chronic worry.',
          },
        ],
        clinicalSummary: 'Clinical presentation strongly points to unipolar major depression.',
      }),
    },
  );

  assert.equal(aiResult.diagnoses.length, 2, 'AI returned 2 suggested diagnoses');
  assert.equal(aiResult.diagnoses[0]?.code, 'F32.1');
  assert.ok(aiResult.clinicalSummary.includes('unipolar major depression'));

  // Verify audit event was recorded for AI diagnosis
  const aiAudit = audits.find((a) => a.action === 'ENCOUNTER_AI_DIAGNOSIS');
  assert.ok(aiAudit, 'ENCOUNTER_AI_DIAGNOSIS audit event was written');
  assert.equal(aiAudit.entityId, created.encounterId);

  // 5. Offline fallback test (when deps.analyze not supplied and GROQ_KEY_MISSING)
  const offlineResult = await runAiDiagnosisForEncounter(
    created.encounterId,
    DOCTOR,
    db,
  );
  assert.ok(offlineResult.diagnoses.length >= 1, 'Offline fallback generates clinical suggestions');
  assert.ok(offlineResult.clinicalSummary.length > 0, 'Offline fallback generates clinical summary');

  // 6. Manual flow is NEVER blocked: doctor can ignore AI result and save custom diagnoses
  await patchEncounter(
    created.encounterId,
    {
      diagnoses: [{ name: 'تشخيص مخصص من الطبيب بدون AI', code: 'F99', type: 'PRIMARY' }],
      diagnosisNotes: 'الطبيب وثق التشخيص مستقلاً دون الحاجة للذكاء الاصطناعي.',
    },
    3,
    DOCTOR,
    db,
  );
  const finalFetched = await getEncounter(created.encounterId, DOCTOR, db);
  assert.equal(finalFetched.diagnoses[0]?.name, 'تشخيص مخصص من الطبيب بدون AI');

  console.log('All P2-4 Post-Session Diagnosis Tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
