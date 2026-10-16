import { z } from 'zod';
import type { IntercomType, Role } from '@prisma/client';

/**
 * BE-402 intercom validators (Zod sole validation; failure -> 422 envelope).
 *
 * Role-type ownership (ticket): a socket may only send types its role owns.
 * Forging another role's type is rejected with a FORBIDDEN error frame (no
 * broadcast). CUSTOM_TEXT is shared by both roles.
 *
 *   DOCTOR    -> DOCTOR_NEXT, DOCTOR_FOLLOWUP, CUSTOM_TEXT
 *                (DOCTOR_COMPLIMENTARY is NOTIFICATION-ONLY — never a chat write;
 *                 financial complimentary stays a REST path, so it is not sendable here.)
 *   SECRETARY -> SEC_DISRUPTION, SEC_PHARMACY_LAB, SEC_CORRECTION_REQUEST, CUSTOM_TEXT
 */
export const INTERCOM_TYPES: readonly IntercomType[] = [
  'DOCTOR_COMPLIMENTARY',
  'DOCTOR_NEXT',
  'DOCTOR_FOLLOWUP',
  'SEC_DISRUPTION',
  'SEC_PHARMACY_LAB',
  'SEC_CORRECTION_REQUEST',
  'CUSTOM_TEXT',
];

export const OWNERSHIP: Readonly<Record<Role, readonly IntercomType[]>> = {
  DOCTOR: ['DOCTOR_NEXT', 'DOCTOR_FOLLOWUP', 'CUSTOM_TEXT'],
  SECRETARY: ['SEC_DISRUPTION', 'SEC_PHARMACY_LAB', 'SEC_CORRECTION_REQUEST', 'CUSTOM_TEXT'],
};

/** True when `role` is permitted to send `type`. Pure + unit-testable. */
export function ownershipAllows(role: Role, type: IntercomType): boolean {
  const allowed = OWNERSHIP[role];
  return allowed !== undefined && allowed.includes(type);
}

const MAX_TEXT = 1000;
const MAX_CODE = 64;

/**
 * CANONICAL follow-up vocabulary (Decision 5 — single source of truth).
 *
 * The application supports exactly ONE follow-up scenario today: a doctor
 * requests a general follow-up for a patient at their next visit (created via
 * DOCTOR_FOLLOWUP on POST /intercom; the doctor's typed note is the actionable
 * instruction the desk works from). Both vocabularies are therefore closed
 * one-value enums — explicit, validated, and extensible ONLY by a schema +
 * validator + DTO + UI change, never by free text. The desk labels live in the
 * frontend label maps; the wire contract uses these values everywhere.
 */
export const FOLLOWUP_TYPES = ['GENERAL'] as const;
export const FOLLOWUP_WINDOWS = ['NEXT_VISIT'] as const;

export const followUpTypeSchema = z.enum(FOLLOWUP_TYPES);
export const followUpWindowSchema = z.enum(FOLLOWUP_WINDOWS);

/** Follow-up descriptor carried on a DOCTOR_FOLLOWUP message. */
export const followUpSchema = z
  .object({
    followUpType: followUpTypeSchema,
    window: followUpWindowSchema,
  })
  .strict();

export const intercomSendSchema = z
  .object({
    type: z.enum([
      'DOCTOR_COMPLIMENTARY',
      'DOCTOR_NEXT',
      'DOCTOR_FOLLOWUP',
      'SEC_DISRUPTION',
      'SEC_PHARMACY_LAB',
      'SEC_CORRECTION_REQUEST',
      'CUSTOM_TEXT',
    ] as const),
    code1: z.string().trim().min(1).max(MAX_CODE).optional(),
    code2: z.string().trim().min(1).max(MAX_CODE).optional(),
    text: z.string().trim().max(MAX_TEXT).optional(),
    relatedQueueEntryId: z.string().trim().min(1).max(64).optional(),
    relatedReceiptId: z.string().trim().min(1).max(64).optional(),
    followUp: followUpSchema.optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.type === 'CUSTOM_TEXT' && (val.text === undefined || val.text.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'text is required for CUSTOM_TEXT',
      });
    }
    if (val.type === 'DOCTOR_FOLLOWUP' && val.followUp === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['followUp'],
        message: 'followUp { followUpType, window } is required for DOCTOR_FOLLOWUP',
      });
    }
  });

export const intercomHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const followupsQuerySchema = z
  .object({
    patientId: z.string().trim().min(1).max(64).optional(),
    status: z.enum(['REQUESTED', 'SCHEDULED', 'DONE', 'CANCELLED']).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const followupIdParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
});

export const followupPatchSchema = z
  .object({
    status: z.enum(['REQUESTED', 'SCHEDULED', 'DONE', 'CANCELLED']),
  })
  .strict();

export type IntercomSendInput = z.infer<typeof intercomSendSchema>;
export type IntercomHistoryQuery = z.infer<typeof intercomHistoryQuerySchema>;
export type FollowupsQuery = z.infer<typeof followupsQuerySchema>;
export type FollowUpPatch = z.infer<typeof followupPatchSchema>;
