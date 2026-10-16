/**
 * Socket.io realtime layer — same-origin via the Vite proxy (/socket.io).
 *
 * Server -> client events (verified against src/ws-gateway.ts):
 *   queue.snapshot      — full queue state after every mutation + on connect
 *   intercom.received   — new intercom message (clinic:intercom room)
 *   supervision.discrepancy — doctor-only integrity alert
 *   session.revoked     — forced logout (password change / deactivation)
 *   session.expired     — access token expiry -> refresh + reconnect
 *
 * Client -> server: `ping` heartbeat every 25s (answers `pong`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { io, type Socket } from "socket.io-client"
import { getAccessToken, setAccessToken, tryRefresh } from "@/clinic/api/client"
import { useAuth } from "@/clinic/auth/AuthContext"
import type { CallRequestDto } from "@/clinic/api/types"

export interface QueueSnapshotEntry {
  entryId: string
  patientId: string
  displayName: string
  status: string
  position: number
  isEmergency: boolean
  checkedInAt: string
  estimatedWaitMin: number
  queueVersion: number
  emergencyAckedAt?: string | null
  clinicalEncounterRef?: string | null
  calledAt?: string | null
  hasPendingCallRequest?: boolean
}

export interface QueueSnapshot {
  clinicDayId: string
  queueVersion: number
  serverAt: string
  avgMinByKind: { regular: number; emergency: number }
  entries: QueueSnapshotEntry[]
  activeCallRequest?: CallRequestDto | null
}

export interface CallRequestEvent {
  type: "created" | "approved" | "cancelled"
  payload: CallRequestDto
}

export type CallRequestListener = (event: CallRequestEvent) => void

export interface IntercomReceivedPayload {
  id: string
  fromUserId: string
  fromRole: "DOCTOR" | "SECRETARY"
  type: string
  text: string | null
  relatedQueueEntryId: string | null
  createdAt: string
}

type QueueListener = (snapshot: QueueSnapshot) => void
type IntercomListener = (message: IntercomReceivedPayload) => void

/** Module-level listener registries (stable across provider lifecycle). */
const queueListeners = new Set<QueueListener>()
const intercomListeners = new Set<IntercomListener>()
const callRequestListeners = new Set<CallRequestListener>()

/** Subscribe to live intercom messages (module-level, hook-free). */
export function onIntercom(listener: IntercomListener): () => void {
  intercomListeners.add(listener)
  return () => intercomListeners.delete(listener)
}

/** Subscribe to live call-request events (module-level, hook-free). */
export function onCallRequest(listener: CallRequestListener): () => void {
  callRequestListeners.add(listener)
  return () => callRequestListeners.delete(listener)
}

interface RealtimeContextValue {
  connected: boolean
  onQueueSnapshot: (l: QueueListener) => () => void
  onIntercom: (l: IntercomListener) => () => void
  onCallRequest: (l: CallRequestListener) => () => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    let disposed = false

    const connect = (): Socket | null => {
      const token = getAccessToken()
      if (!token || disposed) return null
      const socket = io({
        path: "/socket.io",
        auth: { token },
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
      })
      socketRef.current = socket

      socket.on("connect", () => {
        setConnected(true)
      })
      socket.on("disconnect", () => {
        setConnected(false)
      })
      socket.on("connect_error", () => {
        setConnected(false)
      })

      socket.on("queue.snapshot", (snapshot: QueueSnapshot) => {
        queueListeners.forEach((l) => l(snapshot))
      })

      socket.on("intercom.received", (message: IntercomReceivedPayload) => {
        intercomListeners.forEach((l) => l(message))
      })

      socket.on("call_request.created", (payload: CallRequestDto) => {
        callRequestListeners.forEach((l) => l({ type: "created", payload }))
      })
      socket.on("call_request.approved", (payload: CallRequestDto) => {
        callRequestListeners.forEach((l) => l({ type: "approved", payload }))
      })
      socket.on("call_request.cancelled", (payload: CallRequestDto) => {
        callRequestListeners.forEach((l) => l({ type: "cancelled", payload }))
      })

      // Access token expired server-side: refresh then reconnect.
      socket.on("session.expired", () => {
        void tryRefresh().then((ok) => {
          if (ok) {
            socket.auth = { token: getAccessToken() }
            if (socket.connected) {
              socket.emit("auth.refresh", { token: getAccessToken() })
            } else {
              socket.connect()
            }
          }
        })
      })

      // App-level heartbeat (server answers with pong).
      const heartbeat = window.setInterval(() => {
        if (socket.connected) socket.emit("ping")
      }, 25000)

      const originalDisconnect = socket.close.bind(socket)
      socket.close = () => {
        window.clearInterval(heartbeat)
        return originalDisconnect()
      }

      return socket
    }

    let socket = connect()

    // Reconnect whenever the session changes (login/logout/refresh) or
    // after a silent token rotation. Covers the mount-without-token case.
    const interval = window.setInterval(() => {
      const token = getAccessToken()
      if ((!socket || !socket.connected) && token) {
        socket?.close()
        socket = connect()
      }
    }, 2000)

    return () => {
      disposed = true
      window.clearInterval(interval)
      socket?.close()
      socketRef.current = null
    }
  }, [user?.id])

  const onQueueSnapshot = useCallback((l: QueueListener) => {
    queueListeners.add(l)
    return () => queueListeners.delete(l)
  }, [])

  const onIntercomCb = useCallback((l: IntercomListener) => {
    intercomListeners.add(l)
    return () => intercomListeners.delete(l)
  }, [])

  const onCallRequestCb = useCallback((l: CallRequestListener) => {
    callRequestListeners.add(l)
    return () => callRequestListeners.delete(l)
  }, [])

  const value = useMemo(
    () => ({
      connected,
      onQueueSnapshot,
      onIntercom: onIntercomCb,
      onCallRequest: onCallRequestCb,
    }),
    [connected, onQueueSnapshot, onIntercomCb, onCallRequestCb],
  )

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  )
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error("useRealtime must be used within RealtimeProvider")
  return ctx
}

/** Subscribe to live queue snapshots (also fires with the replay on connect). */
export function useQueueSnapshot(handler: QueueListener): void {
  const { onQueueSnapshot } = useRealtime()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    return onQueueSnapshot((snapshot) => ref.current(snapshot))
  }, [onQueueSnapshot])
}

/** Subscribe to live call requests. */
export function useCallRequest(handler: CallRequestListener): void {
  const { onCallRequest } = useRealtime()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    return onCallRequest((event) => ref.current(event))
  }, [onCallRequest])
}
