import { z } from 'zod';

/**
 * BE-702 supervision validators (Zod sole validation; failure -> 422 envelope).
 *
 * All supervision endpoints are DOCTOR-only (`requireRole('DOCTOR')` runs before
 * any lookup). Money is integer minor units. Every query schema is `.strict()`
 * so an unknown key is a 422 rather than a silently-ignored field.
 *
 * Scope resolution (service-level):
 * - `shiftId` pins a single Shift row (404 when unknown).
 * - `clinicDayId` is an alias accepted on day-scoped feeds: it resolves first
 *   as a Shift id, then as a `YYYY-MM-DD` businessDate. The clinic runs a single
 *   shift per businessDate (unique), so a day maps to at most one shift.
 * - When neither is supplied, the OPEN shift is used, else the latest shift.
 */

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

const optionalId = (field: string): z.ZodOptional<z.ZodString> =>
  z.string().trim().min(1, `${field} is required`).max(64).optional();

const limitField = z.coerce.number().int().positive().max(200).optional();
const cursorField = optionalId('cursor');

/** Shared day/shift scope for feed endpoints (at least one scoping key is optional). */
export const shiftScopeQuerySchema = z
  .object({
    shiftId: optionalId('shiftId'),
    clinicDayId: optionalId('clinicDayId'),
    limit: limitField,
    cursor: cursorField,
  })
  .strict();

export type ShiftScopeQuery = z.infer<typeof shiftScopeQuerySchema>;

/** GET /supervision/front-desk-activity?shiftId=&clinicDayId= [DOCTOR]. */
export const frontDeskActivityQuerySchema = shiftScopeQuerySchema;
export type FrontDeskActivityQuery = z.infer<typeof frontDeskActivityQuerySchema>;

/** GET /supervision/cash-summary?shiftId= [DOCTOR] — shiftId required per contract. */
export const cashSummaryQuerySchema = z
  .object({
    shiftId: idText('shiftId'),
  })
  .strict();

export type CashSummaryQuery = z.infer<typeof cashSummaryQuerySchema>;

/** GET /supervision/shifts?unacked=&varianceOnly= [DOCTOR] — async review queue. */
const flagString = z.enum(['true', 'false']);

export const supervisionShiftsQuerySchema = z
  .object({
    unacked: flagString.optional(),
    varianceOnly: flagString.optional(),
    limit: limitField,
    cursor: cursorField,
  })
  .strict();

export type SupervisionShiftsQuery = z.infer<typeof supervisionShiftsQuerySchema>;

/** GET /supervision/unsigned-notes?shiftId= [DOCTOR] — shift-scoped safety monitor. */
export const unsignedNotesQuerySchema = z
  .object({
    shiftId: optionalId('shiftId'),
  })
  .strict();

export type UnsignedNotesQuery = z.infer<typeof unsignedNotesQuerySchema>;

/** GET /supervision/discounts?shiftId= [DOCTOR] — shiftId required per contract. */
export const discountsQuerySchema = z
  .object({
    shiftId: idText('shiftId'),
  })
  .strict();

export type DiscountsQuery = z.infer<typeof discountsQuerySchema>;

/** GET /supervision/noncash?clinicDayId=&shiftId= [DOCTOR] — day-scoped wallet reconciliation. */
export const nonCashQuerySchema = shiftScopeQuerySchema;
export type NonCashQuery = z.infer<typeof nonCashQuerySchema>;

/** GET /supervision/exceptions?clinicDayId=&shiftId= [DOCTOR] — day-scoped discrepancy feed. */
export const exceptionsQuerySchema = shiftScopeQuerySchema;
export type ExceptionsQuery = z.infer<typeof exceptionsQuerySchema>;

/** GET /supervision/discrepancies?shiftId= [DOCTOR] (RPS-2 BE-702 INV gate view). */
export const discrepanciesQuerySchema = z
  .object({
    shiftId: idText('shiftId'),
  })
  .strict();

export type DiscrepanciesQuery = z.infer<typeof discrepanciesQuerySchema>;

/** GET /supervision/shift-readiness?shiftId= [DOCTOR] (close-readiness probe). */
export const shiftReadinessQuerySchema = z
  .object({
    shiftId: idText('shiftId'),
  })
  .strict();

export type ShiftReadinessQuery = z.infer<typeof shiftReadinessQuerySchema>;
