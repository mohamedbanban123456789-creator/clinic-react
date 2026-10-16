import { z } from 'zod';

const nonBlank = (field: string, max: number): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(max);

const optionalText = (max: number): z.ZodOptional<z.ZodString> =>
  z.string().trim().min(1).max(max).optional();

const pastIsoDate = z
  .string({ required_error: 'dateOfBirth is required' })
  .trim()
  .min(1, 'dateOfBirth is required')
  .refine(
    (raw) => {
      const time = Date.parse(raw);
      if (Number.isNaN(time)) return false;
      const at = new Date(time);
      const now = Date.now();
      if (at.getTime() > now) return false;
      const ageYears = (now - at.getTime()) / (365.25 * 24 * 3600 * 1000);
      return ageYears >= 0 && ageYears <= 130;
    },
    { message: 'dateOfBirth must be a valid past date within the last 130 years' },
  );

/**
 * BE-201 validators (Zod sole validation; failure -> 422 envelope).
 * Cross-field rules (identity anchor, crisis completeness, duplicates) live in
 * the service so they map to exact 409/422 codes with candidate details.
 */
export const createPatientSchema = z.object({
  fullName: nonBlank('fullName', 120),
  dateOfBirth: pastIsoDate,
  phone: optionalText(32),
  nationalId: optionalText(64),
  guardianPhone: optionalText(32),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(32),
  emergencyContactRelation: optionalText(64),
  physicalAddress: optionalText(500),
  adminNotes: z.string().trim().max(500, 'adminNotes must be at most 500 characters').optional(),
  crisis: z.boolean().optional().default(false),
  confirmNotDuplicate: z.boolean().optional().default(false),
});

export const searchPatientsQuerySchema = z.object({
  q: z.string({ required_error: 'q is required' }).trim().min(3, 'q must be at least 3 characters').max(120),
});

export const patientIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(64),
});

export const patchPatientSchema = z
  .object({
    phone: optionalText(32),
    guardianPhone: optionalText(32),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalText(32),
    emergencyContactRelation: optionalText(64),
    physicalAddress: optionalText(500),
    adminNotes: z.string().trim().max(500, 'adminNotes must be at most 500 characters').optional(),
  })
  .strict();

export const flagDuplicateSchema = z.object({
  canonicalPatientId: z.string({ required_error: 'canonicalPatientId is required' }).trim().min(1).max(64),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type SearchPatientsQuery = z.infer<typeof searchPatientsQuerySchema>;
export type PatchPatientInput = z.infer<typeof patchPatientSchema>;
export type FlagDuplicateInput = z.infer<typeof flagDuplicateSchema>;
