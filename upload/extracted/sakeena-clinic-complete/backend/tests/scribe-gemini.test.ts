import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors/AppError.js';
import { requireRole } from '../src/common/middleware/requireRole.js';
import type { AuthContext } from '../src/common/middleware/authenticate.js';
import {
  CYCLE_1_ANALYSIS_PROMPT,
  CYCLE_2_SYNTHESIS_PROMPT,
} from '../src/modules/ai-scribe/prompts/scribe.prompts.js';
import {
  analyzeConsultationAudio,
  resolveGeminiConfig,
  synthesizeDoctorDecision,
} from '../src/modules/ai-scribe/gemini.provider.js';
import {
  CYCLE_0_CLEANUP_PROMPT,
} from '../src/modules/ai-scribe/prompts/scribe.prompts.js';
import {
  cleanupTranscriptSchema,
  renderCleanedTranscript,
} from '../src/modules/ai-scribe/groq.provider.js';
import {
  audioUploadSchema,
  commitSessionSchema,
  createSessionSchema,
  withdrawConsentSchema,
} from '../src/modules/ai-scribe/scribe.validators.js';
import {
  cancelScribeSession,
  commitScribeSession,
  deleteScribeSession,
  purgeExpiredScribeAudio,
  purgeScribeAudioFiles,
  runCycle1Consultation,
  runCycle2DoctorDecision,
  startScribeSession,
  stopScribeSession,
  withdrawConsentScribeSession,
} from '../src/modules/ai-scribe/scribe.service.js';

// ---------------------------------------------------------------------------
// Helpers (no network, no live Gemini key, no database).
// ---------------------------------------------------------------------------

const FAKE_AUDIO = Buffer.from('fake-audio-bytes-cycle').toString('base64');
const DOCTOR = { userId: 'doctor-1', role: 'DOCTOR' } as const;

function mockReq(role: 'DOCTOR' | 'SECRETARY'): Request {
  const req = { method: 'POST', originalUrl: '/api/v1/scribe/sessions', path: '/' } as Request;
  const auth: AuthContext = { userId: 'u1', role, tokenVersion: 1, mustChangePassword: false };
  (req as Request & { auth: AuthContext }).auth = auth;
  return req;
}

function mockRes(): Response {
  return { statusCode: 200 } as Response;
}

interface FakeSessionRow {
  id: string;
  patientId: string;
  status: string;
  mode: string;
  queueEntryRef: string | null;
  encounterRef: string | null;
  audioReference: string | null;
  audioRetentionUntil: Date | null;
  createdByUserId: string;
  consentStatus: string;
  withdrawnAt: Date | null;
  withdrawalReason: string | null;
  createdAt: Date;
}

interface FakeDbState {
  encounters: Array<{ id: string; data: unknown }>;
  medications: Array<{ id: string; data: unknown }>;
  audits: Array<{ action: string; entityId: string }>;
  sessions: Map<string, FakeSessionRow>;
  drafts: Array<Record<string, unknown>>;
  /** Test-only: force the tx status claim to match 0 rows (simulates a lost race). */
  forceClaimFailure?: boolean;
}

function makeFakeDb(state: FakeDbState): PrismaClient {
  let seq = 0;
  const claimMatches = (row: FakeSessionRow, status?: { in?: string[]; notIn?: string[] }): boolean => {
    if (status?.in !== undefined && !status.in.includes(row.status)) return false;
    if (status?.notIn !== undefined && status.notIn.includes(row.status)) return false;
    return true;
  };
  const txApi = {
    encounter: {
      create: (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        const id = 'enc-1';
        state.encounters.push({ id, data: args.data });
        return Promise.resolve({ id });
      },
    },
    medication: {
      create: (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        seq += 1;
        const id = `med-${seq}`;
        state.medications.push({ id, data: args.data });
        return Promise.resolve({ id });
      },
    },
    auditEvent: {
      create: (args: { data: { action: string; entityId: string } }): Promise<{ id: string }> => {
        state.audits.push({ action: String(args.data.action), entityId: String(args.data.entityId) });
        return Promise.resolve({ id: 'audit-1' });
      },
    },
    scribeSession: {
      create: (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        seq += 1;
        const id = `sess-${seq}`;
        state.sessions.set(id, {
          id,
          patientId: String(args.data['patientId'] ?? ''),
          status: String(args.data['status'] ?? 'UPLOADED'),
          mode: String(args.data['mode'] ?? 'AMBIENT_LIVE'),
          queueEntryRef: (args.data['queueEntryRef'] as string | undefined) ?? null,
          encounterRef: null,
          audioReference: null,
          audioRetentionUntil: (args.data['audioRetentionUntil'] as Date | undefined) ?? null,
          createdByUserId: String(args.data['createdByUserId'] ?? 'doctor-1'),
          consentStatus: 'GRANTED',
          withdrawnAt: null,
          withdrawalReason: null,
          createdAt: new Date('2026-10-14T10:00:00Z'),
        });
        return Promise.resolve({ id });
      },
      findUnique: (args: { where: { id: string } }): Promise<FakeSessionRow | null> =>
        Promise.resolve(state.sessions.get(args.where.id) ?? null),
      findMany: (args?: {
        where?: {
          audioRetentionUntil?: { lte?: Date };
          audioReference?: { not?: unknown };
          status?: { notIn?: readonly string[] };
        };
      }): Promise<FakeSessionRow[]> => {
        const w = args?.where;
        const rows = [...state.sessions.values()].filter((r) => {
          if (w?.audioRetentionUntil?.lte !== undefined && !(r.audioRetentionUntil !== null && r.audioRetentionUntil <= w.audioRetentionUntil.lte)) {
            return false;
          }
          if (w?.audioReference !== undefined && r.audioReference === null) return false;
          if (w?.status?.notIn !== undefined && w.status.notIn.includes(r.status)) return false;
          return true;
        });
        // Snapshot copies: like real Prisma, a read does not alias the live row —
        // a status change after the read is exactly what the conditional-update
        // guard must detect.
        return Promise.resolve(rows.map((r) => ({ ...r })));
      },
      update: (args: { where: { id: string }; data: Record<string, unknown> }): Promise<FakeSessionRow> => {
        const row = state.sessions.get(args.where.id);
        if (row === undefined) return Promise.reject(new Error('session not found'));
        Object.assign(row, args.data);
        return Promise.resolve({ ...row });
      },
      updateMany: (args: {
        where: { id: string; status?: string | { in?: string[]; notIn?: string[] } };
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        const row = state.sessions.get(args.where.id);
        const wStatus = args.where.status;
        const matches =
          row !== undefined &&
          state.forceClaimFailure !== true &&
          (typeof wStatus === 'string' ? row.status === wStatus : claimMatches(row, wStatus));
        if (!matches) return Promise.resolve({ count: 0 });
        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: (args: { where: { id: string }; select?: unknown }): Promise<FakeSessionRow> => {
        const row = state.sessions.get(args.where.id);
        if (row === undefined) return Promise.reject(new Error('session not found'));
        return Promise.resolve({ ...row });
      },
      delete: (args: { where: { id: string } }): Promise<FakeSessionRow> => {
        const row = state.sessions.get(args.where.id);
        if (row === undefined) return Promise.reject(new Error('session not found'));
        state.sessions.delete(args.where.id);
        return Promise.resolve({ ...row });
      },
    },
    scribeDraft: {
      create: (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        seq += 1;
        const row = { id: `draft-${seq}`, ...args.data };
        state.drafts.push(row);
        return Promise.resolve({ id: row.id });
      },
      findFirst: (args: { where: { scribeSessionId: string } }): Promise<Record<string, unknown> | null> => {
        const list = state.drafts
          .filter((d) => d['scribeSessionId'] === args.where.scribeSessionId)
          .sort((a, b) => Number(b['version'] ?? 0) - Number(a['version'] ?? 0));
        return Promise.resolve(list[0] ?? null);
      },
      deleteMany: (args: { where: { scribeSessionId: string } }): Promise<{ count: number }> => {
        const before = state.drafts.length;
        state.drafts = state.drafts.filter((d) => d['scribeSessionId'] !== args.where.scribeSessionId);
        return Promise.resolve({ count: before - state.drafts.length });
      },
    },
  };
  const fake = {
    patient: {
      findUnique: (): Promise<{ id: string } | null> => Promise.resolve({ id: 'patient-1' }),
    },
    encounter: txApi.encounter,
    medication: txApi.medication,
    auditEvent: txApi.auditEvent,
    scribeSession: txApi.scribeSession,
    scribeDraft: txApi.scribeDraft,
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txApi),
  };
  return fake as unknown as PrismaClient;
}

function emptyState(): FakeDbState {
  return { encounters: [], medications: [], audits: [], sessions: new Map(), drafts: [] };
}

/** Consent-confirmed ambient start input (BE-602 gate satisfied). */
const CONSENTED_START = { patientId: 'patient-1', mode: 'AMBIENT_LIVE', consentConfirmed: true } as const;

const noopSaveAudio = (): Promise<string> => Promise.resolve('/tmp/fake-audio.webm');
const noopPurgeAudio = (): Promise<{ purgedFiles: string[] }> => Promise.resolve({ purgedFiles: [] });

// Ensure a clean key environment for the missing-key test.
const savedKey = process.env['GEMINI_API_KEY'];
const savedModel = process.env['GEMINI_MODEL'];
delete process.env['GEMINI_API_KEY'];
delete process.env['GEMINI_MODEL'];

// ---------------------------------------------------------------------------
// 1. Prompts are isolated, editable strings with exact JSON contracts.
// ---------------------------------------------------------------------------
{
  assert.equal(typeof CYCLE_1_ANALYSIS_PROMPT, 'string');
  assert.equal(typeof CYCLE_2_SYNTHESIS_PROMPT, 'string');
  for (const key of ['chiefComplaint', 'symptoms', 'moodAndAffect', 'suggestions']) {
    assert.ok(CYCLE_1_ANALYSIS_PROMPT.includes(key), `cycle1 prompt must document ${key}`);
  }
  for (const key of ['"S"', '"O"', '"A"', '"P"', 'prescriptions', 'finalDiagnosis', 'drugName']) {
    assert.ok(CYCLE_2_SYNTHESIS_PROMPT.includes(key), `cycle2 prompt must document ${key}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Missing GEMINI_API_KEY fails gracefully with 500 GEMINI_KEY_MISSING.
// ---------------------------------------------------------------------------
{
  assert.equal(new AppError('GEMINI_KEY_MISSING', 'Gemini API key is not configured').statusCode, 500);
  let thrown: unknown = null;
  try {
    resolveGeminiConfig();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError, 'missing key must throw AppError');
  assert.equal((thrown as AppError).code, 'GEMINI_KEY_MISSING');
  assert.equal((thrown as AppError).statusCode, 500);
}

// ---------------------------------------------------------------------------
// 3. Cycle 1 parses mocked Gemini JSON (no network).
// ---------------------------------------------------------------------------
{
  const mocked = JSON.stringify({
    chiefComplaint: 'Low mood for two weeks',
    symptoms: ['insomnia', 'anhedonia'],
    moodAndAffect: 'Depressed mood, restricted affect',
    suggestions: ['Assess sleep hygiene', 'Screen for anhedonia severity'],
  });
  const out = await analyzeConsultationAudio({
    audioBase64: FAKE_AUDIO,
    mimeType: 'audio/webm',
    generateContent: () => Promise.resolve(mocked),
  });
  assert.equal(out.chiefComplaint, 'Low mood for two weeks');
  assert.deepEqual(out.symptoms, ['insomnia', 'anhedonia']);
  assert.equal(out.moodAndAffect, 'Depressed mood, restricted affect');
  assert.deepEqual(out.suggestions, ['Assess sleep hygiene', 'Screen for anhedonia severity']);
}

// ---------------------------------------------------------------------------
// 4. Non-JSON Gemini output -> 422 (never 500, never persisted).
// ---------------------------------------------------------------------------
{
  let thrown: unknown = null;
  try {
    await analyzeConsultationAudio({
      audioBase64: FAKE_AUDIO,
      generateContent: () => Promise.resolve('not json at all {{{'),
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'UNPROCESSABLE');
}

// ---------------------------------------------------------------------------
// 5. Cycle 2 parses SOAP + prescriptions, strips ```json fences.
// ---------------------------------------------------------------------------
{
  const cycle1 = {
    chiefComplaint: 'Low mood',
    symptoms: ['insomnia'],
    moodAndAffect: 'Low, restricted',
    suggestions: ['Clarify sleep'],
    evidence: [],
  };
  let seenContext = '';
  const mocked =
    '```json\n' +
    JSON.stringify({
      soap: { S: 'Patient reports low mood', O: 'Flat affect observed', A: 'MDD moderate', P: 'Start SSRI, follow up 2 weeks' },
      prescriptions: [{ drugName: 'Sertraline', dosage: '50mg', frequency: 'once daily', instructions: 'after food for 14 days' }],
      finalDiagnosis: 'Major depressive disorder, moderate',
      evidence: [{ section: 'S', claim: 'patient reports low mood', quote: 'I feel low', speaker: 'patient' }],
    }) +
    '\n```';
  const out = await synthesizeDoctorDecision({
    audioBase64: FAKE_AUDIO,
    cycle1Context: cycle1,
    generateContent: (input) => {
      seenContext = input.contextText ?? '';
      return Promise.resolve(mocked);
    },
  });
  assert.equal(out.soap.S, 'Patient reports low mood');
  assert.equal(out.soap.P, 'Start SSRI, follow up 2 weeks');
  assert.equal(out.prescriptions.length, 1);
  assert.equal(out.prescriptions[0]?.drugName, 'Sertraline');
  assert.equal(out.finalDiagnosis, 'Major depressive disorder, moderate');
  assert.ok(seenContext.includes('Low mood'), 'cycle 1 context must be forwarded to cycle 2');
  // Evidence carries a speaker label through to the wire (single-speaker quotes).
  assert.deepEqual(out.evidence, [{ section: 'S', claim: 'patient reports low mood', quote: 'I feel low', speaker: 'patient' }]);
}

// ---------------------------------------------------------------------------
// 6. Validators: accept the contract shapes, reject blanks/strict violations.
// ---------------------------------------------------------------------------
{
  assert.equal(createSessionSchema.safeParse({ patientId: 'p1' }).success, true);
  assert.equal(createSessionSchema.safeParse({ patientId: 'p1', queueEntryId: 'q1' }).success, true);
  assert.equal(createSessionSchema.safeParse({}).success, false);
  assert.equal(createSessionSchema.safeParse({ patientId: 'p1', extra: 1 }).success, false);

  assert.equal(audioUploadSchema.safeParse({ audioBase64: FAKE_AUDIO }).success, true);
  assert.equal(audioUploadSchema.safeParse({ audioBase64: FAKE_AUDIO, mimeType: 'audio/webm' }).success, true);
  assert.equal(audioUploadSchema.safeParse({ audioBase64: '!!!not-base64!!!' }).success, false);
  assert.equal(audioUploadSchema.safeParse({}).success, false);

  const commitOk = {
    soap: { S: 's', O: 'o', A: 'a', P: 'p' },
    prescriptions: [{ drugName: 'Sertraline', dosage: '50mg', frequency: 'once daily', instructions: 'after food' }],
    diagnoses: ['MDD'],
  };
  assert.equal(commitSessionSchema.safeParse(commitOk).success, true);
  assert.equal(
    commitSessionSchema.safeParse({ soap: { S: 's', O: 'o', A: 'a' } }).success,
    false,
    'SOAP must be complete S/O/A/P',
  );
  assert.equal(
    commitSessionSchema.safeParse({ soap: { S: 's', O: 'o', A: 'a', P: 'p' }, prescriptions: [{ drugName: '' }] }).success,
    false,
  );

  // Decision 4: optional canonical MSE reuses the BE-501 shape (explicit finding
  // or NOT_PERFORMED sentinel); unknown keys/missing domains are rejected.
  assert.equal(
    commitSessionSchema.safeParse({
      soap: { S: 's', O: 'o', A: 'a', P: 'p' },
      mse: { appearance: 'Calm', behavior: 'Cooperative', speechCoherence: 'Coherent', moodAffect: 'Euthymic' },
    }).success,
    true,
  );
  assert.equal(
    commitSessionSchema.safeParse({
      soap: { S: 's', O: 'o', A: 'a', P: 'p' },
      mse: { appearance: 'NOT_PERFORMED', behavior: 'NOT_PERFORMED', speechCoherence: 'NOT_PERFORMED', moodAffect: 'NOT_PERFORMED' },
    }).success,
    true,
  );
  assert.equal(
    commitSessionSchema.safeParse({
      soap: { S: 's', O: 'o', A: 'a', P: 'p' },
      mse: { appearance: 'Calm', behavior: 'Cooperative', speechCoherence: 'Coherent' },
    }).success,
    false,
  ); // all four domains required
  assert.equal(
    commitSessionSchema.safeParse({
      soap: { S: 's', O: 'o', A: 'a', P: 'p' },
      mse: { appearance: '', behavior: 'Calm', speechCoherence: 'Coherent', moodAffect: 'Euthymic' },
    }).success,
    false,
  ); // empty finding rejected
}

// ---------------------------------------------------------------------------
// 7. Full 2-cycle flow with mocked Gemini + mocked DB: start -> c1 -> c2 ->
//    commit creates Encounter (SCRIBE) + Medication rows, marks COMMITTED
//    atomically with the session row (Sprint-6 durability).
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);

  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
  assert.equal(started.status, 'UPLOADED');
  assert.ok(started.sessionId.length > 0);
  // Decision 4: the create response carries the FULL canonical session shape so
  // the client store hydrates consent + retention from the create response alone.
  assert.equal(started.mode, 'AMBIENT_LIVE');
  assert.equal(started.consentStatus, 'GRANTED');
  assert.equal(typeof started.audioRetentionUntil, 'string');

  const cycle1Json = JSON.stringify({
    chiefComplaint: 'Low mood for two weeks',
    symptoms: ['insomnia', 'anhedonia'],
    moodAndAffect: 'Depressed mood, restricted affect',
    suggestions: ['Verify sleep pattern'],
  });
  const c1 = await runCycle1Consultation(
    started.sessionId,
    { audioBase64: FAKE_AUDIO, mimeType: 'audio/webm' },
    DOCTOR,
    { generateContent: () => Promise.resolve(cycle1Json), saveAudio: noopSaveAudio },
    db,
  );
  assert.equal(c1.sessionId, started.sessionId);
  assert.equal(c1.analysis.chiefComplaint, 'Low mood for two weeks');
  // Decision 4: suggestions are renderable {text, provenance} objects (was string[]).
  assert.deepEqual(c1.analysis.suggestions, [{ text: 'Verify sleep pattern', provenance: 'AI' }]);
  // R2: the WIRE name is `moodAffect` (the provider-internal `moodAndAffect` is
  // normalized exactly once, in toCycle1Response). A drift back to the internal
  // name leaves this key undefined and blanks both review surfaces.
  assert.equal(c1.analysis.moodAffect, 'Depressed mood, restricted affect');
  assert.equal('moodAndAffect' in c1.analysis, false, 'internal provider key must not leak to the wire');

  const cycle2Json = JSON.stringify({
    soap: { S: 'Low mood x2w', O: 'Restricted affect', A: 'MDD moderate', P: 'Sertraline + follow-up 2w' },
    prescriptions: [{ drugName: 'Sertraline', dosage: '50mg', frequency: 'once daily', instructions: 'after food' }],
    finalDiagnosis: 'Major depressive disorder, moderate',
  });
  const c2 = await runCycle2DoctorDecision(
    started.sessionId,
    { audioBase64: FAKE_AUDIO, mimeType: 'audio/webm' },
    DOCTOR,
    { generateContent: () => Promise.resolve(cycle2Json), saveAudio: noopSaveAudio },
    db,
  );
  assert.equal(c2.soap.A, 'MDD moderate');
  assert.equal(c2.prescriptions[0]?.dosage, '50mg');

  // Commit with a doctor edit (dosage changed) — edited values win. The exam
  // findings captured in the studio reach the encounter (Decision 4).
  const committed = await commitScribeSession(
    started.sessionId,
    {
      soap: { S: 'Low mood x2w', O: 'Restricted affect', A: 'MDD moderate', P: 'Sertraline + follow-up 2w' },
      mse: { appearance: 'Dishevelled', behavior: 'Guarded', speechCoherence: 'Slowed', moodAffect: 'Depressed' },
      prescriptions: [{ drugName: 'Sertraline', dosage: '25mg', frequency: 'once daily', instructions: 'after food' }],
      diagnoses: ['Major depressive disorder, moderate'],
    },
    DOCTOR,
    db,
  );
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(state.sessions.get(started.sessionId)?.status, 'COMMITTED', 'session row flips to COMMITTED in the commit tx');
  assert.equal(state.sessions.get(started.sessionId)?.encounterRef, committed.encounterId, 'encounterRef links the committed encounter');
  assert.equal(state.encounters.length, 1, 'commit must create exactly one Encounter');
  assert.equal(state.medications.length, 1, 'commit must create one Medication row');
  const encData = state.encounters[0]?.data as Record<string, unknown>;
  assert.equal(encData['source'], 'SCRIBE');
  assert.equal(encData['soapAssessment'], 'MDD moderate');
  assert.equal(encData['status'], 'SIGNED');
  assert.equal(encData['originScribeDraftRef'], started.sessionId);
  assert.equal(encData['mseAppearance'], 'Dishevelled', 'doctor MSE reaches the encounter');
  assert.equal(encData['mseBehavior'], 'Guarded');
  assert.equal(encData['mseSpeechCoherence'], 'Slowed');
  assert.equal(encData['mseMoodAffect'], 'Depressed');
  const medData = state.medications[0]?.data as Record<string, unknown>;
  assert.equal(medData['drugName'], 'Sertraline');
  assert.equal(medData['dosage'], '25mg', 'edited dosage must persist');
  assert.equal(medData['encounterRef'], committed.encounterId);

  // Double commit -> 409 CONFLICT.
  let doubleCommit: unknown = null;
  try {
    await commitScribeSession(
      started.sessionId,
      { soap: { S: 's', O: 'o', A: 'a', P: 'p' } },
      DOCTOR,
      db,
    );
  } catch (err) {
    doubleCommit = err;
  }
  assert.ok(doubleCommit instanceof AppError && doubleCommit.code === 'CONFLICT');

  // Purge preserves the committed records (encounter stays), reports purged.
  const purged = await purgeScribeAudioFiles(
    started.sessionId,
    DOCTOR,
    { purgeAudioFiles: noopPurgeAudio },
    db,
  );
  assert.equal(purged.purged, true);
  assert.equal(purged.status, 'COMMITTED', 'manual purge preserves the COMMITTED status');
  assert.equal(state.encounters.length, 1, 'purge must preserve Encounter records');
}

// ---------------------------------------------------------------------------
// 7b. Commit WITHOUT mse: every MSE domain records the explicit NOT_PERFORMED
//     sentinel (the exam matrix was skipped) — values are never invented.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);
  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
  await runCycle1Consultation(
    started.sessionId,
    { audioBase64: FAKE_AUDIO },
    DOCTOR,
    { generateContent: () => Promise.resolve(JSON.stringify({ chiefComplaint: 'c', symptoms: [], moodAndAffect: 'm', suggestions: [] })), saveAudio: noopSaveAudio },
    db,
  );
  await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
  const encData = state.encounters[0]?.data as Record<string, unknown>;
  assert.equal(encData['mseAppearance'], 'NOT_PERFORMED');
  assert.equal(encData['mseBehavior'], 'NOT_PERFORMED');
  assert.equal(encData['mseSpeechCoherence'], 'NOT_PERFORMED');
  assert.equal(encData['mseMoodAffect'], 'NOT_PERFORMED');
}

// ---------------------------------------------------------------------------
// 8. Commit before Cycle 1 -> 422; Cycle 2 before Cycle 1 -> 422.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);
  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);

  let earlyCommit: unknown = null;
  try {
    await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
  } catch (err) {
    earlyCommit = err;
  }
  assert.ok(earlyCommit instanceof AppError && earlyCommit.code === 'UNPROCESSABLE');

  let earlyCycle2: unknown = null;
  try {
    await runCycle2DoctorDecision(
      started.sessionId,
      { audioBase64: FAKE_AUDIO },
      DOCTOR,
      { generateContent: () => Promise.resolve('{}'), saveAudio: noopSaveAudio },
      db,
    );
  } catch (err) {
    earlyCycle2 = err;
  }
  assert.ok(earlyCycle2 instanceof AppError && earlyCycle2.code === 'UNPROCESSABLE');
}

// ---------------------------------------------------------------------------
// 9. All scribe endpoints are DOCTOR-gated: SECRETARY gets 403 FORBIDDEN.
// ---------------------------------------------------------------------------
{
  let forwarded: unknown = 'none';
  requireRole('DOCTOR')(mockReq('SECRETARY'), mockRes(), (err?: unknown) => {
    forwarded = err;
  });
  assert.ok(forwarded instanceof AppError);
  assert.equal((forwarded as AppError).code, 'FORBIDDEN');
  assert.equal((forwarded as AppError).statusCode, 403);

  let passed = false;
  requireRole('DOCTOR')(mockReq('DOCTOR'), mockRes(), (err?: unknown) => {
    assert.equal(err, undefined);
    passed = true;
  });
  assert.equal(passed, true);
}

// ---------------------------------------------------------------------------
// 10. BE-602 consent gate: AMBIENT_LIVE without consentConfirmed -> 422
//     CONSENT_REQUIRED; dictation mode does not require the ambient flag.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);

  let consentErr: unknown = null;
  try {
    await startScribeSession({ patientId: 'patient-1', mode: 'AMBIENT_LIVE' }, DOCTOR, db);
  } catch (err) {
    consentErr = err;
  }
  assert.ok(consentErr instanceof AppError && consentErr.code === 'CONSENT_REQUIRED');
  assert.equal((consentErr as AppError).statusCode, 422);
  assert.equal(state.sessions.size, 0, 'rejected consent must not persist a session');

  const dictation = await startScribeSession({ patientId: 'patient-1', mode: 'DICTATION_60S' }, DOCTOR, db);
  assert.equal(dictation.status, 'UPLOADED');
  assert.equal(state.sessions.get(dictation.sessionId)?.mode, 'DICTATION_60S');
}

// ---------------------------------------------------------------------------
// 11. BE-604 DB-15 consent withdrawal: locks the session (cycles/commit ->
//     WITHDRAWN_GONE), purges audio, records withdrawal reason, audits.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);
  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);

  let purgedCalled = 0;
  const withdrawn = await withdrawConsentScribeSession(
    started.sessionId,
    { reason: 'Patient revoked audio recording consent' },
    DOCTOR,
    {
      purgeAudioFiles: () => {
        purgedCalled += 1;
        return Promise.resolve({ purgedFiles: [] });
      },
    },
    db,
  );
  assert.equal(withdrawn.status, 'WITHDRAWN');
  assert.equal(withdrawn.audioPurged, true);
  assert.equal(typeof withdrawn.retentionUntil, 'string', 'withdraw response carries ISO retentionUntil');
  assert.ok(withdrawn.withdrawnAt !== undefined, 'withdraw response carries withdrawnAt');
  assert.equal(purgedCalled, 1, 'withdrawal must purge audio from disk exactly once');

  const row = state.sessions.get(started.sessionId);
  assert.equal(row?.status, 'WITHDRAWN');
  assert.equal(row?.consentStatus, 'WITHDRAWN');
  assert.equal(row?.audioReference, null, 'audio reference is nulled on withdrawal');
  assert.equal(row?.withdrawalReason, 'Patient revoked audio recording consent');
  assert.ok(state.audits.some((a) => a.action === 'CONSENT_WITHDRAWN'), 'audit CONSENT_WITHDRAWN written');

  // Post-withdraw cycle 1 -> WITHDRAWN_GONE; commit -> WITHDRAWN_GONE.
  let cycleAfter: unknown = null;
  try {
    await runCycle1Consultation(
      started.sessionId,
      { audioBase64: FAKE_AUDIO },
      DOCTOR,
      { generateContent: () => Promise.resolve('{}'), saveAudio: noopSaveAudio },
      db,
    );
  } catch (err) {
    cycleAfter = err;
  }
  assert.ok(cycleAfter instanceof AppError && cycleAfter.code === 'WITHDRAWN_GONE');

  let commitAfter: unknown = null;
  try {
    await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
  } catch (err) {
    commitAfter = err;
  }
  assert.ok(commitAfter instanceof AppError && commitAfter.code === 'WITHDRAWN_GONE');

  // Double withdraw -> 409 CONFLICT.
  let doubleWithdraw: unknown = null;
  try {
    await withdrawConsentScribeSession(started.sessionId, {}, DOCTOR, { purgeAudioFiles: noopPurgeAudio }, db);
  } catch (err) {
    doubleWithdraw = err;
  }
  assert.ok(doubleWithdraw instanceof AppError && doubleWithdraw.code === 'CONFLICT');

  // withdraw-consent validator: empty body valid; oversized reason rejected.
  assert.equal(withdrawConsentSchema.safeParse(undefined).success, true, 'missing body defaults to {}');
  assert.equal(withdrawConsentSchema.safeParse({}).success, true, 'empty body valid');
  assert.equal(withdrawConsentSchema.safeParse({ reason: 'x'.repeat(301) }).success, false, 'reason capped at 300');
}

// ---------------------------------------------------------------------------
// 12. BE-604 retention worker: expired sessions get bytes purged + ref nulled;
//     in-flight sessions become PURGED, committed ones keep COMMITTED.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 86_400_000);
  const base = {
    patientId: 'p1',
    mode: 'AMBIENT_LIVE',
    queueEntryRef: null,
    encounterRef: null,
    createdByUserId: 'doctor-1',
    consentStatus: 'GRANTED',
    withdrawnAt: null,
    withdrawalReason: null,
    createdAt: new Date('2026-10-14T10:00:00Z'),
  };
  state.sessions.set('expired-active', {
    ...base,
    id: 'expired-active',
    status: 'TRANSCRIBED',
    audioReference: '/tmp/expired-active.cycle-1.webm',
    audioRetentionUntil: past,
  });
  state.sessions.set('expired-committed', {
    ...base,
    id: 'expired-committed',
    status: 'COMMITTED',
    encounterRef: 'enc-1',
    audioReference: '/tmp/expired-committed.cycle-1.webm',
    audioRetentionUntil: past,
  });
  state.sessions.set('fresh', {
    ...base,
    id: 'fresh',
    status: 'TRANSCRIBED',
    audioReference: '/tmp/fresh.cycle-1.webm',
    audioRetentionUntil: future,
  });
  const db = makeFakeDb(state);

  const purgedIds: string[] = [];
  const result = await purgeExpiredScribeAudio(db, {
    purgeAudioFiles: (sessionId: string) => {
      purgedIds.push(sessionId);
      return Promise.resolve({ purgedFiles: [] });
    },
  });
  assert.equal(result.purged, 2, 'only expired sessions with audio refs are purged');
  assert.deepEqual([...purgedIds].sort(), ['expired-active', 'expired-committed']);
  assert.equal(state.sessions.get('expired-active')?.status, 'PURGED');
  assert.equal(state.sessions.get('expired-active')?.audioReference, null);
  assert.equal(state.sessions.get('expired-committed')?.status, 'COMMITTED', 'committed sessions keep COMMITTED after retention purge');
  assert.equal(state.sessions.get('fresh')?.status, 'TRANSCRIBED', 'unexpired sessions are untouched');
  assert.equal(state.audits.filter((a) => a.action === 'AUDIO_PURGED').length, 2, 'one AUDIO_PURGED audit per purged session');
}

// ---------------------------------------------------------------------------
// 12b. R1: the retention status flip is conditional — a session whose status
//      changed between the worker's read and its write is skipped (no clobber
//      of a concurrently COMMITTED session), and no AUDIO_PURGED audit is
//      written for it. The mutation is injected inside the purge await, i.e.
//      exactly between the read and the conditional write.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const past = new Date(Date.now() - 60_000);
  state.sessions.set('raced', {
    id: 'raced',
    patientId: 'p1',
    mode: 'AMBIENT_LIVE',
    queueEntryRef: null,
    encounterRef: null,
    createdByUserId: 'doctor-1',
    consentStatus: 'GRANTED',
    withdrawnAt: null,
    withdrawalReason: null,
    createdAt: new Date('2026-10-14T10:00:00Z'),
    status: 'TRANSCRIBED',
    audioReference: '/tmp/raced.cycle-1.webm',
    audioRetentionUntil: past,
  });
  const db = makeFakeDb(state);
  let mutated = false;
  const result = await purgeExpiredScribeAudio(db, {
    purgeAudioFiles: () => {
      if (!mutated) {
        mutated = true;
        // A concurrent commit claims the row while the worker is purging:
        const row = state.sessions.get('raced')!;
        row.status = 'COMMITTED';
        row.encounterRef = 'enc-raced';
      }
      return Promise.resolve({ purgedFiles: [] });
    },
  });
  assert.equal(result.purged, 0, 'a raced session must not be flipped to PURGED');
  assert.equal(state.sessions.get('raced')?.status, 'COMMITTED', 'COMMITTED survives the retention pass');
  assert.equal(state.sessions.get('raced')?.audioReference, '/tmp/raced.cycle-1.webm', 'raced session keeps its reference until the next pass re-evaluates');
  assert.equal(state.audits.filter((a) => a.action === 'AUDIO_PURGED').length, 0, 'no audit for a skipped session');
}

// ---------------------------------------------------------------------------
// 13. R1 commit-claim fallback mapping: when the in-transaction status claim
//     matches 0 rows (a concurrent request won the row), the fresh status
//     decides the error — never a 500, never a second encounter.
// ---------------------------------------------------------------------------
{
  // Lost race vs. a concurrent commit (fresh status COMMITTED) -> 409 CONFLICT.
  {
    const state = emptyState();
    const db = makeFakeDb(state);
    const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
    await runCycle1Consultation(
      started.sessionId,
      { audioBase64: FAKE_AUDIO },
      DOCTOR,
      { generateContent: () => Promise.resolve(JSON.stringify({ chiefComplaint: 'c', symptoms: [], moodAndAffect: 'm', suggestions: [] })), saveAudio: noopSaveAudio },
      db,
    );
    state.forceClaimFailure = true;
    state.sessions.get(started.sessionId)!.status = 'COMMITTED';
    let thrown: unknown = null;
    try {
      await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AppError && thrown.code === 'CONFLICT');
    assert.equal(state.encounters.length, 0, 'lost claim must not create an encounter');
  }
  // Lost race vs. a concurrent withdrawal (fresh status WITHDRAWN) -> WITHDRAWN_GONE.
  {
    const state = emptyState();
    const db = makeFakeDb(state);
    const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
    await runCycle1Consultation(
      started.sessionId,
      { audioBase64: FAKE_AUDIO },
      DOCTOR,
      { generateContent: () => Promise.resolve(JSON.stringify({ chiefComplaint: 'c', symptoms: [], moodAndAffect: 'm', suggestions: [] })), saveAudio: noopSaveAudio },
      db,
    );
    state.forceClaimFailure = true;
    state.sessions.get(started.sessionId)!.status = 'WITHDRAWN';
    let thrown: unknown = null;
    try {
      await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AppError && thrown.code === 'WITHDRAWN_GONE');
    assert.equal(state.encounters.length, 0, 'no encounter may be committed for a withdrawn session');
  }
  // Lost race vs. retention purge (fresh status PURGED) -> 410 GONE.
  {
    const state = emptyState();
    const db = makeFakeDb(state);
    const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
    await runCycle1Consultation(
      started.sessionId,
      { audioBase64: FAKE_AUDIO },
      DOCTOR,
      { generateContent: () => Promise.resolve(JSON.stringify({ chiefComplaint: 'c', symptoms: [], moodAndAffect: 'm', suggestions: [] })), saveAudio: noopSaveAudio },
      db,
    );
    state.forceClaimFailure = true;
    state.sessions.get(started.sessionId)!.status = 'PURGED';
    let thrown: unknown = null;
    try {
      await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AppError && thrown.code === 'GONE');
    assert.equal(state.encounters.length, 0);
  }
  // Claim matched 0 rows with no committed/withdrawn/purged winner -> the
  // session never completed cycle 1 -> 422 UNPROCESSABLE (never a 500).
  {
    const state = emptyState();
    const db = makeFakeDb(state);
    const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
    state.forceClaimFailure = true;
    let thrown: unknown = null;
    try {
      await commitScribeSession(started.sessionId, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, db);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AppError && thrown.code === 'UNPROCESSABLE' && thrown.statusCode === 422);
    assert.equal(state.encounters.length, 0);
  }
}

// ---------------------------------------------------------------------------
// 14. R1 withdraw-claim fallback: a withdrawal that loses the row race against
//     an already-WITHDRAWN/PURGED session surfaces 409 CONFLICT (not 400).
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);
  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);
  state.forceClaimFailure = true;
  state.sessions.get(started.sessionId)!.status = 'WITHDRAWN';
  let thrown: unknown = null;
  try {
    await withdrawConsentScribeSession(started.sessionId, {}, DOCTOR, { purgeAudioFiles: noopPurgeAudio }, db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError && thrown.code === 'CONFLICT' && thrown.statusCode === 409);

  state.sessions.get(started.sessionId)!.status = 'PURGED';
  thrown = null;
  try {
    await withdrawConsentScribeSession(started.sessionId, {}, DOCTOR, { purgeAudioFiles: noopPurgeAudio }, db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError && thrown.code === 'CONFLICT' && thrown.statusCode === 409);
}

// ---------------------------------------------------------------------------
// Cycle 0 (Groq path): transcript cleanup schema + rendering.
// ---------------------------------------------------------------------------
{
  assert.equal(typeof CYCLE_0_CLEANUP_PROMPT, 'string');
  assert.ok(CYCLE_0_CLEANUP_PROMPT.includes('segments'), 'cleanup prompt must document segments');
  assert.ok(CYCLE_0_CLEANUP_PROMPT.includes('speaker'), 'cleanup prompt must document speaker labels');

  const good = cleanupTranscriptSchema.safeParse({
    segments: [
      { speaker: 'doctor', text: 'مساء الخير، إيه اللي جايبك النهارده؟' },
      { speaker: 'patient', text: 'مش عارف أنام من ثلاثة أسابيع.' },
    ],
  });
  assert.equal(good.success, true);
  assert.equal(
    renderCleanedTranscript([
      { speaker: 'doctor', text: 'أ' },
      { speaker: 'patient', text: 'ب' },
      { speaker: 'unsure', text: 'ج' },
    ]),
    'الدكتور: أ\nالمريضة: ب\nغير مؤكد: ج',
  );
  assert.equal(
    cleanupTranscriptSchema.safeParse({ segments: [{ speaker: 'nurse', text: 'x' }] }).success,
    false,
    'unknown speaker must be rejected',
  );
  assert.equal(
    cleanupTranscriptSchema.safeParse({ segments: [{ speaker: 'doctor', text: '', extra: 1 }] }).success,
    false,
    'strict segment shape must be enforced',
  );
}

// ---------------------------------------------------------------------------
// Groq 3-stage reuse: same Cycle-2 bytes reuse the cleaned transcript with
// ZERO extra STT/cleanup calls (one extra qwen call per session, max).
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);

  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);

  const cycle1Json = JSON.stringify({
    chiefComplaint: 'Follow-up anxiety',
    symptoms: ['broken sleep'],
    moodAndAffect: 'Stable',
    suggestions: ['Keep sleep hygiene'],
    evidence: [],
  });
  const cycle2Json = JSON.stringify({
    soap: { S: 's', O: 'o', A: 'a', P: 'p' },
    prescriptions: [],
    finalDiagnosis: 'GAD',
    evidence: [],
  });

  let transcribes = 0;
  let cleanups = 0;
  let analyzes = 0;
  const stages = {
    transcribe: async (): Promise<string> => {
      transcribes += 1;
      return 'RAW';
    },
    cleanup: async (): Promise<{ segments: { speaker: 'patient'; text: string }[]; cleanedText: string }> => {
      cleanups += 1;
      return { segments: [{ speaker: 'patient' as const, text: 'x' }], cleanedText: 'المريضة: x' };
    },
    analyze: async (input: { systemPrompt: string }): Promise<string> => {
      analyzes += 1;
      return input.systemPrompt.includes('INITIAL SESSION ANALYSIS') ? cycle1Json : cycle2Json;
    },
  };
  const deps = { groqStages: stages, saveAudio: noopSaveAudio };

  const c1 = await runCycle1Consultation(started.sessionId, { audioBase64: FAKE_AUDIO }, DOCTOR, deps, db);
  assert.equal(transcribes, 1, 'cycle 1 transcribes once');
  assert.equal(cleanups, 1, 'cycle 1 cleans once');
  assert.equal(analyzes, 1, 'cycle 1 analyzes once');
  assert.equal(c1.analysis.transcript?.cleanedText, 'المريضة: x', 'cleaned transcript reaches the wire');

  // Same bytes for Cycle 2 (the UI sends one recording for both cycles).
  await runCycle2DoctorDecision(started.sessionId, { audioBase64: FAKE_AUDIO }, DOCTOR, deps, db);
  assert.equal(transcribes, 1, 'same audio must NOT re-transcribe');
  assert.equal(cleanups, 1, 'same audio must NOT re-clean');
  assert.equal(analyzes, 2, 'cycle 2 analyzes once more (the single extra call)');

  // Different bytes (fresh dictation) run the full pipeline again.
  const OTHER_AUDIO = Buffer.from('different-audio-bytes').toString('base64');
  await runCycle2DoctorDecision(started.sessionId, { audioBase64: OTHER_AUDIO }, DOCTOR, deps, db);
  assert.equal(transcribes, 2, 'new audio must transcribe again');
  assert.equal(cleanups, 2, 'new audio must clean again');
  assert.equal(analyzes, 3, 'new audio analyzes again');
}

// ---------------------------------------------------------------------------
// 18. P1-8: Cancel, stop, and delete pending scribe sessions (committed sessions protected).
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);

  // A. Cancel pending session
  const s1 = await startScribeSession(CONSENTED_START, DOCTOR, db);
  let purgedAudio = false;
  const testDeps = {
    purgeAudioFiles: async () => {
      purgedAudio = true;
      return { purgedFiles: ['/tmp/audio1'] };
    },
  };
  const cancelRes = await cancelScribeSession(s1.sessionId, { reason: 'Cancelled by user' }, DOCTOR, testDeps, db);
  assert.equal(cancelRes.status, 'WITHDRAWN');
  assert.equal(cancelRes.cancelled, true);
  assert.equal(purgedAudio, true);
  assert.ok(
    state.audits.some((a) => a.action === 'CONSENT_WITHDRAWN' && a.entityId === s1.sessionId),
    'audit records session cancellation',
  );

  // B. Stop pending session
  const s2 = await startScribeSession(CONSENTED_START, DOCTOR, db);
  const stopRes = await stopScribeSession(s2.sessionId, { reason: 'Doctor stopped recording' }, DOCTOR, db);
  assert.equal(stopRes.sessionId, s2.sessionId);
  assert.ok(stopRes.stoppedAt, 'stopRes returns stoppedAt');
  assert.ok(
    state.audits.some((a) => a.action === 'CONSENT_WITHDRAWN' && a.entityId === s2.sessionId),
    'audit records session stop',
  );

  // C. Delete pending session + drafts
  const s3 = await startScribeSession(CONSENTED_START, DOCTOR, db);
  state.drafts.push({ id: 'draft-del-1', scribeSessionId: s3.sessionId });
  purgedAudio = false;
  const delRes = await deleteScribeSession(s3.sessionId, { reason: 'Doctor deleted draft' }, DOCTOR, testDeps, db);
  assert.equal(delRes.deleted, true);
  assert.equal(state.sessions.has(s3.sessionId), false, 'session row deleted');
  assert.equal(
    state.drafts.some((d) => d['scribeSessionId'] === s3.sessionId),
    false,
    'session drafts deleted',
  );
  assert.ok(
    state.audits.some((a) => a.action === 'ENCOUNTER_DISCARD' && a.entityId === s3.sessionId),
    'audit records session deletion',
  );

  // D. Committed sessions are protected against cancel, stop, and delete
  const s4 = await startScribeSession(CONSENTED_START, DOCTOR, db);
  const row4 = state.sessions.get(s4.sessionId)!;
  row4.status = 'COMMITTED';

  await assert.rejects(
    () => cancelScribeSession(s4.sessionId, {}, DOCTOR, testDeps, db),
    (err: AppError) => err.code === 'CONFLICT' && err.statusCode === 409,
    'committed session cannot be cancelled',
  );

  await assert.rejects(
    () => stopScribeSession(s4.sessionId, {}, DOCTOR, db),
    (err: AppError) => err.code === 'CONFLICT' && err.statusCode === 409,
    'committed session cannot be stopped',
  );

  await assert.rejects(
    () => deleteScribeSession(s4.sessionId, {}, DOCTOR, testDeps, db),
    (err: AppError) => err.code === 'CONFLICT' && err.statusCode === 409,
    'committed session cannot be deleted',
  );
}

// ---------------------------------------------------------------------------
// 19. P1-9: Scribe cycle failure marks session FAILED, retry recovers without reload.
// ---------------------------------------------------------------------------
{
  const state = emptyState();
  const db = makeFakeDb(state);

  const started = await startScribeSession(CONSENTED_START, DOCTOR, db);

  const cycle1Json = JSON.stringify({
    chiefComplaint: 'Follow-up anxiety',
    symptoms: ['broken sleep'],
    moodAndAffect: 'Stable',
    suggestions: ['Keep sleep hygiene'],
    evidence: [],
  });

  let shouldFail = true;
  const stages = {
    transcribe: async (): Promise<string> => {
      if (shouldFail) throw new Error('Simulated STT outage');
      return 'RAW';
    },
    cleanup: async () => ({ segments: [{ speaker: 'patient' as const, text: 'x' }], cleanedText: 'المريضة: x' }),
    analyze: async () => cycle1Json,
  };
  const deps = { groqStages: stages, saveAudio: noopSaveAudio };

  // Cycle 1 fails
  await assert.rejects(
    () => runCycle1Consultation(started.sessionId, { audioBase64: FAKE_AUDIO }, DOCTOR, deps, db),
    /Simulated STT outage/,
  );
  assert.equal(state.sessions.get(started.sessionId)!.status, 'FAILED', 'failure marks session FAILED');

  // Retry Cycle 1 recovers
  shouldFail = false;
  const c1 = await runCycle1Consultation(started.sessionId, { audioBase64: FAKE_AUDIO }, DOCTOR, deps, db);
  assert.equal(c1.sessionId, started.sessionId);
  assert.equal(state.sessions.get(started.sessionId)!.status, 'TRANSCRIBING', 'retry moves session to TRANSCRIBING');
}

// Restore key env (do not leak test mutations).
if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
if (savedModel !== undefined) process.env['GEMINI_MODEL'] = savedModel;

// eslint-disable-next-line no-console
console.log('Sprint 6 scribe Gemini 2-cycle foundation green (mocked, no live key).');


