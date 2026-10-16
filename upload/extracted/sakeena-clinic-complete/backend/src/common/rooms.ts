import type { Role } from '@prisma/client';

/**
 * BE-401 Socket.io room names (RPS-2).
 *
 * The API_CONTRACTS.md "WebSocket Contract" sketch names a single `clinic:queue`
 * room; the approved BE-401 design splits the live queue by ROLE so the ops and
 * doctor frames can carry different allowlists:
 *   - `clinic:queue:ops`     SECRETARY: SecretSafe allowlisted fields only.
 *   - `clinic:queue:doctor`  DOCTOR:    superset incl. emergencyAckedAt + operational
 *                                       clinicalRef flag (never clinical content, DB-02).
 * Intercom + per-user channels are shared. `clinic:scribe:doctor` is reserved for
 * the DOCTOR scribe stream (Sprint 5 — joined now so reconnect replays cleanly).
 */
export const ROOM_QUEUE_OPS = 'clinic:queue:ops';
export const ROOM_QUEUE_DOCTOR = 'clinic:queue:doctor';
export const ROOM_INTERCOM = 'clinic:intercom';
export const ROOM_SCRIBE_DOCTOR = 'clinic:scribe:doctor';

/** Per-user revocation channel. `session.revoked` + force-disconnect target this room. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Every room a socket joins strictly by role (pure, unit-testable).
 * DOCTOR additionally joins the scribe room; SECRETARY never does.
 */
export function roomsForRole(role: Role, userId: string): readonly string[] {
  const common: readonly string[] = [ROOM_INTERCOM, userRoom(userId)];
  if (role === 'DOCTOR') {
    return [ROOM_QUEUE_DOCTOR, ...common, ROOM_SCRIBE_DOCTOR];
  }
  return [ROOM_QUEUE_OPS, ...common];
}
