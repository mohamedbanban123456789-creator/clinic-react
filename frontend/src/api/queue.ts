/** Queue endpoints — /api/v1/queue */

import { apiRequest } from "./client"
import type { QueueEntryDto, QueueListDto, WaitTimesDto } from "./types"

export const queueApi = {
  list(shiftId?: string, status?: string): Promise<QueueListDto> {
    return apiRequest("/queue", { query: { shiftId, status } })
  },

  waitTimes(shiftId?: string): Promise<WaitTimesDto> {
    return apiRequest("/queue/wait-times", { query: { shiftId } })
  },

  checkIn(
    patientId: string,
    opts: { isEmergency?: boolean; emergencyReasonCode?: string } = {},
  ): Promise<QueueEntryDto> {
    return apiRequest("/queue/check-in", {
      method: "POST",
      body: {
        patientId,
        ...(opts.isEmergency !== undefined ? { isEmergency: opts.isEmergency } : {}),
        ...(opts.emergencyReasonCode
          ? { emergencyReasonCode: opts.emergencyReasonCode }
          : {}),
      },
      idempotency: true,
    })
  },

  reorder(
    lastSeenQueueVersion: number,
    orderedEntryIds: string[],
  ): Promise<{ queueVersion: number; entries: QueueEntryDto[] }> {
    return apiRequest("/queue/reorder", {
      method: "POST",
      body: { lastSeenQueueVersion, orderedEntryIds },
      idempotency: true,
    })
  },

  callNext(force = false): Promise<QueueEntryDto> {
    return apiRequest("/queue/call-next", {
      method: "POST",
      body: { force },
    })
  },

  call(
    entryId: string,
    opts: { outOfOrderReasonCode?: string; force?: boolean } = {},
  ): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/call`, {
      method: "POST",
      body: {
        ...(opts.outOfOrderReasonCode
          ? { outOfOrderReasonCode: opts.outOfOrderReasonCode }
          : {}),
        ...(opts.force !== undefined ? { force: opts.force } : {}),
      },
    })
  },

  skip(entryId: string): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/skip`, { method: "POST" })
  },

  requeue(
    entryId: string,
    position: "FRONT" | "ORIGINAL" = "ORIGINAL",
  ): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/requeue`, {
      method: "POST",
      body: { position },
    })
  },

  complete(entryId: string): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/complete`, { method: "POST" })
  },

  undoComplete(
    entryId: string,
    reason: string,
    lastSeenQueueVersion?: number,
  ): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/undo-complete`, {
      method: "POST",
      body: {
        reason,
        ...(lastSeenQueueVersion !== undefined ? { lastSeenQueueVersion } : {}),
      },
      idempotency: true,
    })
  },

  noShow(entryId: string, reasonCode: string): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/no-show`, {
      method: "POST",
      body: { reasonCode },
    })
  },

  abandon(
    entryId: string,
    reasonCode: string,
    billable: boolean,
  ): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/abandon`, {
      method: "POST",
      body: { reasonCode, billable },
    })
  },

  emergency(
    entryId: string,
    isEmergency: boolean,
    reasonCode?: string,
    lastSeenQueueVersion?: number,
  ): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/emergency`, {
      method: "POST",
      body: {
        isEmergency,
        ...(reasonCode ? { reasonCode } : {}),
        ...(lastSeenQueueVersion !== undefined ? { lastSeenQueueVersion } : {}),
      },
      idempotency: true,
    })
  },

  debtAck(entryId: string): Promise<QueueEntryDto> {
    return apiRequest(`/queue/${entryId}/debt-ack`, {
      method: "POST",
      body: {},
    })
  },

  deferDocumentation(
    entryId: string,
    reason: string,
  ): Promise<{ success: true; queueEntryId: string; reason: string; deferredAt: string }> {
    return apiRequest(`/queue/${entryId}/defer-documentation`, {
      method: "POST",
      body: { reason },
    })
  },
}
