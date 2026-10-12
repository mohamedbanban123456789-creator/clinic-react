import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

/**
 * BE-301..303 billing DTOs (CONV-02 allowlist-first).
 *
 * Invoice/Receipt hold NO clinical columns (DB-02/DB-18), so there is nothing
 * sensitive to accidentally expose. Every response is still branded
 * `SecretSafe<T>` via an explicit `toSecret*` mapper — the global sanitizer
 * fail-closes any unbranded SECRETARY 2xx payload, and replay re-marks cached
 * bodies. Money is integer minor units throughout (RPS-2).
 */

export type InvoiceStatusDto = 'UNPAID' | 'PARTIAL' | 'PAID' | 'COMPLIMENTARY' | 'WRITTEN_OFF';
export type ReceiptTypeDto = 'CHARGE' | 'REVERSAL';
export type PaymentMethodDto = 'CASH' | 'OTHER';

export interface CheckoutDto {
  readonly invoiceId: string;
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly receiptId: string | null;
  readonly receiptType: ReceiptTypeDto | null;
  readonly status: InvoiceStatusDto;
  readonly standardFeeMinor: number;
  readonly finalFeeMinor: number;
  readonly discountMinor: number;
  readonly discountReason: string | null;
  readonly collectedMinor: number;
  readonly outstandingMinor: number;
  readonly isComplimentary: boolean;
  readonly method: PaymentMethodDto;
  readonly createdAt: string;
}

export interface ComplimentaryDto {
  readonly invoiceId: string;
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly receiptId: string;
  readonly status: InvoiceStatusDto;
  readonly standardFeeMinor: number;
  readonly finalFeeMinor: number;
  readonly collectedMinor: number;
  readonly outstandingMinor: number;
  readonly authorizedByUserId: string;
  readonly createdAt: string;
}

export interface ReceiptDto {
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly shiftId: string;
  readonly type: ReceiptTypeDto;
  readonly amountMinor: number;
  readonly method: PaymentMethodDto;
  readonly reversalOfReceiptId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface PayResultDto {
  readonly invoiceId: string;
  readonly receiptId: string;
  readonly receiptType: ReceiptTypeDto;
  readonly status: InvoiceStatusDto;
  readonly finalFeeMinor: number;
  readonly collectedMinor: number;
  readonly outstandingMinor: number;
  readonly amountMinor: number;
  readonly method: PaymentMethodDto;
}

export interface ReverseDto {
  readonly reversalReceiptId: string;
  readonly receiptType: ReceiptTypeDto;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly status: InvoiceStatusDto;
  readonly collectedMinor: number;
  readonly outstandingMinor: number;
}

export interface SettleLineDto {
  readonly invoiceId: string;
  readonly receiptId: string;
  readonly amountMinor: number;
  readonly status: InvoiceStatusDto;
}

export interface SettleDto {
  readonly patientId: string;
  readonly amountMinor: number;
  readonly appliedMinor: number;
  readonly remainingMinor: number;
  readonly outstandingMinor: number;
  readonly method: PaymentMethodDto;
  readonly lines: readonly SettleLineDto[];
}

/** POST /billing/invoices/:id/write-off — DB-17 (RPS-2 API contract shape). */
export interface WriteOffDto {
  readonly invoiceId: string;
  readonly status: InvoiceStatusDto;
  readonly writeOffMinor: number;
  readonly outstandingMinor: number;
}

/** GET /billing list item — exact contract fields (operational only). */
export interface InvoiceListItemDto {
  readonly invoiceId: string;
  readonly patientId: string;
  readonly queueEntryId: string;
  readonly standardFeeMinor: number;
  readonly finalFeeMinor: number;
  readonly discountMinor: number;
  readonly discountReason: string | null;
  readonly status: InvoiceStatusDto;
  readonly collectedMinor: number;
  readonly writeOffMinor: number;
  readonly outstandingMinor: number;
  readonly createdAt: string;
}

export interface InvoiceListDto {
  readonly data: readonly InvoiceListItemDto[];
  readonly nextCursor: string | null;
}

/** GET /patients/:id/balance — outstanding debt rollup with per-invoice lines. */
export interface PatientBalanceLineDto {
  readonly invoiceId: string;
  readonly date: string;
  readonly dueMinor: number;
  readonly collectedMinor: number;
  readonly writeOffMinor: number;
}

export interface PatientBalanceDto {
  readonly patientId: string;
  readonly outstandingMinor: number;
  readonly lines: readonly PatientBalanceLineDto[];
}

export interface ReceiptListDto {
  readonly data: readonly ReceiptDto[];
  readonly nextCursor: string | null;
}

/** DB row shapes consumed by the mappers (operational projection only). */
export interface InvoiceRow {
  readonly id: string;
  readonly patientId: string;
  readonly queueEntryId: string;
  readonly standardFeeMinor: number;
  readonly finalFeeMinor: number;
  readonly discountMinor: number;
  readonly discountReason: string | null;
  readonly isComplimentary: boolean;
  readonly collectedMinor: number;
  readonly writeOffMinor: number;
  readonly outstandingMinor: number;
  readonly status: InvoiceStatusDto;
  readonly complimentaryAuthorizedByUserId: string | null;
  readonly createdAt: Date;
}

export interface ReceiptRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly shiftId: string;
  readonly type: ReceiptTypeDto;
  readonly amountMinor: number;
  readonly paymentMethod: PaymentMethodDto;
  readonly reversalOfReceiptId: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export function toInvoiceRow(row: {
  id: string;
  patientId: string;
  queueEntryId: string;
  standardFeeMinor: number;
  finalFeeMinor: number;
  discountMinor: number;
  discountReason: string | null;
  isComplimentary: boolean;
  collectedMinor: number;
  writeOffMinor: number;
  outstandingMinor: number;
  status: string;
  complimentaryAuthorizedByUserId: string | null;
  createdAt: Date;
}): InvoiceRow {
  return {
    id: row.id,
    patientId: row.patientId,
    queueEntryId: row.queueEntryId,
    standardFeeMinor: row.standardFeeMinor,
    finalFeeMinor: row.finalFeeMinor,
    discountMinor: row.discountMinor,
    discountReason: row.discountReason,
    isComplimentary: row.isComplimentary,
    collectedMinor: row.collectedMinor,
    writeOffMinor: row.writeOffMinor,
    outstandingMinor: row.outstandingMinor,
    status: row.status as InvoiceStatusDto,
    complimentaryAuthorizedByUserId: row.complimentaryAuthorizedByUserId,
    createdAt: row.createdAt,
  };
}

export function toReceiptRow(row: {
  id: string;
  invoiceId: string;
  patientId: string;
  shiftId: string;
  type: string;
  amountMinor: number;
  paymentMethod: string;
  reversalOfReceiptId: string | null;
  reason: string | null;
  createdAt: Date;
}): ReceiptRow {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    patientId: row.patientId,
    shiftId: row.shiftId,
    type: row.type as ReceiptTypeDto,
    amountMinor: row.amountMinor,
    paymentMethod: row.paymentMethod as PaymentMethodDto,
    reversalOfReceiptId: row.reversalOfReceiptId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export function toSecretCheckoutDto(
  invoice: InvoiceRow,
  receipt: ReceiptRow | null,
  method: PaymentMethodDto,
): SecretSafe<CheckoutDto> {
  return markSecretSafe<CheckoutDto>({
    invoiceId: invoice.id,
    queueEntryId: invoice.queueEntryId,
    patientId: invoice.patientId,
    receiptId: receipt?.id ?? null,
    receiptType: receipt?.type ?? null,
    status: invoice.status,
    standardFeeMinor: invoice.standardFeeMinor,
    finalFeeMinor: invoice.finalFeeMinor,
    discountMinor: invoice.discountMinor,
    discountReason: invoice.discountReason,
    collectedMinor: invoice.collectedMinor,
    outstandingMinor: invoice.outstandingMinor,
    isComplimentary: invoice.isComplimentary,
    method,
    createdAt: invoice.createdAt.toISOString(),
  });
}

export function toSecretComplimentaryDto(
  invoice: InvoiceRow,
  receipt: ReceiptRow,
  authorizedByUserId: string,
): SecretSafe<ComplimentaryDto> {
  return markSecretSafe<ComplimentaryDto>({
    invoiceId: invoice.id,
    queueEntryId: invoice.queueEntryId,
    patientId: invoice.patientId,
    receiptId: receipt.id,
    status: invoice.status,
    standardFeeMinor: invoice.standardFeeMinor,
    finalFeeMinor: invoice.finalFeeMinor,
    collectedMinor: invoice.collectedMinor,
    outstandingMinor: invoice.outstandingMinor,
    authorizedByUserId,
    createdAt: invoice.createdAt.toISOString(),
  });
}

export function toSecretReceiptDto(receipt: ReceiptRow): SecretSafe<ReceiptDto> {
  return markSecretSafe<ReceiptDto>({
    receiptId: receipt.id,
    invoiceId: receipt.invoiceId,
    patientId: receipt.patientId,
    shiftId: receipt.shiftId,
    type: receipt.type,
    amountMinor: receipt.amountMinor,
    method: receipt.paymentMethod,
    reversalOfReceiptId: receipt.reversalOfReceiptId,
    reason: receipt.reason,
    createdAt: receipt.createdAt.toISOString(),
  });
}

export function toSecretPayResultDto(
  invoice: InvoiceRow,
  receipt: ReceiptRow,
  amountMinor: number,
  method: PaymentMethodDto,
): SecretSafe<PayResultDto> {
  return markSecretSafe<PayResultDto>({
    invoiceId: invoice.id,
    receiptId: receipt.id,
    receiptType: receipt.type,
    status: invoice.status,
    finalFeeMinor: invoice.finalFeeMinor,
    collectedMinor: invoice.collectedMinor,
    outstandingMinor: invoice.outstandingMinor,
    amountMinor,
    method,
  });
}

export function toSecretReverseDto(invoice: InvoiceRow, reversal: ReceiptRow): SecretSafe<ReverseDto> {
  return markSecretSafe<ReverseDto>({
    reversalReceiptId: reversal.id,
    receiptType: reversal.type,
    invoiceId: invoice.id,
    amountMinor: reversal.amountMinor,
    status: invoice.status,
    collectedMinor: invoice.collectedMinor,
    outstandingMinor: invoice.outstandingMinor,
  });
}

export function toSecretSettleDto(
  patientId: string,
  amountMinor: number,
  method: PaymentMethodDto,
  lines: readonly SettleLineDto[],
  outstandingMinor: number,
): SecretSafe<SettleDto> {
  const appliedMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  return markSecretSafe<SettleDto>({
    patientId,
    amountMinor,
    appliedMinor,
    remainingMinor: amountMinor - appliedMinor,
    outstandingMinor,
    method,
    lines,
  });
}

export function toSecretReceiptListDto(
  receipts: readonly SecretSafe<ReceiptDto>[],
  nextCursor: string | null,
): SecretSafe<ReceiptListDto> {
  return markSecretSafe<ReceiptListDto>({ data: receipts, nextCursor });
}

/** DB-17 write-off result — allowlist-first (only picked keys leave the server). */
export function toSecretWriteOffDto(
  invoiceId: string,
  status: InvoiceStatusDto,
  writeOffMinor: number,
  outstandingMinor: number,
): SecretSafe<WriteOffDto> {
  return markSecretSafe<WriteOffDto>({ invoiceId, status, writeOffMinor, outstandingMinor });
}

/** GET /billing list item mapper (contract-exact field pick). */
export function toSecretInvoiceDto(row: InvoiceRow): SecretSafe<InvoiceListItemDto> {
  return markSecretSafe<InvoiceListItemDto>({
    invoiceId: row.id,
    patientId: row.patientId,
    queueEntryId: row.queueEntryId,
    standardFeeMinor: row.standardFeeMinor,
    finalFeeMinor: row.finalFeeMinor,
    discountMinor: row.discountMinor,
    discountReason: row.discountReason,
    status: row.status,
    collectedMinor: row.collectedMinor,
    writeOffMinor: row.writeOffMinor,
    outstandingMinor: row.outstandingMinor,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toSecretInvoiceListDto(
  invoices: readonly SecretSafe<InvoiceListItemDto>[],
  nextCursor: string | null,
): SecretSafe<InvoiceListDto> {
  return markSecretSafe<InvoiceListDto>({ data: invoices, nextCursor });
}

export function toSecretPatientBalanceDto(
  patientId: string,
  outstandingMinor: number,
  lines: readonly PatientBalanceLineDto[],
): SecretSafe<PatientBalanceDto> {
  return markSecretSafe<PatientBalanceDto>({ patientId, outstandingMinor, lines });
}
