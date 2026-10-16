import { z } from 'zod';
import { mseObjectSchema } from '../clinical-ehr/encounter.validators.js';

/**
 * Sprint 6 AI Scribe validators (Zod sole validation; failure -> 422).
 * Audio is uploaded as JSON `{ audioBase64, mimeType? }` (base64 inline bytes
 * passed straight to Gemini). This avoids a multipart dependency while staying
 * type-safe and mock-friendly.
 */

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

function isBase64(v: string): boolean {
  if (v.length === 0 || v.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(v);
}

const trimmedReason = (field: string, min: number, max: number): z.ZodString =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} must be a string` })
    .trim()
    .min(min, `${field} must be at least ${min} characters`)
    .max(max, `${field} must be at most ${max} characters`);

/** POST /scribe/sessions — start a 2-cycle session for a patient. */
export const createSessionSchema = z
  .object({
    patientId: idText('patientId'),
    queueEntryId: idText('queueEntryId').optional(),
    // BE-602 consent gate: ambient recording requires explicit opt-in; dictation
    // (doctor-initiated, short) does not. Defaults to AMBIENT_LIVE so an omitted
    // mode can never bypass the consentConfirmed requirement.
    mode: z.enum(['AMBIENT_LIVE', 'DICTATION_60S']).default('AMBIENT_LIVE'),
    consentConfirmed: z.boolean().optional(),
  })
  .strict();

/** :id params for all session-scoped routes. */
export const sessionIdParamSchema = z.object({ id: idText('id') }).strict();

const mimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((v) => v.includes('/'), 'mimeType must be a valid MIME type (e.g. audio/webm)')
  .optional();

/** POST .../cycle-1-consultation + .../cycle-2-doctor-decision audio upload. */
export const audioUploadSchema = z
  .object({
    audioBase64: z
      .string({ required_error: 'audioBase64 is required' })
      .trim()
      .min(1, 'audioBase64 is required')
      .max(15_000_000, 'audio payload too large')
      .refine(isBase64, 'audioBase64 must be valid base64'),
    mimeType: mimeTypeSchema,
  })
  .strict();

const soapSection = z.string().trim().min(1).max(10000);

export const scribeSoapSchema = z
  .object({ S: soapSection, O: soapSection, A: soapSection, P: soapSection })
  .strict();

export const scribePrescriptionSchema = z
  .object({
    drugName: z.string().trim().min(1).max(200),
    dosage: z.string().trim().min(1).max(200),
    frequency: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(1000),
  })
  .strict();

/**
 * POST .../commit — final reviewed/edited SOAP + prescriptions + diagnoses,
 * plus the doctor's explicit MSE findings captured in the Gen-2 studio.
 * `mse` reuses the canonical BE-501 `mseObjectSchema` (explicit finding string
 * per domain, or the NOT_PERFORMED sentinel); when omitted the encounter
 * records NOT_PERFORMED for every domain (the doctor skipped the exam matrix).
 */
export const commitSessionSchema = z
  .object({
    soap: scribeSoapSchema,
    mse: mseObjectSchema.optional(),
    prescriptions: z.array(scribePrescriptionSchema).max(30).optional(),
    diagnoses: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  })
  .strict();

/**
 * POST .../withdraw-consent [DOCTOR] — DB-15 consent withdrawal. Locks the
 * session (no further transcribe/synthesize/commit) and purges stored audio.
 */
export const withdrawConsentSchema = z
  .object({
    reason: trimmedReason('reason', 1, 300).optional(),
  })
  .strict()
  .default({});

export const cancelSessionSchema = z
  .object({
    reason: trimmedReason('reason', 1, 300).optional(),
  })
  .strict()
  .default({});

export const stopSessionSchema = z
  .object({
    reason: trimmedReason('reason', 1, 300).optional(),
  })
  .strict()
  .default({});

export const deleteSessionSchema = z
  .object({
    reason: trimmedReason('reason', 1, 300).optional(),
  })
  .strict()
  .default({});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type AudioUploadInput = z.infer<typeof audioUploadSchema>;
export type CommitSessionInput = z.infer<typeof commitSessionSchema>;
export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>;
export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;
export type StopSessionInput = z.infer<typeof stopSessionSchema>;
export type DeleteSessionInput = z.infer<typeof deleteSessionSchema>;
export type ScribeSoap = z.infer<typeof scribeSoapSchema>;
export type ScribePrescription = z.infer<typeof scribePrescriptionSchema>;

