/**
 * Shared queue state — REST bootstrap (GET /queue) + live convergence via the
 * `queue.snapshot` WebSocket event. queueVersion adoption keeps concurrent
 * edits consistent (server OCC contract).
 */

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queueApi } from "@/api/queue"
import type { QueueEntryDto, QueueListDto } from "@/api/types"
import { useQueueSnapshot, type QueueSnapshot } from "@/realtime/socket"

export interface QueueState {
  queue: QueueListDto | undefined
  entries: QueueEntryDto[]
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  /** Latest queueVersion seen (REST or socket). */
  queueVersion: number
}

function snapshotToQueueList(snapshot: QueueSnapshot): QueueListDto {
  const waitingFirst = snapshot.entries.find((e) => e.status === "WAITING")
  return {
    shiftId: snapshot.clinicDayId,
    queueVersion: snapshot.queueVersion,
    estimatedWaitMin: waitingFirst ? Math.round(waitingFirst.estimatedWaitMin) : 0,
    activeCallRequest: snapshot.activeCallRequest ?? null,
    entries: snapshot.entries.map((e) => ({
      entryId: e.entryId,
      patientId: e.patientId,
      displayName: e.displayName,
      status: e.status as QueueEntryDto["status"],
      position: e.position,
      isEmergency: e.isEmergency,
      emergencyReasonCode: null,
      checkedInAt: e.checkedInAt,
      calledAt: e.calledAt ?? null,
      completedAt: null,
      skippedAt: null,
      noShowAt: null,
      abandonAt: null,
      estimatedWaitMin: Math.round(e.estimatedWaitMin),
      debtAckAt: null,
      debtAlert: null,
      queueVersion: e.queueVersion,
      hasPendingCallRequest:
        e.hasPendingCallRequest ?? (snapshot.activeCallRequest?.queueEntryId === e.entryId),
    })),
  }
}

export function useQueue(): QueueState {
  const queryClient = useQueryClient()
  const [live, setLive] = useState<QueueListDto | null>(null)
  const versionRef = useRef(0)

  const rest = useQuery({
    queryKey: ["queue", "current"],
    queryFn: () => queueApi.list(),
    refetchInterval: 30_000, // Safety net behind the socket.
  })

  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.query.queryKey[0] === "queue") {
        const data = event.query.state.data as QueueListDto | undefined
        if (data && data.queueVersion >= versionRef.current) {
          versionRef.current = data.queueVersion
        }
      }
    })
  }, [queryClient])

  useQueueSnapshot((snapshot) => {
    if (snapshot.queueVersion >= versionRef.current) {
      versionRef.current = snapshot.queueVersion
      const mapped = snapshotToQueueList(snapshot)
      setLive(mapped)
      queryClient.setQueryData(["queue", "current"], mapped)
      // Invalidate financial/queue-dependent queries on queue changes.
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
    }
  })

  // Prefer the newest live snapshot; refetch REST when it looks stale.
  const queue = live && (!rest.data || live.queueVersion >= rest.data.queueVersion)
    ? live
    : rest.data ?? undefined

  return {
    queue,
    entries: queue?.entries ?? [],
    isLoading: rest.isLoading && !live,
    isError: rest.isError && !live,
    error: rest.error,
    refetch: () => void rest.refetch(),
    queueVersion: versionRef.current,
  }
}

/** Mutations invalidate the queue + trigger server snapshot broadcast. */
export function useQueueInvalidation() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["queue"] })
    void queryClient.invalidateQueries({ queryKey: ["billing"] })
    void queryClient.invalidateQueries({ queryKey: ["shifts"] })
  }
}
