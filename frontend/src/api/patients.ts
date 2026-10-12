/** Patient endpoints — /api/v1/patients */

import { apiRequest } from "./client"
import type {
  BalanceDto,
  CursorPage,
  InvoiceListItemDto,
  PatientDetailDto,
  PatientDto,
  PatientSearchCandidateDto,
  SettleDto,
} from "./types"

export interface CreatePatientInput {
  fullName: string
  dateOfBirth: string
  phone?: string
  nationalId?: string
  guardianPhone?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelation?: string
  physicalAddress?: string
  adminNotes?: string
  crisis?: boolean
  confirmNotDuplicate?: boolean
}

export interface PatchPatientInput {
  phone?: string
  guardianPhone?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelation?: string
  physicalAddress?: string
  adminNotes?: string
}

export const patientsApi = {
  search(q: string): Promise<CursorPage<PatientSearchCandidateDto>> {
    return apiRequest("/patients/search", { query: { q } })
  },

  get(id: string): Promise<PatientDetailDto> {
    return apiRequest(`/patients/${id}`)
  },

  create(input: CreatePatientInput): Promise<PatientDto> {
    return apiRequest("/patients", { method: "POST", body: input })
  },

  patch(id: string, input: PatchPatientInput): Promise<PatientDto> {
    return apiRequest(`/patients/${id}`, { method: "PATCH", body: input })
  },

  balance(id: string): Promise<BalanceDto> {
    return apiRequest(`/patients/${id}/balance`)
  },

  settle(
    id: string,
    amountMinor: number,
    method: "CASH" | "OTHER",
  ): Promise<SettleDto> {
    return apiRequest(`/patients/${id}/settle`, {
      method: "POST",
      body: { amountMinor, method },
      idempotency: true,
    })
  },

  invoices(
    patientId: string,
    limit = 100,
    cursor?: string,
  ): Promise<CursorPage<InvoiceListItemDto>> {
    return apiRequest("/billing", {
      query: { patientId, limit, cursor },
    })
  },
}
