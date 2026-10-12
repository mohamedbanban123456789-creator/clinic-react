import type { Prisma, PrismaClient, QueueEntry } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';
import {
  computeEstimatedWaitMin,
  estimateWaitMin,
  normalizeQueueStatus,
} from './queue.support.js';
import type { QueueEntryStatus } from './queue.dto.js';

/**
 * BE-401 canonical queue realtime snapshot (RPS-2 versioned snapshots).
 *
 * The snapshot is the SINGLE source of truth for every live queue frame. It is
 * rebuilt from the DB on every mutation (and replayed verbatim on reconnect),
 * so a client that misses intermediate frames always converges by adopting the
 * newest `queueVersion`. Two allowlists ship off one build:
 *   - ops    (SECRETARY room `clinic:queue:ops`)   -> branded SecretSafe, allowlisted.
 *   - doctor (DOCTOR room `clinic:queue:doctor`)   -> superset incl. emergencyAckedAt
 *            + the operational `clinicalEncounterRef` flag. NEVER clinical content
 *            (DB-02): the ref is an opaque id only.
 */

export interface AvgMinByKind {
  readonly regular: number;
  readonly emergency: number;
}

/** SECRETARY-facing entry (SecretSafe allowlist — no clinical fields exist to leak, DB-02). */
export interface QueueSnapshotOpsEntry {
  readonly entryId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly status: QueueEntryStatus;
  readonly position: number;
  readonly isEmergency: boolean;
  readonly checkedInAt: string;
  readonly estimatedWaitMin: number;
  readonly queueVersion: number;
}

export interface QueueSnapshotOps {
  readonly clinicDayId: string;
  readonly queueVersion: number;
  readonly serverAt: string;
  readonly avgMinByKind: AvgMinByKind;
  readonly entries: readonly QueueSnapshotOpsEntry[];
}

/** DOCTOR-facing entry (superset of ops — adds operational emergency/clinical-flag context). */
export interface QueueSnapshotDoctorEntry extends QueueSnapshotOpsEntry {
  readonly emergencyAckedAt: string | null;
  readonly clinicalEncounterRef: string | null;
  readonly calledAt: string | null;
}

export interface QueueSnapshotDoctor {
  readonly clinicDayId: string;
  readonly queueVersion: number;
  readonly serverAt: string;
  readonly avgMinByKind: AvgMinByKind;
  readonly entries: readonly QueueSnapshotDoctorEntry[];
}

interface SnapshotRow {
  readonly entry: QueueEntry;
  readonly displayName: string;
}

async function readAvgMinutes(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  try {
    const row = await db.clinicSettings.findUnique({
      where: { id: 'singleton' },
      select: { avgConsultDurationMin: true },
    });
    if (row !== null && row.avgConsultDurationMin > 0) return row.avgConsultDurationMin;
  } catch {
    /* fall through to env */
  }
  try {
    return loadEnv().CLINIC_AVG_CONSULT_MIN;
  } catch {
    return 20;
  }
}

/** Dense ordered rows: the active IN_CONSULTATION entry first, then the WAITING pool. */
async function loadSnapshotRows(
  db: PrismaClient | Prisma.TransactionClient,
  shiftId: string,
): Promise<SnapshotRow[]> {
  const orderBy = [
    { emergencyFlaggedAt: { sort: 'asc' as const, nulls: 'last' as const } },
    { position: 'asc' as const },
    { checkedInAt: 'asc' as const },
  ];
  const active = await db.queueEntry.findFirst({
    where: { shiftId, status: 'IN_CONSULTATION' },
    include: { patient: { select: { fullName: true } } },
  });
  const pool = await db.queueEntry.findMany({
    where: { shiftId, status: 'WAITING' },
    orderBy,
    include: { patient: { select: { fullName: true } } },
  });
  const rows: SnapshotRow[] = [];
  if (active !== null) {
    rows.push({ entry: active, displayName: active.patient.fullName });
  }
  for (const entry of pool) {
    rows.push({ entry, displayName: entry.patient.fullName });
  }
  return rows;
}

/** Pure helper reused by tests: estimated wait for a WAITING dense position. */
export function snapshotWaitForPosition(position: number, avg: number): number {
  return estimateWaitMin(position, avg);
}

/**
 * Build both allowlisted snapshots for the OPEN shift. Returns null when no
 * shift is open (caller skips the emit — a closed clinic has nothing to sync).
 */
export async function buildQueueSnapshots(
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<{ ops: SecretSafe<QueueSnapshotOps>; doctor: QueueSnapshotDoctor } | null> {
  const shift = await db.shift.findFirst({
    where: { status: 'OPEN' },
    select: { id: true, queueVersion: true },
  });
  if (shift === null) return null;

  const avg = await readAvgMinutes(db);
  const rows = await loadSnapshotRows(db, shift.id);
  const now = new Date().toISOString();

  const inConsultation = rows.some((r) => normalizeQueueStatus(r.entry.status) === 'IN_CONSULTATION');
  const activeCalledAt =
    rows.find((r) => normalizeQueueStatus(r.entry.status) === 'IN_CONSULTATION')?.entry.calledAt ?? null;
  const elapsedConsultMin =
    activeCalledAt !== null ? Math.max(0, (Date.now() - activeCalledAt.getTime()) / 60_000) : 0;

  // avgMinByKind: only one clinic-wide average exists today; emergencies are not
  // penalised, so both kinds report the configured average. Shape is stable for
  // a future per-kind split without a contract change.
  const avgMinByKind: AvgMinByKind = { regular: avg, emergency: avg };

  let preceding = 0;
  const opsEntries: QueueSnapshotOpsEntry[] = [];
  const doctorEntries: QueueSnapshotDoctorEntry[] = [];

  for (const { entry, displayName } of rows) {
    const status = normalizeQueueStatus(entry.status);
    const estimatedWaitMin =
      status === 'WAITING'
        ? computeEstimatedWaitMin({
            precedingWaitingCount: preceding,
            avgConsultDurationMin: avg,
            inConsultation,
            elapsedConsultMin,
          })
        : 0;
    if (status === 'WAITING') preceding += 1;

    const base: QueueSnapshotOpsEntry = {
      entryId: entry.id,
      patientId: entry.patientId,
      displayName,
      status,
      position: entry.position,
      isEmergency: entry.isEmergency,
      checkedInAt: entry.checkedInAt.toISOString(),
      estimatedWaitMin,
      queueVersion: shift.queueVersion,
    };

    opsEntries.push(base);
    doctorEntries.push({
      ...base,
      emergencyAckedAt: entry.emergencyFlaggedAt === null ? null : entry.emergencyFlaggedAt.toISOString(),
      clinicalEncounterRef: entry.clinicalEncounterRef,
      calledAt: entry.calledAt === null ? null : entry.calledAt.toISOString(),
    });
  }

  const ops = markSecretSafe<QueueSnapshotOps>({
    clinicDayId: shift.id,
    queueVersion: shift.queueVersion,
    serverAt: now,
    avgMinByKind,
    entries: opsEntries,
  });

  const doctor: QueueSnapshotDoctor = {
    clinicDayId: shift.id,
    queueVersion: shift.queueVersion,
    serverAt: now,
    avgMinByKind,
    entries: doctorEntries,
  };

  return { ops, doctor };
}

/** Debug aid: log the version stamped on a built snapshot (operational only). */
export function logSnapshot(clinicDayId: string, queueVersion: number): void {
  logger.debug('queue.snapshot.built', { clinicDayId, queueVersion });
}

