import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, ScribeSessionStatus } from '@prisma/client';
import type { ZodType, ZodTypeDef } from 'zod';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { isUniqueViolation } from '../../common/db/unique-violation.js';
import { writeAudit } from '../../common/audit.js';
import { sha256Hex } from '../../common/crypto/vault.js';
import { loadEnv } from '../../config/env.js';
import {
  analyzeConsultationAudio,
  cycle1AnalysisSchema,
  cycle2SynthesisSchema,
  parseJsonOrThrow,
  synthesizeDoctorDecision,
  type Cycle1Analysis,
  type Cycle2Synthesis,
  type GenerateContentFn,
} from './gemini.provider.js';
import {
  analyzeCleanedTranscript,
  cleanupTranscript,
  isGroqSelected,
  resolveGroqConfig,
  transcribeAudio,
  type TranscriptSegment,
} from './groq.provider.js';
import { CYCLE_1_ANALYSIS_PROMPT, CYCLE_2_SYNTHESIS_PROMPT } from './prompts/scribe.prompts.js';
import { purgeScribeAudio, saveScribeAudio } from './audio.store.js';
import type {
  AudioUploadInput,
  CancelSessionInput,
  CommitSessionInput,
  CreateSessionInput,
  DeleteSessionInput,
  StopSessionInput,
  WithdrawConsentInput,
} from './scribe.validators.js';

export interface DoctorActor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

/**
 * Sprint 6 scribe lifecycle is now DB-backed (BE-601..604). Session + draft
 * state lives in `ScribeSession` / `ScribeDraft` rows (durable across restarts);
 * clinical truth lives in Encounter/Medication rows after commit. The status
 * enum is the Prisma `ScribeSessionStatus`. There is NO in-memory registry.
 */
export type { ScribeSessionStatus };

/** Persisted draft analysis envelope (operational shape stored in ScribeDraft). */
interface StoredAnalysis {
  readonly cycle1: Cycle1Analysis | null;
  readonly cycle2: Cycle2Synthesis | null;
  /** Cleaned session transcript (Groq 3-stage path; null on the legacy path). */
  readonly transcript: StoredTranscript | null;
  /** Cleaned Cycle-2 decision audio transcript, when a second audio ran. */
  readonly decisionTranscript: StoredTranscript | null;
}

/** Cleaned transcript as persisted (retrievable by patient + session date). */
export interface StoredTranscript {
  readonly raw: string;
  readonly cleaned: string;
  readonly segments: TranscriptSegment[];
  readonly cleanedAt: string;
  readonly model: string;
  /** sha256 of the source audio base64 — same bytes reuse the transcript. */
  readonly audioHash: string;
}

/** Retention window for scribe audio (days), from env (default 30). */
function audioRetentionDays(): number {
  try {
    return loadEnv().AUDIO_RETENTION_DAYS;
  } catch {
    return 30;
  }
}

async function requireSessionRow(db: PrismaClient, sessionId: string) {
  const row = await db.scribeSession.findUnique({ where: { id: sessionId } });
  if (row === null) throw new AppError('NOT_FOUND', 'Scribe session not found');
  return row;
}

function assertNotWithdrawnOrPurged(status: ScribeSessionStatus): void {
  if (status === 'WITHDRAWN') {
    throw new AppError('WITHDRAWN_GONE', 'Consent was withdrawn; this session is locked');
  }
  if (status === 'PURGED') {
    throw new AppError('GONE', 'Scribe session audio was purged; this session is locked');
  }
}

async function assertPatientExists(
  db: PrismaClient,
  patientId: string,
): Promise<void> {
  const row = await db.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (row === null) throw new AppError('NOT_FOUND', 'Patient not found');
}

/** Read the latest persisted draft analysis for a session (null if none). */
async function loadStoredAnalysis(
  db: PrismaClient,
  sessionId: string,
): Promise<StoredAnalysis> {
  const empty: StoredAnalysis = { cycle1: null, cycle2: null, transcript: null, decisionTranscript: null };
  const draft = await db.scribeDraft.findFirst({
    where: { scribeSessionId: sessionId },
    orderBy: { version: 'desc' },
  });
  if (draft === null) return empty;
  const snapshot = draft.mseSnapshot as unknown;
  if (typeof snapshot === 'object' && snapshot !== null && 'analysis' in snapshot) {
    const analysis = (snapshot as { analysis: unknown }).analysis;
    if (typeof analysis === 'object' && analysis !== null) {
      const a = analysis as Partial<StoredAnalysis>;
      return {
        cycle1: (a.cycle1 ?? null) as StoredAnalysis['cycle1'],
        cycle2: (a.cycle2 ?? null) as StoredAnalysis['cycle2'],
        transcript: (a.transcript ?? null) as StoredAnalysis['transcript'],
        decisionTranscript: (a.decisionTranscript ?? null) as StoredAnalysis['decisionTranscript'],
      };
    }
  }
  return empty;
}

export interface ScribeTestDeps {
  readonly generateContent?: GenerateContentFn;
  readonly saveAudio?: typeof saveScribeAudio;
  readonly purgeAudioFiles?: typeof purgeScribeAudio;
  /**
   * Groq 3-stage seam (tests only): stage mocks with call counting.
   * Production omits it and the real Whisper/cleanup/chat stages run.
   */
  readonly groqStages?: {
    readonly transcribe: (input: { audioBase64: string; mimeType?: string }) => Promise<string>;
    readonly cleanup: (
      raw: string,
      ctx: { patientName: string; sessionDate: string },
    ) => Promise<{ segments: TranscriptSegment[]; cleanedText: string }>;
    readonly analyze: (input: { systemPrompt: string; cleanedText: string; contextText?: string }) => Promise<string>;
  };
}

/**
 * Groq 3-stage path selector: explicit test mocks always win (legacy audio
 * seam); otherwise SCRIBE_PROVIDER picks Groq transcription+cleanup+analysis
 * or the legacy direct-audio path (Gemini code kept, disabled by default).
 */
function useGroqPipeline(deps: ScribeTestDeps): boolean {
  if (deps.generateContent !== undefined) return false;
  return isGroqSelected();
}

/** Wire shape of a Cycle-1 suggestion (renderable, provenance-tagged). */
export interface Cycle1SuggestionDto {
  readonly text: string;
  readonly provenance: 'AI';
}

export interface Cycle1AnalysisResponse {
  readonly chiefComplaint: string;
  readonly symptoms: readonly string[];
  /**
   * CANONICAL WIRE NAME (post-review fix H1): the Gemini provider schema calls
   * this field `moodAndAffect` internally, but every consumer-facing surface —
   * the MSE vocabulary, the frontend models, and both review templates — uses
   * `moodAffect`. The mapping below is the single normalization point; the
   * wire contract (API_CONTRACTS.md) and the FE model must stay `moodAffect`.
   */
  readonly moodAffect: string;
  readonly suggestions: readonly Cycle1SuggestionDto[];
  /** Audio evidence grounding each statement (claim + verbatim quote). */
  readonly evidence: readonly Cycle1EvidenceDto[];
  /** Cleaned, speaker-segmented transcript (Groq path; null on legacy path). */
  readonly transcript: {
    readonly cleanedText: string;
    readonly segments: readonly { speaker: 'doctor' | 'patient' | 'unsure'; text: string }[];
  } | null;
}

/** Wire shape of one audio evidence item (verifiable before sign-off). */
export interface Cycle1EvidenceDto {
  readonly section: string;
  readonly claim: string;
  readonly quote: string;
  readonly speaker: 'doctor' | 'patient' | 'unsure';
}

/** Map the provider analysis to the wire DTO: suggestions become tagged objects. */
function toCycle1Response(analysis: Cycle1Analysis, transcript: StoredTranscript | null): Cycle1AnalysisResponse {
  return {
    chiefComplaint: analysis.chiefComplaint,
    symptoms: analysis.symptoms,
    moodAffect: analysis.moodAndAffect,
    suggestions: analysis.suggestions.map((text) => ({ text, provenance: 'AI' as const })),
    evidence: (analysis.evidence ?? []).map((e) => ({ section: e.section, claim: e.claim, quote: e.quote, speaker: e.speaker })),
    transcript:
      transcript === null
        ? null
        : {
            cleanedText: transcript.cleaned,
            segments: transcript.segments.map((s) => ({ speaker: s.speaker, text: s.text })),
          },
  };
}

/** Session context for transcript cleanup (patient name fixes mishearings). */
async function cleanupContext(
  db: PrismaClient,
  session: { patientId: string; createdAt: unknown },
): Promise<{ patientName: string; sessionDate: string }> {
  const patient = await db.patient.findUnique({ where: { id: session.patientId }, select: { fullName: true } });
  // NOTE: the nullish fallback also covers test doubles that omit fullName.
  const fullName = patient?.fullName as unknown;
  return {
    patientName: typeof fullName === 'string' && fullName.length > 0 ? fullName : 'غير معروف',
    sessionDate: sessionDateOf(session),
  };
}

/** Defensive session-date read (fake/test rows may omit createdAt). */
function sessionDateOf(session: { createdAt: unknown }): string {
  const at = session.createdAt;
  if (at instanceof Date && !Number.isNaN(at.getTime())) return at.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/** Parse provider JSON output with a cycle schema (422 on shape mismatch). */
function parseCycleJson<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: string): T {
  const parsed = schema.safeParse(parseJsonOrThrow(raw));
  if (!parsed.success) {
    throw AppError.fromZod(parsed.error.issues);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// POST /api/v1/scribe/sessions [DOCTOR] -> 201 { sessionId, status, mode,
//   consentStatus, audioRetentionUntil }
// The FULL canonical session shape is returned so the client can hydrate its
// store (consent state + retention countdown) from the create response alone.
// ---------------------------------------------------------------------------
export async function startScribeSession(
  input: CreateSessionInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  status: 'UPLOADED';
  mode: 'AMBIENT_LIVE' | 'DICTATION_60S';
  consentStatus: 'GRANTED';
  audioRetentionUntil: string;
}> {
  await assertPatientExists(db, input.patientId);

  // BE-602 consent gate: AMBIENT recording requires explicit opt-in. Dictation
  // (doctor-initiated, short) does not require the ambient-consent flag. The
  // validator defaults mode to AMBIENT_LIVE; direct callers without a mode are
  // treated as ambient as well, so the gate can never be bypassed by omission.
  const mode = input.mode ?? 'AMBIENT_LIVE';
  if (mode === 'AMBIENT_LIVE' && input.consentConfirmed !== true) {
    throw new AppError('CONSENT_REQUIRED', 'Explicit patient consent is required for ambient recording', [
      { field: 'consentConfirmed', issue: 'must be true for AMBIENT_LIVE sessions', expected: 'true' },
    ]);
  }

  const now = new Date();
  const audioRetentionUntil = new Date(now.getTime() + audioRetentionDays() * 86_400_000);

  const created = await db.scribeSession.create({
    data: {
      patientId: input.patientId,
      ...(input.queueEntryId !== undefined ? { queueEntryRef: input.queueEntryId } : {}),
      mode,
      consentStatus: 'GRANTED',
      consentedAt: now,
      status: 'UPLOADED',
      audioRetentionUntil,
      createdByUserId: actor.userId,
    },
    select: { id: true },
  });

  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'SCRIBE_UPLOAD',
    entityType: 'ScribeSession',
    entityId: created.id,
    requestId: randomUUID(),
    afterState: { status: 'UPLOADED', mode, patientId: input.patientId },
  });
  return {
    sessionId: created.id,
    status: 'UPLOADED',
    mode,
    consentStatus: 'GRANTED' as const,
    audioRetentionUntil: audioRetentionUntil.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/cycle-1-consultation [DOCTOR] -> 200 { sessionId, analysis }
// ---------------------------------------------------------------------------
export async function runCycle1Consultation(
  sessionId: string,
  input: AudioUploadInput,
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{ sessionId: string; analysis: Cycle1AnalysisResponse }> {
  const session = await requireSessionRow(db, sessionId);
  assertNotWithdrawnOrPurged(session.status);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Committed sessions cannot be re-analyzed');
  }

  const prior = await loadStoredAnalysis(db, sessionId);

  let analysis: Cycle1Analysis;
  let transcript: StoredTranscript | null = prior.transcript;
  try {
    if (useGroqPipeline(deps)) {
      // Groq 3-stage path: transcribe -> cleanup/diarize -> analyze cleaned.
      const stages = deps.groqStages;
      const audioInput = {
        audioBase64: input.audioBase64,
        ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
      };
      const raw =
        stages !== undefined
          ? await stages.transcribe(audioInput)
          : await transcribeAudio(audioInput);
      const ctx = await cleanupContext(db, session);
      const cleaned =
        stages !== undefined
          ? await stages.cleanup(raw, ctx)
          : await cleanupTranscript(raw, ctx);
      const rawJson =
        stages !== undefined
          ? await stages.analyze({ systemPrompt: CYCLE_1_ANALYSIS_PROMPT, cleanedText: cleaned.cleanedText })
          : await analyzeCleanedTranscript({
              systemPrompt: CYCLE_1_ANALYSIS_PROMPT,
              cleanedText: cleaned.cleanedText,
            });
    analysis = parseCycleJson<Cycle1Analysis>(cycle1AnalysisSchema, rawJson);
    transcript = {
      raw,
      cleaned: cleaned.cleanedText,
      segments: cleaned.segments,
      cleanedAt: new Date().toISOString(),
      // With injected test stages there is no model to name; resolving the
      // real config here would force a GROQ key in keyless test runs.
      model: stages !== undefined ? 'mock' : resolveGroqConfig().chatModel,
      audioHash: sha256Hex(input.audioBase64),
    };
    } else {
      const generate = deps.generateContent;
      analysis = await analyzeConsultationAudio({
        audioBase64: input.audioBase64,
        ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
        ...(generate !== undefined ? { generateContent: generate } : {}),
      });
    }
  } catch (err) {
    await db.scribeSession.updateMany({
      where: { id: sessionId, status: { not: 'COMMITTED' } },
      data: { status: 'FAILED' },
    }).catch(() => {});
    throw err;
  }

  const saveAudio = deps.saveAudio ?? saveScribeAudio;
  const audioRef = await saveAudio(sessionId, 'cycle-1', input.audioBase64, input.mimeType ?? 'audio/webm');

  const stored: StoredAnalysis = { cycle1: analysis, cycle2: prior.cycle2, transcript, decisionTranscript: prior.decisionTranscript };

  await db.$transaction(async (tx) => {
    await tx.scribeSession.update({
      where: { id: sessionId },
      data: { status: 'TRANSCRIBING', audioReference: audioRef },
    });
    await tx.scribeDraft.create({
      data: {
        scribeSessionId: sessionId,
        patientId: session.patientId,
        mseSnapshot: { analysis: stored } as unknown as Prisma.InputJsonValue,
        soapDraftS: '',
        soapDraftO: '',
        soapDraftA: '',
        soapDraftP: '',
        version: await nextDraftVersion(tx, sessionId),
      },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SCRIBE_TRANSCRIBE',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      afterState: { status: 'TRANSCRIBING', cycle: 1 },
    });
  });

  return { sessionId, analysis: toCycle1Response(analysis, transcript) };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/cycle-2-doctor-decision [DOCTOR] -> 200 { soap, ... }
// ---------------------------------------------------------------------------
export async function runCycle2DoctorDecision(
  sessionId: string,
  input: AudioUploadInput,
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  soap: Cycle2Synthesis['soap'];
  prescriptions: Cycle2Synthesis['prescriptions'];
  finalDiagnosis: string;
  evidence: Cycle2Synthesis['evidence'];
}> {
  const session = await requireSessionRow(db, sessionId);
  assertNotWithdrawnOrPurged(session.status);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Committed sessions cannot be re-synthesized');
  }
  const prior = await loadStoredAnalysis(db, sessionId);
  if (prior.cycle1 === null) {
    throw new AppError('UNPROCESSABLE', 'Cycle 1 consultation analysis must complete first', [
      { field: 'cycle1', issue: 'missing Cycle 1 analysis', expected: 'POST cycle-1-consultation first' },
    ]);
  }

  const generateDecision = deps.generateContent;
  let synthesis: Cycle2Synthesis;
  let decisionTranscript: StoredTranscript | null = prior.decisionTranscript;
  try {
    if (generateDecision !== undefined) {
      synthesis = await synthesizeDoctorDecision({
        audioBase64: input.audioBase64,
        ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
        cycle1Context: prior.cycle1,
        generateContent: generateDecision,
      });
    } else if (useGroqPipeline(deps)) {
      // Groq 3-stage path. The UI sends ONE recording for both cycles: when
      // the Cycle-2 bytes match Cycle-1 (audio hash), the cleaned transcript
      // is reused with ZERO extra AI calls. A different audio (e.g. a fresh
      // doctor dictation) runs the full transcribe+cleanup pipeline instead.
      const stages = deps.groqStages;
      const audioHash = sha256Hex(input.audioBase64);
      let cleanedDecisionText: string;
      if (prior.transcript !== null && prior.transcript.audioHash === audioHash) {
        decisionTranscript = prior.transcript;
        cleanedDecisionText = prior.transcript.cleaned;
      } else {
        const audioInput = {
          audioBase64: input.audioBase64,
          ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
        };
        const rawDecision =
          stages !== undefined ? await stages.transcribe(audioInput) : await transcribeAudio(audioInput);
        const ctx = await cleanupContext(db, session);
        const cleanedDecision =
          stages !== undefined ? await stages.cleanup(rawDecision, ctx) : await cleanupTranscript(rawDecision, ctx);
      decisionTranscript = {
        raw: rawDecision,
        cleaned: cleanedDecision.cleanedText,
        segments: cleanedDecision.segments,
        cleanedAt: new Date().toISOString(),
        model: stages !== undefined ? 'mock' : resolveGroqConfig().chatModel,
        audioHash,
      };
        cleanedDecisionText = cleanedDecision.cleanedText;
      }
      const synthesisJson =
        stages !== undefined
          ? await stages.analyze({
              systemPrompt: CYCLE_2_SYNTHESIS_PROMPT,
              cleanedText: cleanedDecisionText,
              contextText: `CYCLE_1_CONTEXT_JSON:\n${JSON.stringify(prior.cycle1)}`,
            })
          : await analyzeCleanedTranscript({
              systemPrompt: CYCLE_2_SYNTHESIS_PROMPT,
              cleanedText: cleanedDecisionText,
              contextText: `CYCLE_1_CONTEXT_JSON:\n${JSON.stringify(prior.cycle1)}`,
            });
      synthesis = parseCycleJson<Cycle2Synthesis>(cycle2SynthesisSchema, synthesisJson);
    } else {
      synthesis = await synthesizeDoctorDecision({
        audioBase64: input.audioBase64,
        ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
        cycle1Context: prior.cycle1,
      });
    }
  } catch (err) {
    await db.scribeSession.updateMany({
      where: { id: sessionId, status: { not: 'COMMITTED' } },
      data: { status: 'FAILED' },
    }).catch(() => {});
    throw err;
  }

  const saveAudio = deps.saveAudio ?? saveScribeAudio;
  const audioRef = await saveAudio(sessionId, 'cycle-2', input.audioBase64, input.mimeType ?? 'audio/webm');

  const stored: StoredAnalysis = { cycle1: prior.cycle1, cycle2: synthesis, transcript: prior.transcript, decisionTranscript };

  await db.$transaction(async (tx) => {
    await tx.scribeSession.update({
      where: { id: sessionId },
      data: { status: 'TRANSCRIBED', audioReference: audioRef },
    });
    await tx.scribeDraft.create({
      data: {
        scribeSessionId: sessionId,
        patientId: session.patientId,
        mseSnapshot: { analysis: stored } as unknown as Prisma.InputJsonValue,
        soapDraftS: synthesis.soap.S,
        soapDraftO: synthesis.soap.O,
        soapDraftA: synthesis.soap.A,
        soapDraftP: synthesis.soap.P,
        version: await nextDraftVersion(tx, sessionId),
      },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SCRIBE_TRANSCRIBE',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      afterState: { status: 'TRANSCRIBED', cycle: 2 },
    });
  });

  return {
    sessionId,
    soap: synthesis.soap,
    prescriptions: synthesis.prescriptions,
    finalDiagnosis: synthesis.finalDiagnosis,
    evidence: synthesis.evidence ?? [],
  };
}

async function nextDraftVersion(tx: Prisma.TransactionClient, sessionId: string): Promise<number> {
  const latest = await tx.scribeDraft.findFirst({
    where: { scribeSessionId: sessionId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// GET /sessions/:id/transcript [DOCTOR] -> stored cleaned transcript,
// labeled by patient name + session date.
// ---------------------------------------------------------------------------
export interface ScribeTranscriptResponse {
  readonly sessionId: string;
  readonly patientName: string;
  readonly sessionDate: string;
  readonly transcript: StoredTranscript | null;
  readonly decisionTranscript: StoredTranscript | null;
}

export async function getScribeTranscript(
  sessionId: string,
  _actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<ScribeTranscriptResponse> {
  const session = await requireSessionRow(db, sessionId);
  const patient = await db.patient.findUnique({ where: { id: session.patientId }, select: { fullName: true } });
  const stored = await loadStoredAnalysis(db, sessionId);
  return {
    sessionId,
    patientName: patient?.fullName ?? 'غير معروف',
    sessionDate: sessionDateOf(session),
    transcript: stored.transcript,
    decisionTranscript: stored.decisionTranscript,
  };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/commit [DOCTOR] -> 200 { encounterId, status: COMMITTED }
// Saves the official Encounter (source SCRIBE) + creates Medication rows and
// flips ScribeSession.status to COMMITTED atomically (same transaction).
// ---------------------------------------------------------------------------
export async function commitScribeSession(
  sessionId: string,
  input: CommitSessionInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ encounterId: string; status: 'COMMITTED' }> {
  const session = await requireSessionRow(db, sessionId);
  assertNotWithdrawnOrPurged(session.status);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Scribe session is already committed');
  }
  const stored = await loadStoredAnalysis(db, sessionId);
  if (stored.cycle1 === null) {
    throw new AppError('UNPROCESSABLE', 'Cycle 1 consultation analysis must complete before commit', [
      { field: 'cycle1', issue: 'missing Cycle 1 analysis', expected: 'POST cycle-1-consultation first' },
    ]);
  }
  await assertPatientExists(db, session.patientId);

  const diagnoses =
    input.diagnoses !== undefined
      ? input.diagnoses
      : stored.cycle2 !== null && stored.cycle2.finalDiagnosis.trim().length > 0
        ? [stored.cycle2.finalDiagnosis]
        : [];
  const prescriptions = input.prescriptions ?? [];

  const visitDate = new Date();
  // The doctor's explicit exam findings from the Gen-2 studio reach the
  // encounter; an omitted mse records NOT_PERFORMED for every domain (the
  // exam matrix was skipped) — values are never invented.
  const mse = {
    appearance: input.mse?.appearance ?? 'NOT_PERFORMED',
    behavior: input.mse?.behavior ?? 'NOT_PERFORMED',
    speechCoherence: input.mse?.speechCoherence ?? 'NOT_PERFORMED',
    moodAffect: input.mse?.moodAffect ?? 'NOT_PERFORMED',
  };
  // Final content hash mirrors BE-501 sign logic (canonical SOAP + MSE + dx).
  const canonicalHashInput = JSON.stringify({
    // encounterId unknown pre-insert; hash on patient + content (stable post-insert
    // readers recompute with id — commit stores hash over content for audit parity).
    patientId: session.patientId,
    S: input.soap.S,
    O: input.soap.O,
    A: input.soap.A,
    P: input.soap.P,
    mse,
    diagnoses: [...diagnoses].sort(),
  });
  const finalContentHash = sha256Hex(canonicalHashInput);
  const signedAt = new Date();

  const created = await db.$transaction(async (tx) => {
    // ATOMIC claim (mirrors encounter-sign's conditional updateMany): the
    // session row lock serializes concurrent commit/withdraw on the same
    // session. Only a session still in an analysis-complete, not-yet-committed,
    // consent-valid state may flip to COMMITTED; count === 0 means a concurrent
    // request won the row and we surface a precise conflict (never a 500, and
    // never a second signed encounter). If the encounter/medication writes fail
    // below, the whole transaction rolls back and the claim reverts with it.
    const claimed = await tx.scribeSession.updateMany({
      where: { id: sessionId, status: { in: ['TRANSCRIBING', 'TRANSCRIBED'] } },
      data: { status: 'COMMITTED' },
    });
    if (claimed.count === 0) {
      const fresh = await tx.scribeSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { status: true },
      });
      if (fresh.status === 'COMMITTED') {
        throw new AppError('CONFLICT', 'Scribe session is already committed');
      }
      if (fresh.status === 'WITHDRAWN') {
        throw new AppError('WITHDRAWN_GONE', 'Consent was withdrawn; this session is locked');
      }
      if (fresh.status === 'PURGED') {
        throw new AppError('GONE', 'Scribe session audio was purged; this session is locked');
      }
      throw new AppError('UNPROCESSABLE', 'Cycle 1 consultation analysis must complete before commit', [
        { field: 'cycle1', issue: 'missing Cycle 1 analysis', expected: 'POST cycle-1-consultation first' },
      ]);
    }
    let encounter: { id: string };
    try {
      encounter = await tx.encounter.create({
        data: {
          patientId: session.patientId,
          queueEntryRef: session.queueEntryRef,
          source: 'SCRIBE',
          visitDate,
          encounterType: 'CONSULTATION',
          soapSubjective: input.soap.S,
          soapObjective: input.soap.O,
          soapAssessment: input.soap.A,
          soapPlan: input.soap.P,
          mseAppearance: mse.appearance,
          mseBehavior: mse.behavior,
          mseSpeechCoherence: mse.speechCoherence,
          mseMoodAffect: mse.moodAffect,
          diagnoses,
          status: 'SIGNED',
          rowVersion: 1,
          finalContentHash,
          signedByUserId: actor.userId,
          signedAt,
          originScribeDraftRef: sessionId,
        },
        select: { id: true },
      });
    } catch (err) {
      // DB-level authority behind the status claim: at most one signed SCRIBE
      // encounter may reference a given scribe session (uq on
      // encounters.origin_scribe_draft_ref, migration 0012).
      if (isUniqueViolation(err, 'origin_scribe_draft_ref')) {
        throw new AppError('CONFLICT', 'A signed encounter already exists for this scribe session');
      }
      throw err;
    }
    for (const rx of prescriptions) {
      await tx.medication.create({
        data: {
          patientId: session.patientId,
          encounterRef: encounter.id,
          drugName: rx.drugName,
          dosage: rx.dosage,
          frequency: rx.frequency,
          instructions: rx.instructions,
          status: 'ACTIVE',
          prescribedByUserId: actor.userId,
        },
      });
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'ENCOUNTER_CREATE',
      entityType: 'Encounter',
      entityId: encounter.id,
      requestId: randomUUID(),
      afterState: {
        status: 'SIGNED',
        source: 'SCRIBE',
        scribeSessionId: sessionId,
        prescriptionCount: prescriptions.length,
      },
    });
    // DB-14/Sprint-6 durability: the claim, the Encounter + Medications, and the
    // encounterRef back-link commit together, so a crash can never leave a
    // committed encounter with a non-committed scribe session (or vice versa).
    await tx.scribeSession.update({
      where: { id: sessionId },
      data: { encounterRef: encounter.id },
    });
    return encounter;
  });

  return { encounterId: created.id, status: 'COMMITTED' };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/purge-audio [DOCTOR] — delete bytes, keep records.
// Nulls audioReference so the retention worker skips the session; the clinical
// status (e.g. COMMITTED) is preserved — the committed Encounter stays intact.
// ---------------------------------------------------------------------------
export async function purgeScribeAudioFiles(
  sessionId: string,
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{ sessionId: string; purged: true; status: ScribeSessionStatus }> {
  await requireSessionRow(db, sessionId);
  const purgeFiles = deps.purgeAudioFiles ?? purgeScribeAudio;
  await purgeFiles(sessionId);
  const updated = await db.scribeSession.update({
    where: { id: sessionId },
    data: { audioReference: null },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'AUDIO_PURGED',
    entityType: 'ScribeSession',
    entityId: sessionId,
    requestId: randomUUID(),
    afterState: { audioPurged: true, status: updated.status },
  });
  return { sessionId, purged: true as const, status: updated.status };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/withdraw-consent [DOCTOR] — DB-15 consent lifecycle.
// Immediately purges stored audio, marks the session WITHDRAWN (locked for all
// further cycles/commit), and audits CONSENT_WITHDRAWN (ids/status only).
// ---------------------------------------------------------------------------
export async function withdrawConsentScribeSession(
  sessionId: string,
  input: WithdrawConsentInput,
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  status: 'WITHDRAWN';
  withdrawnAt: string | null;
  retentionUntil: string | null;
  audioPurged: true;
}> {
  const session = await requireSessionRow(db, sessionId);
  if (session.status === 'WITHDRAWN') {
    throw new AppError('CONFLICT', 'Consent was already withdrawn for this session');
  }
  if (session.status === 'PURGED') {
    throw new AppError('CONFLICT', 'Session audio was already purged');
  }

  // Withdrawal purges audio bytes immediately (idempotent when never stored).
  // Cycle audio is transient (re-uploaded per cycle; commit reads persisted
  // drafts, never audio), so a purge here is benign even if a concurrent commit
  // wins the row race below and the withdrawal itself ends in a conflict.
  const purgeFiles = deps.purgeAudioFiles ?? purgeScribeAudio;
  await purgeFiles(sessionId);

  // ATOMIC withdrawal claim: the conditional update on the session row
  // serializes against a concurrent commit's claim. If the commit tx claimed
  // the row first, this update affects 0 rows only when the session is already
  // WITHDRAWN/PURGED — otherwise the (COMMITTED) session is still withdrawable
  // by explicit doctor override, preserving the existing consent semantics.
  // A commit racing AFTER a successful withdrawal can never claim: its eligible
  // set (TRANSCRIBING/TRANSCRIBED) no longer matches, so no signed encounter
  // can be created for a withdrawn session.
  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.scribeSession.updateMany({
      where: { id: sessionId, status: { notIn: ['WITHDRAWN', 'PURGED'] } },
      data: {
        status: 'WITHDRAWN',
        consentStatus: 'WITHDRAWN',
        withdrawnAt: new Date(),
        withdrawalReason: input.reason ?? null,
        audioReference: null,
      },
    });
    if (claimed.count === 0) {
      const fresh = await tx.scribeSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { status: true },
      });
      if (fresh.status === 'WITHDRAWN') {
        throw new AppError('CONFLICT', 'Consent was already withdrawn for this session');
      }
      throw new AppError('CONFLICT', 'Session audio was already purged');
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CONSENT_WITHDRAWN',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      ...(input.reason !== undefined ? { reasonText: input.reason } : {}),
      // Operational state only (ids/status/flags) — no clinical content.
      afterState: { status: 'WITHDRAWN', audioPurged: true },
    });
    return tx.scribeSession.findUniqueOrThrow({ where: { id: sessionId } });
  });

  return {
    sessionId,
    status: 'WITHDRAWN' as const,
    withdrawnAt: updated.withdrawnAt === null ? null : updated.withdrawnAt.toISOString(),
    retentionUntil: updated.audioRetentionUntil === null ? null : updated.audioRetentionUntil.toISOString(),
    audioPurged: true as const,
  };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/cancel [DOCTOR] — cancel a pending/in-progress session.
// Purges audio, updates status to WITHDRAWN, audits cancellation.
// Committed sessions cannot be cancelled.
// ---------------------------------------------------------------------------
export async function cancelScribeSession(
  sessionId: string,
  input: CancelSessionInput = {},
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  status: 'WITHDRAWN';
  cancelled: true;
  audioPurged: true;
}> {
  const session = await requireSessionRow(db, sessionId);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Scribe session is already committed');
  }

  const purgeFiles = deps.purgeAudioFiles ?? purgeScribeAudio;
  await purgeFiles(sessionId);

  await db.$transaction(async (tx) => {
    const claimed = await tx.scribeSession.updateMany({
      where: { id: sessionId, status: { not: 'COMMITTED' } },
      data: {
        status: 'WITHDRAWN',
        consentStatus: 'WITHDRAWN',
        withdrawnAt: new Date(),
        withdrawalReason: input.reason ?? 'CANCELLED_BY_DOCTOR',
        audioReference: null,
      },
    });
    if (claimed.count === 0) {
      throw new AppError('CONFLICT', 'Scribe session is already committed');
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CONSENT_WITHDRAWN',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      reasonText: input.reason ?? 'CANCELLED_BY_DOCTOR',
      afterState: { status: 'WITHDRAWN', action: 'CANCEL', audioPurged: true },
    });
  });

  return {
    sessionId,
    status: 'WITHDRAWN' as const,
    cancelled: true as const,
    audioPurged: true as const,
  };
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/stop [DOCTOR] — stop an active/recording scribe session.
// Marks stoppedAt on the session row and audits the stop.
// Committed sessions cannot be stopped.
// ---------------------------------------------------------------------------
export async function stopScribeSession(
  sessionId: string,
  input: StopSessionInput = {},
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  status: ScribeSessionStatus;
  stoppedAt: string;
}> {
  const session = await requireSessionRow(db, sessionId);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Scribe session is already committed');
  }

  const stoppedAt = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.scribeSession.updateMany({
      where: { id: sessionId, status: { not: 'COMMITTED' } },
      data: { stoppedAt },
    });
    if (claimed.count === 0) {
      throw new AppError('CONFLICT', 'Scribe session is already committed');
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CONSENT_WITHDRAWN',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      reasonText: input.reason ?? 'STOPPED_BY_DOCTOR',
      afterState: { status: session.status, action: 'STOP', stoppedAt: stoppedAt.toISOString() },
    });
  });

  return {
    sessionId,
    status: session.status,
    stoppedAt: stoppedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DELETE /sessions/:id [DOCTOR] — delete an uncommitted scribe session + drafts.
// Purges audio, removes session & draft rows, and audits deletion.
// Committed sessions cannot be deleted.
// ---------------------------------------------------------------------------
export async function deleteScribeSession(
  sessionId: string,
  input: DeleteSessionInput = {},
  actor: DoctorActor,
  deps: ScribeTestDeps = {},
  db: PrismaClient = prisma,
): Promise<{
  sessionId: string;
  deleted: true;
}> {
  const session = await requireSessionRow(db, sessionId);
  if (session.status === 'COMMITTED') {
    throw new AppError('CONFLICT', 'Scribe session is already committed');
  }

  const purgeFiles = deps.purgeAudioFiles ?? purgeScribeAudio;
  await purgeFiles(sessionId);

  await db.$transaction(async (tx) => {
    const fresh = await tx.scribeSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (fresh.status === 'COMMITTED') {
      throw new AppError('CONFLICT', 'Scribe session is already committed');
    }

    await tx.scribeDraft.deleteMany({ where: { scribeSessionId: sessionId } });
    await tx.scribeSession.delete({ where: { id: sessionId } });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'ENCOUNTER_DISCARD',
      entityType: 'ScribeSession',
      entityId: sessionId,
      requestId: randomUUID(),
      reasonText: input.reason ?? 'DELETED_BY_DOCTOR',
      afterState: { deleted: true, action: 'DELETE', priorStatus: session.status },
    });
  });

  return {
    sessionId,
    deleted: true as const,
  };
}

// ---------------------------------------------------------------------------
// BE-604 retention worker — deletes ciphertext for sessions past
// audioRetentionUntil, nulls audioReference, flips eligible sessions to
// PURGED, and audits AUDIO_PURGED. Scheduled by src/server.ts (best-effort;
// failures are logged, never fatal).
// ---------------------------------------------------------------------------
export async function purgeExpiredScribeAudio(
  db: PrismaClient = prisma,
  deps: ScribeTestDeps = {},
): Promise<{ purged: number; sessionIds: string[] }> {
  const now = new Date();
  const due = await db.scribeSession.findMany({
    where: {
      audioRetentionUntil: { lte: now },
      audioReference: { not: null },
      status: { notIn: ['PURGED', 'WITHDRAWN'] },
    },
    select: { id: true, status: true, createdByUserId: true },
  });

  const purgeFiles = deps.purgeAudioFiles ?? purgeScribeAudio;
  const sessionIds: string[] = [];
  for (const row of due) {
    await purgeFiles(row.id);
    // COMMITTED sessions keep their terminal status; everything still in the
    // active pipeline becomes PURGED (audio gone -> cycles/commit locked).
    // The status flip is CONDITIONAL on the status read above: a concurrent
    // commit that claimed the session in between must not be clobbered to
    // PURGED — the next pass re-evaluates the (now COMMITTED) row instead.
    const nextStatus: ScribeSessionStatus = row.status === 'COMMITTED' ? 'COMMITTED' : 'PURGED';
    const updated = await db.scribeSession.updateMany({
      where: { id: row.id, status: row.status },
      data: { audioReference: null, status: nextStatus },
    });
    if (updated.count === 0) continue;
    await writeAudit(db, {
      actorUserId: row.createdByUserId,
      actorRole: 'DOCTOR',
      action: 'AUDIO_PURGED',
      entityType: 'ScribeSession',
      entityId: row.id,
      requestId: randomUUID(),
      afterState: { audioPurged: true, status: nextStatus, trigger: 'retentionTtl' },
    });
    sessionIds.push(row.id);
  }
  return { purged: sessionIds.length, sessionIds };
}
