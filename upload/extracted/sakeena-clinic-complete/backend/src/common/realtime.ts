import type { Server, Socket } from 'socket.io';
import { logger } from './utils/logger.js';
import { userRoom } from './rooms.js';

/**
 * BE-104 / BE-401 realtime hub (RPS-2).
 *
 * Holds the attached Socket.io server (set once at boot by `attachRealtime`).
 * HTTP access is already invalidated by the tokenVersion bump + refresh-family
 * revocation performed in the same service transaction, so stale access JWTs
 * fail `authenticate` within one access-TTL window. This hub additionally
 * force-closes the user's live sockets the instant a session is revoked.
 *
 * Before the WS server attaches (unit tests, pre-boot) every emit is a no-op,
 * so domain code can call these freely without null checks.
 */
let io: Server | null = null;

/** Attach the live Socket.io server (called once from server.ts after listen). */
export function attachRealtime(server: Server): void {
  io = server;
}

/** Test/pre-boot helper to detach. */
export function detachRealtime(): void {
  io = null;
}

// ---------------------------------------------------------------------------
// BE-104 session revocation (deactivation + password change).
// ---------------------------------------------------------------------------

/**
 * Force the user's live sockets offline: emit `session.revoked` to `user:<id>`
 * then disconnect every socket in that room. Idempotent + safe when no server
 * is attached.
 */
export function revokeUserSessions(userId: string): void {
  if (io !== null) {
    io.to(userRoom(userId)).emit('session.revoked', {
      userId,
      serverAt: new Date().toISOString(),
      reason: 'SESSION_REVOKED',
    });
    io.in(userRoom(userId)).disconnectSockets(true);
  }
  logger.info('auth.sessions.revoked', { userId });
}

// ---------------------------------------------------------------------------
// BE-401 canonical queue snapshot publish (registered by the WS gateway).
// ---------------------------------------------------------------------------

/**
 * A queue-snapshot publisher rebuilds the dense, versioned snapshot for a
 * clinic day and emits it to the role-segregated queue rooms. The WS gateway
 * registers it at boot; queue service mutations call `publishQueueSnapshot`
 * fire-and-forget after their transaction commits.
 */
export type QueueSnapshotPublisher = (clinicDayId: string) => void;

let queueSnapshotPublisher: QueueSnapshotPublisher | null = null;

export function setQueueSnapshotPublisher(publisher: QueueSnapshotPublisher | null): void {
  queueSnapshotPublisher = publisher;
}

/** Emit the latest queue snapshot for a clinic day. No-op if no gateway attached. */
export function publishQueueSnapshot(clinicDayId: string): void {
  if (queueSnapshotPublisher === null) return;
  try {
    queueSnapshotPublisher(clinicDayId);
  } catch (err) {
    logger.warn('realtime.queueSnapshot.failed', { clinicDayId, err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// BE-402 intercom broadcast.
// ---------------------------------------------------------------------------

/** Broadcast an `intercom.received` frame (IntercomDto) to clinic:intercom. */
export function broadcastIntercom(frame: unknown): void {
  if (io === null) return;
  io.to('clinic:intercom').emit('intercom.received', frame);
}

/** Broadcast a call_request event to clinic queue rooms. */
export function broadcastCallRequest(
  event: 'call_request.created' | 'call_request.approved' | 'call_request.cancelled',
  payload: unknown,
): void {
  if (io === null) return;
  try {
    io.to('clinic:queue:ops').emit(event, payload);
    io.to('clinic:queue:doctor').emit(event, payload);
  } catch (err) {
    logger.warn('realtime.callRequest.failed', { event, err: String(err) });
  }
}

/** Emit a server→client frame to a single socket (used by WS handlers). */
export function emitToSocket(socket: Socket, event: string, frame: unknown): void {
  socket.emit(event, frame);
}

// ---------------------------------------------------------------------------
// BE-702 supervision discrepancy broadcast (DOCTOR room only).
// ---------------------------------------------------------------------------

export interface SupervisionDiscrepancyFrame {
  readonly shiftId: string;
  readonly inv: string;
  readonly detail: string;
  readonly serverAt: string;
}

/**
 * Emit `supervision.discrepancy` to the DOCTOR queue room only. SECRETARY
 * sockets never join that room (roomsForRole), so the feed stays
 * doctor-exclusive by construction. No-op when no WS gateway is attached.
 */
export function broadcastSupervisionDiscrepancy(frame: SupervisionDiscrepancyFrame): void {
  if (io === null) return;
  try {
    io.to('clinic:queue:doctor').emit('supervision.discrepancy', frame);
  } catch (err) {
    logger.warn('realtime.supervisionDiscrepancy.failed', { shiftId: frame.shiftId, err: String(err) });
  }
}

