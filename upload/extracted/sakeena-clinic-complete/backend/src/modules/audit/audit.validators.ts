import { AuditAction } from '@prisma/client';
import { z } from 'zod';

/**
 * BE-701 GET /audit query validator (Zod sole validation; failure -> 422).
 * Feedback: filters for date range / actor / entity + cursor pagination.
 */

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

/** ISO datetime (or date) string -> Date for Prisma range filters. */
const isoDate = (field: string): z.ZodEffects<z.ZodString, Date, string> =>
  z
    .string({ required_error: `${field} is required` })
    .datetime({ offset: true, message: `${field} must be an ISO 8601 datetime` })
    .transform((v) => new Date(v));

export const auditQuerySchema = z
  .object({
    action: z.nativeEnum(AuditAction).optional(),
    entityType: idText('entityType').optional(),
    entityId: idText('entityId').optional(),
    actorUserId: idText('actorUserId').optional(),
    startDate: isoDate('startDate').optional(),
    endDate: isoDate('endDate').optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    cursor: idText('cursor').optional(),
  })
  .strict()
  .refine((v) => v.startDate === undefined || v.endDate === undefined || v.startDate.getTime() <= v.endDate.getTime(), {
    message: 'startDate must be <= endDate',
    path: ['startDate'],
  });

export type AuditQuery = z.infer<typeof auditQuerySchema>;
