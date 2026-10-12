import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

/**
 * BE-202 Queue DTOs (CONV-02 allowlist-first).
 *
 * Operational-only shape — QueueEntry holds NO clinical columns (DB-02), so
 * there is nothing sensitive to accidentally expose. Both roles read via
 * `toSecretQueueEntryDto`; the branded `SecretSafe<T>` return is enforced by
 * the global sanitizer for SECRETARY responses.
 */
export type QueueEntryStatus =
  | 'WAITING'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'NO_SHOW'
  | 'ABANDONED';

export interface DebtAlertDto {
  readonly outstandingMinor: number;
  readonly oldestInvoiceDate: string | null;
}

export interface QueueEntryDto {
  readonly entryId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly status: QueueEntryStatus;
  readonly position: number;
  readonly isEmergency: boolean;
  readonly emergencyReasonCode: string | null;
  readonly checkedInAt: string;
  readonly calledAt: string | null;
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly noShowAt: string | null;
  readonly abandonAt: string | null;
  readonly estimatedWaitMin: number;
  readonly debtAckAt: string | null;
  readonly debtAlert: DebtAlertDto | null;
  readonly queueVersion: number;
}

export interface QueueListDto {
  readonly shiftId: string | null;
  readonly queueVersion: number;
  readonly estimatedWaitMin: number;
  readonly entries: readonly QueueEntryDto[];
}

/** DB row shape consumed by the mapper (operational projection only). */
export interface QueueEntryRow {
  readonly id: string;
  readonly patientId: string;
  readonly status: QueueEntryStatus;
  readonly isEmergency: boolean;
  readonly emergencyReasonCode: string | null;
  readonly position: number;
  readonly checkedInAt: Date;
  readonly calledAt: Date | null;
  readonly completedAt: Date | null;
  readonly skippedAt: Date | null;
  readonly noShowAt: Date | null;
  readonly abandonAt: Date | null;
  readonly debtAckAt: Date | null;
  readonly patient: { readonly fullName: string };
}

export interface QueueEntryExtras {
  readonly estimatedWaitMin: number;
  readonly queueVersion: number;
  readonly debtAlert?: DebtAlertDto | null;
}

/** Allowlist-first mapper: only picked keys leave the server. */
export function toSecretQueueEntryDto(
  row: QueueEntryRow,
  extras: QueueEntryExtras,
): SecretSafe<QueueEntryDto> {
  return markSecretSafe<QueueEntryDto>({
    entryId: row.id,
    patientId: row.patientId,
    displayName: row.patient.fullName,
    status: row.status,
    position: row.position,
    isEmergency: row.isEmergency,
    emergencyReasonCode: row.emergencyReasonCode,
    checkedInAt: row.checkedInAt.toISOString(),
    calledAt: row.calledAt === null ? null : row.calledAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    skippedAt: row.skippedAt === null ? null : row.skippedAt.toISOString(),
    noShowAt: row.noShowAt === null ? null : row.noShowAt.toISOString(),
    abandonAt: row.abandonAt === null ? null : row.abandonAt.toISOString(),
    estimatedWaitMin: extras.estimatedWaitMin,
    debtAckAt: row.debtAckAt === null ? null : row.debtAckAt.toISOString(),
    debtAlert: extras.debtAlert ?? null,
    queueVersion: extras.queueVersion,
  });
}

/** Allowlist-first list envelope — branded whole so SECRETARY sanitizer passes. */
export function toSecretQueueListDto(
  shiftId: string | null,
  queueVersion: number,
  estimatedWaitMin: number,
  entries: readonly SecretSafe<QueueEntryDto>[],
): SecretSafe<QueueListDto> {
  return markSecretSafe<QueueListDto>({
    shiftId,
    queueVersion,
    estimatedWaitMin,
    entries,
  });
}

/** BE-203 manual-reorder success envelope. */
export interface QueueReorderDto {
  readonly queueVersion: number;
  readonly entries: readonly QueueEntryDto[];
}

/** BE-203 wait-time single item. */
export interface WaitTimeItemDto {
  readonly entryId: string;
  readonly precedingCount: number;
  readonly estimatedWaitMin: number;
}

/** BE-203 wait-time success envelope (RPS-2 formula). */
export interface WaitTimesDto {
  readonly avgConsultDurationMin: number;
  readonly items: readonly WaitTimeItemDto[];
}

/** Allowlist-first reorder envelope (branded whole). */
export function toSecretQueueReorderDto(
  queueVersion: number,
  entries: readonly SecretSafe<QueueEntryDto>[],
): SecretSafe<QueueReorderDto> {
  return markSecretSafe<QueueReorderDto>({
    queueVersion,
    entries,
  });
}

/** Allowlist-first wait-times envelope (branded whole). */
export function toSecretWaitTimesDto(
  avgConsultDurationMin: number,
  items: readonly WaitTimeItemDto[],
): SecretSafe<WaitTimesDto> {
  return markSecretSafe<WaitTimesDto>({
    avgConsultDurationMin,
    items,
  });
}
