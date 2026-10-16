import { z } from 'zod';

/**
 * PUT /api/v1/settings validator (Zod sole validation; failure -> 422).
 * Partial update: any subset of the public settings may be provided; at least
 * one field is required. Bounds mirror the clinical/fiscal sanity limits.
 */
export const updateSettingsSchema = z
  .object({
    standardFeeMinor: z.number().int().nonnegative('standardFeeMinor must be a non-negative integer').max(10_000_000).optional(),
    currency: z.string().trim().min(3, 'currency must be at least 3 characters').max(8, 'currency must be at most 8 characters').optional(),
    avgConsultDurationMin: z.number().int().min(1, 'avgConsultDurationMin must be >= 1').max(240).optional(),
    openingFloatMinor: z.number().int().nonnegative('openingFloatMinor must be a non-negative integer').optional(),
    secretaryMaxDiscountMinor: z.number().int().nonnegative('secretaryMaxDiscountMinor must be a non-negative integer').optional(),
    secretaryMaxDiscountPct: z.number().int().min(0, 'secretaryMaxDiscountPct must be >= 0').max(100, 'secretaryMaxDiscountPct must be <= 100').optional(),
    audioRetentionDays: z.number().int().min(1, 'audioRetentionDays must be >= 1').max(365, 'audioRetentionDays must be <= 365').optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: 'at least one setting field is required',
    path: ['standardFeeMinor'],
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
