import { z } from 'zod';

/**
 * BE-202 validators (Zod sole validation; failure -> 422 envelope).
 * Reason codes are free-form non-blank strings for now — RPS-2 fixes the
 * clinical vocabulary later; the engine only persists + audits them.
 */

const reasonCode = (field: string, max: number): z.ZodString =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} must be a string` })
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be at most ${max} characters`);

export const entryIdParamSchema = z.object({
  entryId: z.string().trim().min(1, 'entryId is required').max(64),
});

export const checkInSchema = z
  .object({
    patientId: z.string({ required_error: 'patientId is required' }).trim().min(1).max(64),
    isEmergency: z.boolean().optional(),
    emergencyReasonCode: reasonCode('emergencyReasonCode', 120).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.isEmergency === true && val.emergencyReasonCode === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['emergencyReasonCode'],
        message: 'emergencyReasonCode is required when isEmergency is true',
      });
    }
  });

export const queueQuerySchema = z
  .object({
    shiftId: z.string().trim().min(1).max(64).optional(),
    status: z
      .enum(['WAITING', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED', 'NO_SHOW', 'ABANDONED'])
      .optional(),
  })
  .strict();

export const callNextSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

export const deferDocumentationSchema = z
  .object({
    reason: z
      .string({ required_error: 'reason is required', invalid_type_error: 'reason must be a string' })
      .trim()
      .min(3, 'reason must be at least 3 characters')
      .max(300, 'reason must be at most 300 characters'),
  })
  .strict();

export type DeferDocumentationInput = z.infer<typeof deferDocumentationSchema>;

export const callSchema = z
  .object({
    outOfOrderReasonCode: reasonCode('outOfOrderReasonCode', 120).optional(),
    // Force call: when another entry is IN_CONSULTATION, it is moved to SKIPPED
    // (audited FORCED_CALLNEXT) so the target can be called. Mirrors call-next force.
    force: z.boolean().optional(),
  })
  .strict();

export const requeueSchema = z
  .object({
    position: z.enum(['FRONT', 'ORIGINAL']).optional(),
  })
  .strict();

export const noShowSchema = z
  .object({
    reasonCode: reasonCode('reasonCode', 120),
  })
  .strict();

export const abandonSchema = z
  .object({
    reasonCode: reasonCode('reasonCode', 120),
    billable: z.boolean(),
  })
  .strict();

export const debtAckSchema = z.object({}).strict();

/**
 * API-06 undo-complete body: `{ reason }` required (non-blank), optional
 * `lastSeenQueueVersion` OCC guard (409 STALE_QUEUE when present and stale).
 * The Idempotency-Key header is enforced by the idempotency middleware.
 */
export const undoCompleteSchema = z
  .object({
    reason: reasonCode('reason', 300),
    lastSeenQueueVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * BE-203 Emergency reason vocabulary (coded, RPS-2 — no free text on the toggle).
 * Same closed set is enforced on check-in via emergencyReasonCode; the toggle
 * endpoint accepts ONLY these values.
 */
export const EMERGENCY_REASON_CODES = [
  'DOCTOR_DIRECTED',
  'VISIBLE_DISTRESS',
  'FAMILY_ESCALATION',
  'PRE_ARRANGED_URGENT',
  'OTHER_URGENT',
] as const;

export const emergencyReasonCodeSchema = z.enum(EMERGENCY_REASON_CODES);

/** BE-203 Manual reorder body (OCC + exact non-emergency WAITING ordering). */
export const reorderSchema = z
  .object({
    lastSeenQueueVersion: z.number({ required_error: 'lastSeenQueueVersion is required' }).int().nonnegative(),
    orderedEntryIds: z
      .array(z.string().trim().min(1).max(64), { required_error: 'orderedEntryIds is required' })
      .min(1, 'orderedEntryIds must not be empty'),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const id of val.orderedEntryIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['orderedEntryIds'],
          message: 'orderedEntryIds must not contain duplicates',
        });
        break;
      }
      seen.add(id);
    }
  });

/**
 * BE-203 Emergency toggle body.
 * - `lastSeenQueueVersion` is optional here (ticket body is minimal) but, when
 *   present, is enforced as OCC against Shift.queueVersion (CONV-05/API-07).
 */
export const emergencyToggleSchema = z
  .object({
    isEmergency: z.boolean({ required_error: 'isEmergency is required' }),
    reasonCode: emergencyReasonCodeSchema.optional(),
    lastSeenQueueVersion: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.isEmergency === true && val.reasonCode === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'reasonCode is required when isEmergency is true',
      });
    }
  });

/** BE-203 Wait-time query (shiftId optional; defaults to the OPEN shift). */
export const waitTimesQuerySchema = z
  .object({
    shiftId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const createCallRequestSchema = z
  .object({
    entryId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const callRequestIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
  })
  .strict();

export type CheckInInput = z.infer<typeof checkInSchema>;
export type QueueQuery = z.infer<typeof queueQuerySchema>;
export type CallNextInput = z.infer<typeof callNextSchema>;
export type CallInput = z.infer<typeof callSchema>;
export type RequeueInput = z.infer<typeof requeueSchema>;
export type NoShowInput = z.infer<typeof noShowSchema>;
export type AbandonInput = z.infer<typeof abandonSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type EmergencyToggleInput = z.infer<typeof emergencyToggleSchema>;
export type WaitTimesQuery = z.infer<typeof waitTimesQuerySchema>;
export type EmergencyReasonCode = z.infer<typeof emergencyReasonCodeSchema>;
export type UndoCompleteInput = z.infer<typeof undoCompleteSchema>;
export type CreateCallRequestInput = z.infer<typeof createCallRequestSchema>;

