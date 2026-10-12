import type { QueueEntryStatus } from './queue.dto.js';

export type { QueueEntryStatus };

/**
 * BE-202 QueueEntry state machine (pure, DB-free — unit-testable).
 *
 * Terminal states (NO_SHOW, ABANDONED) have no outgoing edges. Every other
 * transition is asserted by the owning service so illegal edges fail with
 * 400 ILLEGAL_TRANSITION before any write.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<QueueEntryStatus, readonly QueueEntryStatus[]>> = {
  WAITING: ['IN_CONSULTATION', 'SKIPPED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED', 'SKIPPED', 'ABANDONED'],
  SKIPPED: ['WAITING', 'NO_SHOW'],
  // API-06 undo-complete: a premature completion reverts to the ACTIVE
  // consultation state (never WAITING — the patient was already called).
  COMPLETED: ['IN_CONSULTATION'],
  NO_SHOW: [],
  ABANDONED: [],
};

/** True when `from -> to` is a legal edge in the machine. */
export function canTransition(from: QueueEntryStatus, to: QueueEntryStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** States that occupy the "one open entry per patient" partial unique (canon). */
export const OPEN_ENTRY_STATUSES: readonly QueueEntryStatus[] = ['WAITING', 'IN_CONSULTATION', 'SKIPPED'];

export function isOpenStatus(status: QueueEntryStatus): boolean {
  return OPEN_ENTRY_STATUSES.includes(status);
}

/** True when the entry is part of the ordered WAITING pool (dense positions). */
export function isWaitingPoolStatus(status: QueueEntryStatus): boolean {
  return status === 'WAITING';
}
