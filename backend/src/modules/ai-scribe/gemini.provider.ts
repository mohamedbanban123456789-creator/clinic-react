import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { CYCLE_1_ANALYSIS_PROMPT, CYCLE_2_SYNTHESIS_PROMPT } from './prompts/scribe.prompts.js';

/**
 * Sprint 6 AI Scribe — Google Gemini provider (production code).
 *
 * - Reads GEMINI_API_KEY / GEMINI_MODEL via src/config/env.ts (loadEnv).
 * - Falls back to process.env when loadEnv cannot boot (e.g. unit tests
 *   without DATABASE_URL) so `npm test` never needs a live paid key.
 * - Sends audio inline to Gemini and enforces JSON output via
 *   `responseMimeType: "application/json"`.
 * - All SDK calls are injectable (`GenerateContentFn`) so unit tests mock
 *   Gemini without network/keys.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const GEMINI_RESPONSE_MIME_TYPE = 'application/json';

export interface GeminiConfig {
  readonly apiKey: string;
  readonly model: string;
}

export function resolveGeminiConfig(): GeminiConfig {
  let apiKey: string | undefined;
  let model: string | undefined;
  try {
    // Spec: GEMINI_API_KEY / GEMINI_MODEL are defined in src/config/env.ts.
    const env = loadEnv();
    apiKey = env.GEMINI_API_KEY?.trim();
    model = env.GEMINI_MODEL?.trim();
  } catch {
    // Unit tests / CI without full backend env (no DATABASE_URL): fall back to
    // raw process.env so `npm test` never needs a live paid key or a database.
    apiKey = process.env['GEMINI_API_KEY']?.trim();
    model = process.env['GEMINI_MODEL']?.trim();
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new AppError('GEMINI_KEY_MISSING', 'Gemini API key is not configured');
  }
  return { apiKey, model: model !== undefined && model.length > 0 ? model : DEFAULT_GEMINI_MODEL };
}

// ---------------------------------------------------------------------------
// Structured output schemas (Zod sole validation; failure -> 422 envelope).
// ---------------------------------------------------------------------------

export const cycle1AnalysisSchema = z
  .object({
    chiefComplaint: z.string().trim().min(1).max(2000),
    symptoms: z.array(z.string().trim().min(1).max(500)).max(50),
    moodAndAffect: z.string().trim().min(1).max(2000),
    suggestions: z.array(z.string().trim().min(1).max(1000)).max(50),
  })
  .strict();

export const prescriptionItemSchema = z
  .object({
    drugName: z.string().trim().min(1).max(200),
    dosage: z.string().trim().max(200).default(''),
    frequency: z.string().trim().max(200).default(''),
    instructions: z.string().trim().max(1000).default(''),
  })
  .strict();

export const soapSchema = z
  .object({
    S: z.string().trim().min(1).max(10000),
    O: z.string().trim().min(1).max(10000),
    A: z.string().trim().min(1).max(10000),
    P: z.string().trim().min(1).max(10000),
  })
  .strict();

export const cycle2SynthesisSchema = z
  .object({
    soap: soapSchema,
    prescriptions: z.array(prescriptionItemSchema).max(30).default([]),
    finalDiagnosis: z.string().trim().max(2000).default(''),
  })
  .strict();

export type Cycle1Analysis = z.infer<typeof cycle1AnalysisSchema>;
export type PrescriptionItem = z.infer<typeof prescriptionItemSchema>;
export type Soap = z.infer<typeof soapSchema>;
export type Cycle2Synthesis = z.infer<typeof cycle2SynthesisSchema>;

// ---------------------------------------------------------------------------
// Injectable Gemini call (mock seam for unit tests).
// ---------------------------------------------------------------------------

export interface GenerateContentInput {
  readonly systemPrompt: string;
  readonly audioBase64: string;
  readonly mimeType: string;
  /** Optional extra user text (e.g. Cycle 1 context JSON for Cycle 2). */
  readonly contextText?: string;
  readonly modelOverride?: string;
}

export type GenerateContentFn = (input: GenerateContentInput) => Promise<string>;

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  // Remove leading ```json / ``` and trailing ```.
  const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, '');
  const withoutClose = withoutOpen.replace(/\s*```\s*$/, '');
  return withoutClose.trim();
}

function parseJsonOrThrow(raw: string): unknown {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new AppError('UNPROCESSABLE', 'Gemini did not return valid JSON', [
      { field: 'gemini', issue: 'non-JSON model output', expected: 'strict JSON per scribe prompt' },
    ]);
  }
}

/** Outbound Gemini calls are bounded so a hung socket can never pin a request
 *  forever. 45s comfortably covers large audio transcription round-trips while
 *  still failing fast (504 GEMINI_TIMEOUT) instead of hanging. */
export const GEMINI_TIMEOUT_MS = 45_000;

/**
 * Bound `work` (which receives the AbortSignal) to `timeoutMs`. On expiry the
 * controller aborts (the SDK forwards `abortSignal` to the underlying fetch)
 * and the race rejects with `GEMINI_TIMEOUT` (504). The timer is cleared on
 * settle in every path so a resolved call never leaks a pending timer.
 */
export async function withGeminiTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = GEMINI_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AppError('GEMINI_TIMEOUT', `Gemini request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Production Gemini call: audio inline + responseMimeType application/json.
 *  The SDK call is bounded by `withGeminiTimeout` (AbortController, 45s). */
export const defaultGenerateContent: GenerateContentFn = async (input) => {
  const { apiKey, model } = resolveGeminiConfig();
  const ai = new GoogleGenAI({ apiKey });
  const response = await withGeminiTimeout((signal) =>
    ai.models.generateContent({
      model: input.modelOverride ?? model,
      contents: [
        {
          role: 'user',
          parts: [
            ...(input.contextText !== undefined ? [{ text: input.contextText }] : []),
            { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
          ],
        },
      ],
      config: {
        systemInstruction: input.systemPrompt,
        responseMimeType: GEMINI_RESPONSE_MIME_TYPE,
        abortSignal: signal,
      },
    }),
  );
  const text = response.text;
  if (text === undefined || text.trim().length === 0) {
    throw new AppError('UNPROCESSABLE', 'Gemini returned an empty response', [
      { field: 'gemini', issue: 'empty model output', expected: 'strict JSON per scribe prompt' },
    ]);
  }
  return text;
};

// ---------------------------------------------------------------------------
// Cycle entry points.
// ---------------------------------------------------------------------------

export interface AudioInput {
  readonly audioBase64: string;
  readonly mimeType?: string;
  readonly modelOverride?: string;
  /** Test seam: mocked Gemini text output (no network). */
  readonly generateContent?: GenerateContentFn;
}

function resolveMimeType(mimeType: string | undefined): string {
  if (mimeType === undefined) return 'audio/webm';
  const t = mimeType.trim();
  return t.length > 0 ? t : 'audio/webm';
}

/**
 * CYCLE 1: consultation audio -> Initial Session Analysis.
 * Throws GEMINI_KEY_MISSING (500) when no key; UNPROCESSABLE (422) on bad JSON.
 */
export async function analyzeConsultationAudio(input: AudioInput): Promise<Cycle1Analysis> {
  const generate = input.generateContent ?? defaultGenerateContent;
  const raw = await generate({
    systemPrompt: CYCLE_1_ANALYSIS_PROMPT,
    audioBase64: input.audioBase64,
    mimeType: resolveMimeType(input.mimeType),
    ...(input.modelOverride !== undefined ? { modelOverride: input.modelOverride } : {}),
  });
  const parsed = cycle1AnalysisSchema.safeParse(parseJsonOrThrow(raw));
  if (!parsed.success) {
    throw AppError.fromZod(parsed.error.issues);
  }
  return parsed.data;
}

export interface SynthesizeInput extends AudioInput {
  /** Cycle 1 analysis JSON passed as context alongside the doctor voice audio. */
  readonly cycle1Context: Cycle1Analysis;
}

/**
 * CYCLE 2: doctor voice dictation (+ Cycle 1 context) -> SOAP + prescriptions.
 * The doctor's voice is authoritative; the prompt encodes that precedence.
 */
export async function synthesizeDoctorDecision(input: SynthesizeInput): Promise<Cycle2Synthesis> {
  const generate = input.generateContent ?? defaultGenerateContent;
  const contextText = `CYCLE_1_CONTEXT_JSON:\n${JSON.stringify(input.cycle1Context)}`;
  const raw = await generate({
    systemPrompt: CYCLE_2_SYNTHESIS_PROMPT,
    audioBase64: input.audioBase64,
    mimeType: resolveMimeType(input.mimeType),
    contextText,
    ...(input.modelOverride !== undefined ? { modelOverride: input.modelOverride } : {}),
  });
  const parsed = cycle2SynthesisSchema.safeParse(parseJsonOrThrow(raw));
  if (!parsed.success) {
    throw AppError.fromZod(parsed.error.issues);
  }
  return parsed.data;
}
