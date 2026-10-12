/** Settings, users, supervision, audit endpoints */

import { apiRequest } from "./client"
import type {
  AuditEventDto,
  CashSummaryDto,
  ClinicSettingsDto,
  CursorPage,
  ExceptionsDto,
  ShiftHistoryItemDto,
  ShiftReadinessDto,
  SupervisionDiscountsDto,
  UnsignedNotesDto,
  UserListItemDto,
} from "./types"

export const settingsApi = {
  get(): Promise<ClinicSettingsDto> {
    return apiRequest("/settings")
  },

  update(
    input: Partial<ClinicSettingsDto>,
  ): Promise<ClinicSettingsDto> {
    return apiRequest("/settings", { method: "PUT", body: input })
  },
}

export const usersApi = {
  list(): Promise<{ data: UserListItemDto[] }> {
    return apiRequest("/users")
  },

  createSecretary(input: {
    name: string
    identifier: string
    password: string
  }): Promise<UserListItemDto> {
    return apiRequest("/users/secretaries", { method: "POST", body: input })
  },

  deactivate(id: string): Promise<{ id: string; isActive: boolean }> {
    return apiRequest(`/users/${id}/deactivate`, { method: "PATCH" })
  },

  activate(id: string): Promise<{ id: string; isActive: boolean }> {
    return apiRequest(`/users/${id}/activate`, { method: "PATCH" })
  },

  resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    return apiRequest(`/users/${id}/reset-password`, {
      method: "POST",
      body: {},
    })
  },
}

export const supervisionApi = {
  cashSummary(shiftId: string): Promise<CashSummaryDto> {
    return apiRequest("/supervision/cash-summary", { query: { shiftId } })
  },

  shifts(query: {
    unacked?: string
    varianceOnly?: string
    limit?: number
    cursor?: string
  }): Promise<CursorPage<ShiftHistoryItemDto>> {
    return apiRequest("/supervision/shifts", { query })
  },

  unsignedNotes(shiftId?: string): Promise<UnsignedNotesDto> {
    return apiRequest("/supervision/unsigned-notes", { query: { shiftId } })
  },

  discounts(shiftId: string): Promise<SupervisionDiscountsDto> {
    return apiRequest("/supervision/discounts", { query: { shiftId } })
  },

  exceptions(shiftId?: string): Promise<ExceptionsDto> {
    return apiRequest("/supervision/exceptions", { query: { shiftId } })
  },

  shiftReadiness(shiftId: string): Promise<ShiftReadinessDto> {
    return apiRequest("/supervision/shift-readiness", { query: { shiftId } })
  },

  ackShift(
    shiftId: string,
    note?: string,
  ): Promise<{
    shiftId: string
    status: string
    differenceMinor: number
    result: string
    reviewedByUserId: string
    reviewedAt: string
    reviewNote: string | null
  }> {
    return apiRequest(`/supervision/shifts/${shiftId}/ack`, {
      method: "POST",
      body: note ? { note } : {},
    })
  },
}

export const auditApi = {
  list(query: {
    action?: string
    entityType?: string
    entityId?: string
    actorUserId?: string
    startDate?: string
    endDate?: string
    limit?: number
    cursor?: string
  }): Promise<CursorPage<AuditEventDto>> {
    return apiRequest("/audit", { query })
  },
}
