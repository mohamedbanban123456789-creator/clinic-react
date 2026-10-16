import { z } from 'zod';

/**
 * BE-501 validators (Zod sole validation; failure -> 422 envelope).
 * MSE selectors accept NOT_PERFORMED as an explicit sentinel (CONV-09, C-10).
 * Missing/empty is rejected; explicit NOT_PERFORMED is accepted.
 */

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

// C-10: NOT_PERFORMED must appear as an explicit literal in MSE schemas.
const NOT_PERFORMED = z.literal('NOT_PERFORMED');

const mseSelector = z.union([
  NOT_PERFORMED,
  z.string().trim().min(1, 'MSE value is required').max(120),
]);

export const mseObjectSchema = z
  .object({
    appearance: mseSelector,
    behavior: mseSelector,
    speechCoherence: mseSelector,
    moodAffect: mseSelector,
  })
  .strict();

export const msePatchSchema = z
  .object({
    appearance: mseSelector.optional(),
    behavior: mseSelector.optional(),
    speechCoherence: mseSelector.optional(),
    moodAffect: mseSelector.optional(),
  })
  .strict();

const soapSection = z.string().trim().min(1).max(10000);

export const soapPartialSchema = z
  .object({
    S: soapSection.optional(),
    O: soapSection.optional(),
    A: soapSection.optional(),
    P: soapSection.optional(),
  })
  .strict();

export const soapCompleteSchema = z
  .object({
    S: soapSection,
    O: soapSection,
    A: soapSection,
    P: soapSection,
  })
  .strict();

export const structuredDiagnosisSchema = z
  .object({
    name: z.string().trim().min(1, 'Diagnosis name is required').max(200),
    code: z.string().trim().max(30).optional(),
    type: z.enum(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL']).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const diagnosisItemSchema = z.union([
  z.string().trim().min(1).max(200),
  structuredDiagnosisSchema,
]);

export type StructuredDiagnosis = z.infer<typeof structuredDiagnosisSchema>;
export type DiagnosisItem = z.infer<typeof diagnosisItemSchema>;

function isValidDateString(v: string): boolean {
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

/** POST /ehr/encounters [DOCTOR] — independent MANUAL path, no queue required. */
export const createEncounterSchema = z
  .object({
    patientId: idText('patientId'),
    visitDate: z
      .string({ required_error: 'visitDate is required' })
      .trim()
      .min(1, 'visitDate is required')
      .refine(isValidDateString, 'visitDate must be a valid ISO-8601 date string'),
    encounterType: z
      .string({ required_error: 'encounterType is required' })
      .trim()
      .min(1, 'encounterType is required')
      .max(64),
    queueEntryId: idText('queueEntryId').optional(),
    soap: soapPartialSchema.optional(),
    mse: mseObjectSchema,
    diagnoses: z.array(diagnosisItemSchema).max(20).optional(),
    diagnosisNotes: z.string().trim().max(5000).optional(),
  })
  .strict();

/** PATCH /ehr/encounters/:id [DOCTOR] — draft-only partial edit. */
export const patchEncounterSchema = z
  .object({
    visitDate: z.string().trim().min(1).refine(isValidDateString, 'visitDate must be valid').optional(),
    encounterType: z.string().trim().min(1).max(64).optional(),
    soap: soapPartialSchema.optional(),
    mse: msePatchSchema.optional(),
    diagnoses: z.array(diagnosisItemSchema).max(20).optional(),
    diagnosisNotes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.visitDate === undefined &&
      val.encounterType === undefined &&
      val.soap === undefined &&
      val.mse === undefined &&
      val.diagnoses === undefined &&
      val.diagnosisNotes === undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one field must be provided' });
    }
  });

/** POST /ehr/encounters/:id/sign [DOCTOR] — explicit sign with OCC + review attestation. */
export const signEncounterSchema = z
  .object({
    rowVersion: z.number({ required_error: 'rowVersion is required' }).int().min(1),
    reviewed: z
      .object({
        S: z.boolean(),
        O: z.boolean(),
        A: z.boolean(),
        P: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!(val.reviewed.S && val.reviewed.O && val.reviewed.A && val.reviewed.P)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewed'],
        message: 'all SOAP sections must be reviewed (S/O/A/P all true)',
      });
    }
  });

export const ADDENDUM_REASON_CODES = ['CORRECTION', 'CLARIFICATION', 'NEW_INFORMATION', 'OTHER'] as const;

/** POST /ehr/encounters/:id/addenda [DOCTOR] — append-only versioned addendum (SIGNED only). */
export const addendumSchema = z
  .object({
    text: z
      .string({ required_error: 'text is required' })
      .trim()
      .min(1, 'text is required')
      .max(5000),
    reasonCode: z.enum(ADDENDUM_REASON_CODES),
  })
  .strict();

export const encounterIdParamSchema = z.object({ id: idText('id') }).strict();

export const patientIdParamSchema = z.object({ id: idText('id') }).strict();

export const chartQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(50).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;
export type PatchEncounterInput = z.infer<typeof patchEncounterSchema>;
export type SignEncounterInput = z.infer<typeof signEncounterSchema>;
export type AddendumInput = z.infer<typeof addendumSchema>;
export type ChartQuery = z.infer<typeof chartQuerySchema>;
export type AddendumReasonCode = (typeof ADDENDUM_REASON_CODES)[number];
