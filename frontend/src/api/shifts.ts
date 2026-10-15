/** Shift endpoints — /api/v1/shifts */

import { apiRequest, ApiError } from "./client"
import type {
  CloseShiftDto,
  CursorPage,
  PettyExpenseDto,
  ShiftSummaryDto,
  ShiftViewDto,
} from "./types"

export const shiftsApi = {
  current(): Promise<ShiftViewDto | null> {
    return apiRequest<ShiftViewDto>("/shifts/current").catch((err) => {
      if (err instanceof ApiError && err.status === 404) {
        return null
      }
      throw err
    })
  },

  get(shiftId: string): Promise<ShiftViewDto> {
    return apiRequest(`/shifts/${shiftId}`)
  },

  summary(shiftId: string): Promise<ShiftSummaryDto> {
    return apiRequest(`/shifts/${shiftId}/summary`)
  },

  open(
    openingCountMinor: number,
    businessDate?: string,
  ): Promise<{ shiftId: string; businessDate: string; status: "OPEN"; openingDiscrepancyMinor: number; queueVersion: number }> {
    return apiRequest("/shifts/open", {
      method: "POST",
      body: {
        openingCountMinor,
        ...(businessDate ? { businessDate } : {}),
      },
      idempotency: true,
    })
  },

  pettyList(
    shiftId: string,
    limit = 200,
    cursor?: string,
  ): Promise<{ shiftId: string; data: PettyExpenseDto[]; nextCursor: string | null }> {
    return apiRequest(`/shifts/${shiftId}/petty`, { query: { limit, cursor } })
  },

  addPetty(
    shiftId: string,
    input: {
      amountMinor: number
      direction: "EXPENSE" | "INJECTION"
      category: string
      description: string
      receiptRef?: string
    },
  ): Promise<PettyExpenseDto> {
    return apiRequest(`/shifts/${shiftId}/petty`, {
      method: "POST",
      body: input,
      idempotency: true,
    })
  },

  close(
    shiftId: string,
    actualCountedMinor: number,
    opts: { force?: boolean; forceReason?: string; reason?: string } = {},
  ): Promise<CloseShiftDto> {
    return apiRequest(`/shifts/${shiftId}/close`, {
      method: "POST",
      body: {
        actualCountedMinor,
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.forceReason ? { forceReason: opts.forceReason } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      idempotency: true,
    })
  },
}
