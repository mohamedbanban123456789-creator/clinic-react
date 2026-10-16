import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk/uploads';
import { z } from 'zod';
import { AppError } from '../../common/errors/AppError.js';
import { loadEnv } from '../../config/env.js';
import { withGeminiTimeout } from './gemini.provider.js';
import { CYCLE_0_CLEANUP_PROMPT } from './prompts/scribe.prompts.js';

/**
 * Sprint 6 AI Scribe — Groq provider (STT + chat), 3-stage pipeline:
 *   1. whisper-large-v3 transcription (temperature 0.2, verbose_json).
 *   2. qwen cleanup/diarization: raw transcript -> speaker-segmented,
 *      error-corrected transcript (NOT a summary — full fidelity).
 *   3. qwen analysis of the CLEANED transcript with the shared scribe
 *      prompts -> STRICT JSON.
 *
 * Gemini stays in the codebase untouched; SCRIBE_PROVIDER selects the
 * active path ('groq' default, 'gemini' re-enables the old path).
 */

export const DEFAULT_GROQ_STT_MODEL = 'whisper-large-v3';
export const DEFAULT_GROQ_CHAT_MODEL = 'qwen/qwen3.8-27b';
export const DEFAULT_GROQ_TIMEOUT_MS = 120_000;
/** Cycle-2 answers carry large evidence arrays; 2048 risks truncation. */
export const DEFAULT_GROQ_MAX_TOKENS = 4096;

export interface GroqConfig {
  readonly apiKey: string;
  readonly provider: 'groq' | 'gemini';
  readonly sttModel: string;
  readonly chatModel: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export function resolveGroqConfig(): GroqConfig {
  let apiKey: string | undefined;
  let provider: string | undefined;
  let sttModel: string | undefined;
  let chatModel: string | undefined;
  let maxTokens: number | undefined;
  let timeoutMs: number | undefined;
  try {
    const env = loadEnv();
    apiKey = env.GROQ_API_KEY?.trim();
    provider = env.SCRIBE_PROVIDER?.trim();
    sttModel = env.GROQ_STT_MODEL?.trim();
    chatModel = env.GROQ_CHAT_MODEL?.trim();
    maxTokens = env.GROQ_MAX_TOKENS;
    timeoutMs = env.GROQ_TIMEOUT_MS;
  } catch {
    // Unit tests / CI without full backend env: raw process.env fallback.
    apiKey = process.env['GROQ_API_KEY']?.trim();
    provider = process.env['SCRIBE_PROVIDER']?.trim();
    sttModel = process.env['GROQ_STT_MODEL']?.trim();
    chatModel = process.env['GROQ_CHAT_MODEL']?.trim();
    const mt = Number(process.env['GROQ_MAX_TOKENS']);
    maxTokens = Number.isFinite(mt) && mt > 0 ? mt : undefined;
    const to = Number(process.env['GROQ_TIMEOUT_MS']);
    timeoutMs = Number.isFinite(to) && to > 0 ? to : undefined;
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new AppError('GROQ_KEY_MISSING', 'Groq API key is not configured');
  }
  return {
    apiKey,
    provider: provider === 'gemini' ? 'gemini' : 'groq',
    sttModel: sttModel !== undefined && sttModel.length > 0 ? sttModel : DEFAULT_GROQ_STT_MODEL,
    chatModel: chatModel !== undefined && chatModel.length > 0 ? chatModel : DEFAULT_GROQ_CHAT_MODEL,
    maxTokens: maxTokens !== undefined && maxTokens > 0 ? maxTokens : DEFAULT_GROQ_MAX_TOKENS,
    timeoutMs: timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : DEFAULT_GROQ_TIMEOUT_MS,
  };
}

/** Active scribe path: 'groq' unless SCRIBE_PROVIDER=gemini. */
export function resolveScribeProvider(): 'groq' | 'gemini' {
  return isGroqSelected() ? 'groq' : 'gemini';
}

/** SCRIBE_PROVIDER switch without key probing (selection never throws). */
export function isGroqSelected(): boolean {
  try {
    return loadEnv().SCRIBE_PROVIDER !== 'gemini';
  } catch {
    return (process.env['SCRIBE_PROVIDER'] ?? 'groq') !== 'gemini';
  }
}

/**
 * The service forwards Cycle-1 context as `CYCLE_1_CONTEXT_JSON:\n{...}`.
 * Drop the (large) evidence array before sending it to the chat model:
 * synthesis grounds missing sections in the clinical substance, while the
 * full transcript stays attached as the primary source.
 */
function slimCycleContext(contextText: string): string {
  const marker = 'CYCLE_1_CONTEXT_JSON:';
  const idx = contextText.indexOf(marker);
  const head = idx >= 0 ? contextText.slice(0, idx + marker.length) : '';
  const body = idx >= 0 ? contextText.slice(idx + marker.length) : contextText;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    delete parsed['evidence'];
    return `${head}\n${JSON.stringify(parsed)}`;
  } catch {
    return contextText;
  }
}

function extForMime(mimeType: string | undefined): string {  const t = (mimeType ?? '').toLowerCase();
  if (t.includes('wav')) return 'audio.wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'audio.mp3';
  if (t.includes('m4a') || t.includes('mp4')) return 'audio.m4a';
  if (t.includes('ogg') || t.includes('opus')) return 'audio.ogg';
  if (t.includes('flac')) return 'audio.flac';
  if (t.includes('webm')) return 'audio.webm';
  return 'audio.webm';
}

/**
 * The shared scribe prompts were written for direct-audio models. On the
 * Groq path the analysis model receives the CLEANED transcript instead:
 * speaker-segmented, corrected against the session context, full fidelity.
 */
const CLEANED_ADAPTER_NOTE = `CLEANED-TRANSCRIPT NOTE: you receive a cleaned, speaker-segmented consultation transcript (lines start with "الدكتور:" or "المريضة:" or "غير مؤكد:"). It was corrected for obvious recognition errors against the session context and preserves everything said — treat it as the authoritative record. "quote" means a verbatim excerpt of THIS cleaned transcript (copy words exactly, from the speaker turn they came from). Use the speaker labels when attributing statements. The cleaned transcript follows under TRANSCRIPT:.`;

/** One diarized turn of the cleaned transcript. */
export const transcriptSegmentSchema = z
  .object({
    speaker: z.enum(['doctor', 'patient', 'unsure']),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export const cleanupTranscriptSchema = z
  .object({
    segments: z.array(transcriptSegmentSchema).max(300),
  })
  .strict();

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type CleanupResult = z.infer<typeof cleanupTranscriptSchema>;

export interface CleanupContext {
  /** Patient full name — fixes misheard renderings of the name. */
  readonly patientName: string;
  /** Session calendar date (YYYY-MM-DD). */
  readonly sessionDate: string;
}

const SPEAKER_LABEL: Record<TranscriptSegment['speaker'], string> = {
  doctor: 'الدكتور',
  patient: 'المريضة',
  unsure: 'غير مؤكد',
};

/** Render cleaned segments as labeled lines for the analysis model. */
export function renderCleanedTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s) => `${SPEAKER_LABEL[s.speaker]}: ${s.text}`).join('\n');
}

function buildCleanupPrompt(ctx: CleanupContext): string {
  return `${CYCLE_0_CLEANUP_PROMPT}\n\nSESSION CONTEXT (use it to fix mishearings, never to invent content):\n- Patient name: ${ctx.patientName} — fix any misheard rendering of this name.\n- Session date: ${ctx.sessionDate}.\n- This cleaned transcript goes to a clinical-analysis model next: accuracy and completeness matter more than style.`;
}

export interface AudioBytesInput {
  readonly audioBase64: string;
  readonly mimeType?: string;
  readonly modelOverride?: string;
}

/** Stage 1: whisper transcription -> raw transcript text. */
export async function transcribeAudio(input: AudioBytesInput): Promise<string> {
  const cfg = resolveGroqConfig();
  const client = new Groq({ apiKey: cfg.apiKey });
  let transcript: string;
  try {
    const tx = await withGeminiTimeout(async (signal) => {
      const file = await toFile(Buffer.from(input.audioBase64, 'base64'), extForMime(input.mimeType));
      return client.audio.transcriptions.create(
        {
          file,
          model: input.modelOverride ?? cfg.sttModel,
          temperature: 0.2,
          response_format: 'verbose_json',
        },
        { signal },
      );
    }, cfg.timeoutMs);
    transcript = ((tx as unknown as { text?: unknown }).text as string | undefined) ?? '';
  } catch (err) {
    throw mapGroqError(err, 'transcription');
  }
  if (transcript.trim().length === 0) {
    throw new AppError('UNPROCESSABLE', 'Transcription returned empty text', [
      { field: 'groq', issue: 'empty transcript', expected: 'audible speech in the audio' },
    ]);
  }
  return transcript;
}

/** Stage 2: raw transcript -> diarized, corrected transcript (full fidelity). */
export async function cleanupTranscript(
  rawTranscript: string,
  ctx: CleanupContext,
  modelOverride?: string,
): Promise<{ segments: TranscriptSegment[]; cleanedText: string }> {
  const cfg = resolveGroqConfig();
  const client = new Groq({ apiKey: cfg.apiKey });
  let text: string | null;
  try {
    const out = await withGeminiTimeout(
      (signal) =>
        client.chat.completions.create(
          {
            model: modelOverride ?? cfg.chatModel,
            messages: [
              { role: 'system', content: buildCleanupPrompt(ctx) },
              { role: 'user', content: `RAW_TRANSCRIPT:\n${rawTranscript}` },
            ],
            temperature: 0.2,
            max_completion_tokens: cfg.maxTokens,
            top_p: 0.95,
            stream: false,
            reasoning_effort: 'default',
            stop: null,
          },
          { signal },
        ),
      cfg.timeoutMs,
    );
    text = out.choices[0]?.message?.content ?? null;
  } catch (err) {
    throw mapGroqError(err, 'cleanup');
  }
  if (text === null || text.trim().length === 0) {
    throw new AppError('UNPROCESSABLE', 'Groq returned an empty cleanup response', [
      { field: 'groq', issue: 'empty model output', expected: 'strict JSON per cleanup prompt' },
    ]);
  }
  const cleaned = stripCleanupFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    throw new AppError('UNPROCESSABLE', 'AI model did not return valid cleanup JSON', [
      { field: 'groq', issue: 'non-JSON cleanup output', expected: 'strict JSON per cleanup prompt' },
    ]);
  }
  const validated = cleanupTranscriptSchema.safeParse(parsed);
  if (!validated.success) {
    throw AppError.fromZod(validated.error.issues);
  }
  if (validated.data.segments.length === 0) {
    throw new AppError('UNPROCESSABLE', 'Cleanup returned no segments', [
      { field: 'groq', issue: 'empty segments', expected: 'full-fidelity segmentation' },
    ]);
  }
  return { segments: validated.data.segments, cleanedText: renderCleanedTranscript(validated.data.segments) };
}

function stripCleanupFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, '');
  return withoutOpen.replace(/\s*```\s*$/, '').trim();
}

export interface AnalyzeCleanedInput {
  readonly systemPrompt: string;
  readonly cleanedText: string;
  /** Optional extra user text (e.g. Cycle 1 context JSON for Cycle 2). */
  readonly contextText?: string;
  readonly modelOverride?: string;
}

/**
 * Stage 3: cleaned transcript (+ optional context) -> STRICT JSON text.
 * The caller parses the text with the cycle schemas.
 */
export async function analyzeCleanedTranscript(input: AnalyzeCleanedInput): Promise<string> {
  const cfg = resolveGroqConfig();
  const client = new Groq({ apiKey: cfg.apiKey });
  const userContent =
    input.contextText !== undefined
      ? `TRANSCRIPT:\n${input.cleanedText}\n\n${slimCycleContext(input.contextText)}`
      : `TRANSCRIPT:\n${input.cleanedText}`;
  let text: string | null;
  try {
    const out = await withGeminiTimeout(
      (signal) =>
        client.chat.completions.create(
          {
            model: input.modelOverride ?? cfg.chatModel,
            messages: [
              { role: 'system', content: `${input.systemPrompt}\n\n${CLEANED_ADAPTER_NOTE}` },
              { role: 'user', content: userContent },
            ],
            temperature: 0.6,
            max_completion_tokens: cfg.maxTokens,
            top_p: 0.95,
            stream: false,
            reasoning_effort: 'default',
            stop: null,
          },
          { signal },
        ),
      cfg.timeoutMs,
    );
    text = out.choices[0]?.message?.content ?? null;
  } catch (err) {
    throw mapGroqError(err, 'chat');
  }
  if (text === null || text.trim().length === 0) {
    throw new AppError('UNPROCESSABLE', 'Groq returned an empty response', [
      { field: 'groq', issue: 'empty model output', expected: 'strict JSON per scribe prompt' },
    ]);
  }
  return text;
}

/** Map Groq SDK failures to honest AppErrors (never raw 500s). */
function mapGroqError(err: unknown, stage: 'transcription' | 'cleanup' | 'chat'): AppError {
  if (err instanceof AppError) {
    // withGeminiTimeout is reused as a generic deadline: relabel its expiry.
    if (err.code === 'GEMINI_TIMEOUT') {
      return new AppError('GROQ_TIMEOUT', `Groq ${stage} timed out`, [
        { field: 'groq', issue: 'upstream deadline exceeded', expected: 'shorter audio or retry' },
      ]);
    }
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const clipped = msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return new AppError('RATE_LIMITED', `Groq ${stage} rate-limited — retry shortly`, [
      { field: 'groq', issue: clipped, expected: 'retry after a pause' },
    ]);
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return new AppError('GROQ_KEY_MISSING', 'Groq API key is invalid', [
      { field: 'groq', issue: clipped, expected: 'valid GROQ_API_KEY' },
    ]);
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('does not exist')) {
    return new AppError('UNPROCESSABLE', `Groq model unavailable for ${stage}`, [
      { field: 'groq', issue: clipped, expected: 'existing STT/chat model' },
    ]);
  }
  return new AppError('GROQ_UPSTREAM', `Groq ${stage} failed`, [
    { field: 'groq', issue: clipped, expected: 'successful upstream call' },
  ]);
}

