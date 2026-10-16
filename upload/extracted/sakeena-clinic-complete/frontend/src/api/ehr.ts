/** Clinical EHR — /api/v1/ehr (DOCTOR only) */

import { apiRequest } from "./client"
import type {
  ChartEncounterDto,
  DiagnosisEntryDto,
  EncounterDto,
  MedicationDto,
  MseDto,
  SoapDto,
  StructuredDiagnosisDto,
} from "./types"

export interface CreateEncounterInput {
  patientId: string
  visitDate: string
  encounterType: string
  queueEntryId?: string
  soap?: Partial<SoapDto>
  mse: MseDto
  diagnoses?: DiagnosisEntryDto[]
  diagnosisNotes?: string | null
}

export interface PatchEncounterInput {
  visitDate?: string
  encounterType?: string
  soap?: Partial<SoapDto>
  mse?: Partial<MseDto>
  diagnoses?: DiagnosisEntryDto[]
  diagnosisNotes?: string | null
}

export interface AiDiagnosisResultDto {
  diagnoses: StructuredDiagnosisDto[]
  clinicalSummary: string
}

export interface MedicationInput {
  drugName: string
  dosage: string
  frequency: string
  instructions: string
  encounterId?: string
}

export const ehrApi = {
  createEncounter(input: CreateEncounterInput): Promise<{ encounterId: string; status: string; rowVersion: number }> {
    return apiRequest("/ehr/encounters", { method: "POST", body: input })
  },

  chart(
    patientId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ patientId: string; encounters: ChartEncounterDto[]; nextCursor: string | null }> {
    return apiRequest(`/ehr/patients/${patientId}/chart`, {
      query: { limit, cursor },
    })
  },

  getEncounter(id: string): Promise<EncounterDto> {
    return apiRequest(`/ehr/encounters/${id}`)
  },

  patchEncounter(
    id: string,
    rowVersion: number,
    input: PatchEncounterInput,
  ): Promise<{ encounterId: string; status: string; rowVersion: number }> {
    return apiRequest(`/ehr/encounters/${id}`, {
      method: "PATCH",
      body: input,
      ifMatch: rowVersion,
    })
  },

  runAiDiagnosis(id: string): Promise<AiDiagnosisResultDto> {
    return apiRequest(`/ehr/encounters/${id}/ai-diagnosis`, {
      method: "POST",
    })
  },

  sign(
    id: string,
    rowVersion: number,
  ): Promise<{ encounterId: string; status: string; rowVersion: number; signedAt: string; finalContentHash: string }> {
    return apiRequest(`/ehr/encounters/${id}/sign`, {
      method: "POST",
      body: { rowVersion, reviewed: { S: true, O: true, A: true, P: true } },
    })
  },

  discard(id: string): Promise<{ encounterId: string; discarded: boolean }> {
    return apiRequest(`/ehr/encounters/${id}/discard`, { method: "POST" })
  },

  addAddendum(
    id: string,
    text: string,
    reasonCode: string,
  ): Promise<{ encounterId: string; addendumId: string; version: number; createdAt: string }> {
    return apiRequest(`/ehr/encounters/${id}/addenda`, {
      method: "POST",
      body: { text, reasonCode },
    })
  },

  medications(
    patientId: string,
    status?: "ACTIVE" | "DISCONTINUED",
  ): Promise<{ patientId: string; medications: MedicationDto[] }> {
    return apiRequest(`/ehr/patients/${patientId}/medications`, {
      query: { status },
    })
  },

  addMedication(
    patientId: string,
    input: MedicationInput,
  ): Promise<MedicationDto> {
    return apiRequest(`/ehr/patients/${patientId}/medications`, {
      method: "POST",
      body: input,
    })
  },

  discontinueMedication(
    medicationId: string,
    cessationReasonCode: string,
    cessationNote?: string,
  ): Promise<MedicationDto> {
    return apiRequest(`/ehr/medications/${medicationId}/discontinue`, {
      method: "POST",
      body: {
        cessationReasonCode,
        ...(cessationNote ? { cessationNote } : {}),
      },
    })
  },

  adjustMedication(
    medicationId: string,
    input: { dosage?: string; frequency?: string; instructions?: string },
  ): Promise<{ oldMedication: MedicationDto; newMedication: MedicationDto }> {
    return apiRequest(`/ehr/medications/${medicationId}/adjust`, {
      method: "POST",
      body: input,
    })
  },
}
