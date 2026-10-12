/** Intercom & follow-ups — /api/v1/intercom, /api/v1/followups */

import { apiRequest } from "./client"
import type { CursorPage, FollowUpDto, IntercomMessageDto } from "./types"
import type { IntercomType } from "@/lib/constants"

export interface SendIntercomInput {
  type: IntercomType
  code1?: string
  code2?: string
  text?: string
  relatedQueueEntryId?: string
  relatedReceiptId?: string
  followUp?: { followUpType: "GENERAL"; window: "NEXT_VISIT" }
}

export const intercomApi = {
  list(
    limit = 100,
    cursor?: string,
  ): Promise<CursorPage<IntercomMessageDto>> {
    return apiRequest("/intercom", { query: { limit, cursor } })
  },

  send(input: SendIntercomInput): Promise<IntercomMessageDto> {
    return apiRequest("/intercom", { method: "POST", body: input })
  },

  followUps(query: {
    patientId?: string
    status?: string
    limit?: number
    cursor?: string
  }): Promise<CursorPage<FollowUpDto>> {
    return apiRequest("/followups", { query })
  },

  updateFollowUp(
    id: string,
    status: "REQUESTED" | "SCHEDULED" | "DONE" | "CANCELLED",
  ): Promise<FollowUpDto> {
    return apiRequest(`/followups/${id}`, { method: "PATCH", body: { status } })
  },
}
