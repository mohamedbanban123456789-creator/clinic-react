import { z } from 'zod';

/**
 * BE-301..303 billing validators (Zod sole validation; failure -> 422 envelope).
 * Money is integer minor units (RPS-2). `discountReason` 10..300 chars trimmed.
 *
 * NOTE on field names: the debt-pay body accepts EITHER `amountMinor` (ticket
 * BE-302 wording) OR `collectedMinor` (API_CONTRACTS.md wording) and normalizes
 * to `amountMinor`, so both specs are satisfied. Receipt reversal uses the
 * ticket's `{ amountMinor, reason }` (partial reversal, superset of the doc's
 * full-reversal `{ reason }`).
 */

const paymentMethod = z.enum(['CASH', 'OTHER']);

const trimmedReason = (field: string, min: number, max: number): z.ZodString =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} must be a string` })
    .trim()
    .min(min, `${field} must be at least ${min} characters`)
    .max(max, `${field} must be at most ${max} characters`);

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

/** POST /billing/checkout [BOTH] */
export const checkoutSchema = z
  .object({
    queueEntryId: idText('queueEntryId'),
    collectedMinor: z.number().int().nonnegative('collectedMinor must be a non-negative integer').default(0),
    finalFeeMinor: z.number().int().nonnegative('finalFeeMinor must be a non-negative integer').optional(),
    discountReason: trimmedReason('discountReason', 10, 300).optional(),
    method: paymentMethod.optional(),
  })
  .strict();

/** POST /billing/complimentary [DOCTOR] — target exactly one of queueEntryId / invoiceId. */
export const complimentarySchema = z
  .object({
    queueEntryId: idText('queueEntryId').optional(),
    invoiceId: idText('invoiceId').optional(),
    note: trimmedReason('note', 1, 300).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasEntry = val.queueEntryId !== undefined;
    const hasInvoice = val.invoiceId !== undefined;
    if (hasEntry === hasInvoice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['queueEntryId'],
        message: 'exactly one of queueEntryId or invoiceId is required',
      });
    }
  });

/** POST /billing/invoices/:id/pay [BOTH] — accepts amountMinor or collectedMinor. */
export const payInvoiceSchema = z
  .object({
    amountMinor: z.number().int().positive('amountMinor must be > 0').optional(),
    collectedMinor: z.number().int().positive('collectedMinor must be > 0').optional(),
    method: paymentMethod.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.amountMinor === undefined && val.collectedMinor === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountMinor'],
        message: 'amountMinor is required',
      });
    }
  })
  .transform((val) => ({
    amountMinor: (val.amountMinor ?? val.collectedMinor) as number,
    ...(val.method !== undefined ? { method: val.method } : {}),
  }));

/** POST /billing/receipts/:id/reverse [DOCTOR] */
export const reverseSchema = z
  .object({
    amountMinor: z.number().int().positive('amountMinor must be > 0'),
    reason: trimmedReason('reason', 1, 300),
  })
  .strict();

/** POST /patients/:id/settle [BOTH] */
export const settleSchema = z
  .object({
    amountMinor: z.number().int().positive('amountMinor must be > 0'),
    method: paymentMethod.optional(),
  })
  .strict();

/** GET /receipts?patientId=&shiftId=&invoiceId= [BOTH] */
export const receiptsQuerySchema = z
  .object({
    patientId: idText('patientId').optional(),
    shiftId: idText('shiftId').optional(),
    invoiceId: idText('invoiceId').optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    cursor: idText('cursor').optional(),
  })
  .strict();

/** POST /billing/invoices/:id/write-off [DOCTOR] (RPS-2 DB-17) — uncollectible debt. */
export const writeOffSchema = z
  .object({
    writeOffMinor: z.number().int().positive('writeOffMinor must be > 0'),
    writeOffReason: trimmedReason('writeOffReason', 1, 300),
  })
  .strict();

/** GET /billing?shiftId=&patientId=&status=&limit=&cursor= [BOTH] — invoice list. */
export const invoicesQuerySchema = z
  .object({
    shiftId: idText('shiftId').optional(),
    patientId: idText('patientId').optional(),
    status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'COMPLIMENTARY', 'WRITTEN_OFF']).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    cursor: idText('cursor').optional(),
  })
  .strict();

export const invoiceIdParamSchema = z.object({ id: idText('id') }).strict();
export const receiptIdParamSchema = z.object({ id: idText('id') }).strict();
export const patientIdParamSchema = z.object({ id: idText('id') }).strict();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ComplimentaryInput = z.infer<typeof complimentarySchema>;
export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>;
export type ReverseInput = z.infer<typeof reverseSchema>;
export type SettleInput = z.infer<typeof settleSchema>;
export type ReceiptsQuery = z.infer<typeof receiptsQuerySchema>;
export type WriteOffInput = z.infer<typeof writeOffSchema>;
export type InvoicesQuery = z.infer<typeof invoicesQuerySchema>;
