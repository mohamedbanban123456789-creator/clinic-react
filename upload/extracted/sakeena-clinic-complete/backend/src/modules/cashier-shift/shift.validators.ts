import { z } from 'zod';

/**
 * BE-304 / BE-305 / BE-306 validators (Zod sole validation; failure -> 422).
 * Money is integer minor units (RPS-2). All bodies `.strict()` so an unknown
 * key is a 422 rather than a silently-ignored field.
 */

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

const nonNegativeMinor = (field: string): z.ZodNumber =>
  z.number({ required_error: `${field} is required`, invalid_type_error: `${field} must be an integer` })
    .int(`${field} must be an integer`)
    .nonnegative(`${field} must be >= 0`);

const trimmedText = (field: string, min: number, max: number): z.ZodString =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} must be a string` })
    .trim()
    .min(min, `${field} must be at least ${min} characters`)
    .max(max, `${field} must be at most ${max} characters`);

const pettyDirection = z.enum(['EXPENSE', 'INJECTION'], {
  required_error: 'direction is required',
  invalid_type_error: "direction must be 'EXPENSE' or 'INJECTION'",
});

/** POST /shifts/:id/petty [BOTH] — BE-304. */
export const pettyCreateSchema = z
  .object({
    amountMinor: z
      .number({ required_error: 'amountMinor is required', invalid_type_error: 'amountMinor must be an integer' })
      .int('amountMinor must be an integer')
      .positive('amountMinor must be > 0'),
    direction: pettyDirection,
    category: trimmedText('category', 1, 60),
    description: trimmedText('description', 1, 300),
    receiptRef: idText('receiptRef').optional(),
  })
  .strict();

export type PettyCreateInput = z.infer<typeof pettyCreateSchema>;

/** GET /shifts/:id/petty [BOTH] — ?limit&cursor. */
export const pettyListQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(200).optional(),
    cursor: idText('cursor').optional(),
  })
  .strict();

export type PettyListQuery = z.infer<typeof pettyListQuerySchema>;

/**
 * POST /shifts/open [BOTH] — BE-305.
 * `openingCountMinor` is the BLIND physical count of the drawer. The server
 * derives the carry-forward; the caller never supplies it.
 */
export const shiftOpenSchema = z
  .object({
    openingCountMinor: nonNegativeMinor('openingCountMinor'),
    businessDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be an ISO calendar date (YYYY-MM-DD)')
      .optional(),
  })
  .strict();

export type ShiftOpenInput = z.infer<typeof shiftOpenSchema>;

/**
 * POST /shifts/:id/close [BOTH] — BE-305 blind two-phase close.
 * `force` + `forceReason` are the doctor escape hatch for open entries /
 * invariant failures; both required together (reason >= 10 chars).
 */
export const shiftCloseSchema = z
  .object({
    actualCountedMinor: nonNegativeMinor('actualCountedMinor'),
    force: z.boolean().optional(),
    forceReason: trimmedText('forceReason', 10, 300).optional(),
    reason: trimmedText('reason', 3, 300).optional(),
    closeReason: trimmedText('closeReason', 3, 300).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasReason = val.forceReason !== undefined || val.reason !== undefined || val.closeReason !== undefined;
    if (val.force === true && !hasReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forceReason'],
        message: 'forceReason or reason is required when force is true',
      });
    }
    if (val.force !== true && val.forceReason !== undefined && val.reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['force'],
        message: 'forceReason requires force: true',
      });
    }
  });

export type ShiftCloseInput = z.infer<typeof shiftCloseSchema>;

/**
 * POST /supervision/shifts/:id/ack [DOCTOR] — BE-305 async review.
 * `note` becomes mandatory (min 10 chars) when the variance is non-zero; that
 * cross-field rule needs the persisted shift, so it is enforced in the service.
 */
export const shiftAckSchema = z
  .object({
    note: trimmedText('note', 10, 1000).optional(),
  })
  .strict();

export type ShiftAckInput = z.infer<typeof shiftAckSchema>;

/** POST /supervision/integrity-check [DOCTOR] — BE-306. */
export const integrityCheckSchema = z
  .object({
    shiftId: idText('shiftId'),
  })
  .strict();

export type IntegrityCheckInput = z.infer<typeof integrityCheckSchema>;

export const shiftIdParamSchema = z.object({ id: idText('id') }).strict();
export type ShiftIdParam = z.infer<typeof shiftIdParamSchema>;
