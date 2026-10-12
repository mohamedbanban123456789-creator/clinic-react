/** AI scribe — /api/v1/scribe (DOCTOR only) */

import { apiRequest } from "./client"
import type {
  ScribeAnalysisDto,
  ScribeCommitDto,
  ScribeCycle2Dto,
  ScribeSessionDto,
  MseDto,
  SoapDto,
} from "./types"

export const scribeApi = {
  createSession(input: {
    patientId: string
    queueEntryId?: string
    mode?: "AMBIENT_LIVE" | "DICTATION_60S"
    consentConfirmed?: boolean
  }): Promise<ScribeSessionDto> {
    return apiRequest("/scribe/sessions", { method: "POST", body: input })
  },

  cycle1(
    sessionId: string,
    audioBase64: string,
    mimeType?: string,
  ): Promise<ScribeAnalysisDto> {
    return apiRequest(`/scribe/sessions/${sessionId}/cycle-1-consultation`, {
      method: "POST",
      body: { audioBase64, ...(mimeType ? { mimeType } : {}) },
    })
  },

  cycle2(
    sessionId: string,
    audioBase64: string,
    mimeType?: string,
  ): Promise<ScribeCycle2Dto> {
    return apiRequest(`/scribe/sessions/${sessionId}/cycle-2-doctor-decision`, {
      method: "POST",
      body: { audioBase64, ...(mimeType ? { mimeType } : {}) },
    })
  },

  commit(input: {
    sessionId: string
    soap: SoapDto
    mse?: MseDto
    prescriptions?: {
      drugName: string
      dosage: string
      frequency: string
      instructions: string
    }[]
    diagnoses?: string[]
  }): Promise<ScribeCommitDto> {
    const { sessionId, ...body } = input
    return apiRequest(`/scribe/sessions/${sessionId}/commit`, {
      method: "POST",
      body,
    })
  },

  purgeAudio(sessionId: string): Promise<{ sessionId: string; purged: boolean; status: string }> {
    return apiRequest(`/scribe/sessions/${sessionId}/purge-audio`, {
      method: "POST",
    })
  },

  withdrawConsent(
    sessionId: string,
    reason?: string,
  ): Promise<{
    sessionId: string
    status: string
    withdrawnAt: string | null
    retentionUntil: string | null
    audioPurged: boolean
  }> {
    return apiRequest(`/scribe/sessions/${sessionId}/withdraw-consent`, {
      method: "POST",
      body: reason ? { reason } : {},
    })
  },
}
