/** Billing & receipts endpoints — /api/v1/billing, /api/v1/receipts */

import { apiRequest } from "./client"
import type {
  CheckoutDto,
  CursorPage,
  InvoiceListItemDto,
  PayInvoiceDto,
  ReceiptDto,
} from "./types"

export const billingApi = {
  invoices(query: {
    shiftId?: string
    patientId?: string
    status?: string
    limit?: number
    cursor?: string
  }): Promise<CursorPage<InvoiceListItemDto>> {
    return apiRequest("/billing", { query })
  },

  checkout(input: {
    queueEntryId: string
    collectedMinor: number
    finalFeeMinor?: number
    discountReason?: string
    method?: "CASH" | "OTHER"
  }): Promise<CheckoutDto> {
    return apiRequest("/billing/checkout", {
      method: "POST",
      body: input,
      idempotency: true,
    })
  },

  complimentary(
    input: { queueEntryId?: string; invoiceId?: string; note?: string },
  ): Promise<CheckoutDto> {
    return apiRequest("/billing/complimentary", {
      method: "POST",
      body: input,
      idempotency: true,
    })
  },

  pay(
    invoiceId: string,
    input: { amountMinor: number; method?: "CASH" | "OTHER" },
  ): Promise<PayInvoiceDto> {
    return apiRequest(`/billing/invoices/${invoiceId}/pay`, {
      method: "POST",
      body: input,
      idempotency: true,
    })
  },

  writeOff(
    invoiceId: string,
    writeOffMinor: number,
    writeOffReason: string,
  ): Promise<{ invoiceId: string; status: string; writeOffMinor: number; outstandingMinor: number }> {
    return apiRequest(`/billing/invoices/${invoiceId}/write-off`, {
      method: "POST",
      body: { writeOffMinor, writeOffReason },
      idempotency: true,
    })
  },

  receipts(query: {
    patientId?: string
    shiftId?: string
    invoiceId?: string
    limit?: number
    cursor?: string
  }): Promise<CursorPage<ReceiptDto>> {
    return apiRequest("/receipts", { query })
  },

  receipt(id: string): Promise<ReceiptDto> {
    return apiRequest(`/receipts/${id}`)
  },

  reverse(
    receiptId: string,
    amountMinor: number,
    reason: string,
  ): Promise<{
    reversalReceiptId: string
    receiptType: "REVERSAL"
    invoiceId: string
    amountMinor: number
    status: string
    collectedMinor: number
    outstandingMinor: number
  }> {
    return apiRequest(`/billing/receipts/${receiptId}/reverse`, {
      method: "POST",
      body: { amountMinor, reason },
      idempotency: true,
    })
  },
}
