/** Confidential vault — /api/v1/ehr/vault (DOCTOR only, KEK-encrypted at rest) */

import { apiRequest } from "./client"
import type { VaultNoteDto, VaultShreddedNoteDto } from "./types"

export const vaultApi = {
  list(
    patientId: string,
    limit = 20,
    cursor?: string,
  ): Promise<{
    patientId: string
    notes: (VaultNoteDto | VaultShreddedNoteDto)[]
    nextCursor: string | null
  }> {
    return apiRequest(`/ehr/vault/patients/${patientId}/notes`, {
      query: { limit, cursor },
    })
  },

  add(
    patientId: string,
    content: string,
    noteDate?: string,
  ): Promise<{ noteId: string; noteDate: string | null; seq: number }> {
    return apiRequest(`/ehr/vault/patients/${patientId}/notes`, {
      method: "POST",
      body: { content, ...(noteDate ? { noteDate } : {}) },
    })
  },

  shred(noteId: string): Promise<{ noteId: string; shreddedAt: string }> {
    return apiRequest(`/ehr/vault/notes/${noteId}/shred`, { method: "POST" })
  },
}
