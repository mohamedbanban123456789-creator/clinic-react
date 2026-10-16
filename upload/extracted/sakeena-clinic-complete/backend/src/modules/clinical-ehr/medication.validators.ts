import { z } from 'zod';

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

export const CESSATION_REASON_CODES = [
  'RESOLVED',
  'SIDE_EFFECTS',
  'INEFFECTIVE',
  'NON_ADHERENCE',
  'DOSE_ADJUSTED',
  'CONTRAINDICATED',
  'OTHER',
] as const;

export const cessationReasonCodeSchema = z.enum(CESSATION_REASON_CODES);

/** POST /ehr/patients/:id/medications [DOCTOR] */
export const createMedicationSchema = z
  .object({
    drugName: z.string({ required_error: 'drugName is required' }).trim().min(1).max(200),
    dosage: z.string({ required_error: 'dosage is required' }).trim().min(1).max(200),
    frequency: z.string({ required_error: 'frequency is required' }).trim().min(1).max(200),
    instructions: z.string({ required_error: 'instructions is required' }).trim().min(1).max(1000),
    encounterId: idText('encounterId').optional(),
  })
  .strict();

/** POST /ehr/medications/:id/discontinue [DOCTOR] */
export const discontinueMedicationSchema = z
  .object({
    cessationReasonCode: cessationReasonCodeSchema,
    cessationNote: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.cessationReasonCode === 'OTHER' && (val.cessationNote === undefined || val.cessationNote.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cessationNote'],
        message: 'cessationNote is required when cessationReasonCode is OTHER',
      });
    }
  });

/** POST /ehr/medications/:id/adjust [DOCTOR] — titration (≥1 field). */
export const adjustMedicationSchema = z
  .object({
    dosage: z.string().trim().min(1).max(200).optional(),
    frequency: z.string().trim().min(1).max(200).optional(),
    instructions: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.dosage === undefined && val.frequency === undefined && val.instructions === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one of dosage, frequency, instructions is required' });
    }
  });

export const medicationIdParamSchema = z.object({ id: idText('id') }).strict();

export const patientIdParamSchema = z.object({ id: idText('id') }).strict();

export const medicationListQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISCONTINUED']).optional(),
  })
  .strict();

export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;
export type DiscontinueMedicationInput = z.infer<typeof discontinueMedicationSchema>;
export type AdjustMedicationInput = z.infer<typeof adjustMedicationSchema>;
export type MedicationListQuery = z.infer<typeof medicationListQuerySchema>;
export type CessationReasonCode = z.infer<typeof cessationReasonCodeSchema>;
