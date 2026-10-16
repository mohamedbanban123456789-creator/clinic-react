import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { checkInSchema, debtAckSchema } from '../src/modules/identity-queue/queue.validators.js';
import { checkIn, debtAck } from '../src/modules/identity-queue/queue.service.js';
import { isSecretSafe } from '../src/common/types/secretSafe.js';

/**
 * Decision 1 regression gate (service level, fake Prisma — no PostgreSQL):
 * patient DEBT IS ADVISORY-ONLY.
 *  - Check-in with outstanding debt still creates the queue entry (201) and
 *    attaches the debtAlert as an informational warning.
 *  - No acknowledgement field exists anywhere on the check-in contract (the
 *    strict validator rejects the legacy `acknowledged` key).
 *  - The debt-ack endpoint remains an OPTIONAL advisory record (audit of who
 *    acknowledged) and never gates any clinical workflow.
 */

// ---------------------------------------------------------------------------
// Fake Prisma (makeDb-style).
// ---------------------------------------------------------------------------

interface InvoiceLite {
  patientId: string;
  status: string;
  outstandingMinor: number;
  createdAt: Date;
}

interface EntryRecord {
  id: string;
  patientId: string;
  shiftId: string;
  status: string;
  isEmergency: boolean;
  emergencyReasonCode: string | null;
  position: number;
  idempotencyKey: string | null;
  checkedInAt: Date;
  calledAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  noShowAt: Date | null;
  abandonAt: Date | null;
  debtAckAt: Date | null;
  debtAckByUserId: string | null;
}

interface DebtHarness {
  db: PrismaClient;
  entries: EntryRecord[];
  invoices: InvoiceLite[];
  audits: Array<{ action: string; entityId: string; afterState: Record<string, unknown> | null }>;
  shift: { id: string; status: string; queueVersion: number };
}

const NOW = new Date();

function makeHarness(invoices: InvoiceLite[]): DebtHarness {
  const h: DebtHarness = {
    db: null as unknown as PrismaClient,
    entries: [],
    invoices,
    audits: [],
    shift: { id: 'sh1', status: 'OPEN', queueVersion: 1 },
  };

  const fullEntry = (row: EntryRecord): EntryRecord & { patient: { fullName: string } } => ({
    ...row,
    patient: { fullName: 'Debt Patient' },
  });

  const findUniqueEntry = (args: { where: { id?: string; shiftId_idempotencyKey?: { shiftId: string; idempotencyKey: string } } }): Promise<ReturnType<typeof fullEntry> | null> => {
    if (args.where.id !== undefined) {
      const row = h.entries.find((e) => e.id === args.where.id);
      return Promise.resolve(row === undefined ? null : fullEntry(row));
    }
    const key = args.where.shiftId_idempotencyKey;
    if (key !== undefined) {
      const row = h.entries.find((e) => e.shiftId === key.shiftId && e.idempotencyKey === key.idempotencyKey);
      return Promise.resolve(row === undefined ? null : fullEntry(row));
    }
    return Promise.resolve(null);
  };

  const txApi = {
    invoice: {
      findMany: (args: { where: { patientId: string; status: { in: string[] } } }): Promise<InvoiceLite[]> =>
        Promise.resolve(
          h.invoices.filter(
            (i) => i.patientId === args.where.patientId && args.where.status.in.includes(i.status),
          ),
        ),
    },
    queueEntry: {
      aggregate: (): Promise<{ _max: { position: number | null } }> => {
        const max = h.entries.reduce((acc, e) => Math.max(acc, e.position), 0);
        return Promise.resolve({ _max: { position: max === 0 ? null : max } });
      },
      findUnique: findUniqueEntry,
      findMany: (args: { where: { shiftId: string; status: string } }): Promise<EntryRecord[]> =>
        Promise.resolve(
          h.entries.filter((e) => e.shiftId === args.where.shiftId && e.status === args.where.status),
        ),
      create: (args: { data: Record<string, unknown> }): Promise<ReturnType<typeof fullEntry>> => {
        const row: EntryRecord = {
          id: `q-${h.entries.length + 1}`,
          patientId: String(args.data['patientId']),
          shiftId: String(args.data['shiftId']),
          status: String(args.data['status']),
          isEmergency: args.data['isEmergency'] === true,
          emergencyReasonCode: (args.data['emergencyReasonCode'] as string | null) ?? null,
          position: Number(args.data['position'] ?? 1),
          idempotencyKey: (args.data['idempotencyKey'] as string | null) ?? null,
          checkedInAt: NOW,
          calledAt: null,
          completedAt: null,
          skippedAt: null,
          noShowAt: null,
          abandonAt: null,
          debtAckAt: null,
          debtAckByUserId: null,
        };
        h.entries.push(row);
        return Promise.resolve(fullEntry(row));
      },
      update: (args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReturnType<typeof fullEntry>> => {
        const row = h.entries.find((e) => e.id === args.where.id);
        if (row === undefined) return Promise.reject(new Error('entry not found'));
        Object.assign(row, args.data);
        return Promise.resolve(fullEntry(row));
      },
    },
    shift: {
      update: (args: { data: { queueVersion: { increment: number } } }): Promise<{ queueVersion: number }> => {
        h.shift.queueVersion += args.data.queueVersion.increment;
        return Promise.resolve({ queueVersion: h.shift.queueVersion });
      },
    },
    auditEvent: {
      create: (args: { data: { action: string; entityId: string; afterState?: Record<string, unknown> } }): Promise<{ id: string }> => {
        h.audits.push({ action: args.data.action, entityId: args.data.entityId, afterState: args.data.afterState ?? null });
        return Promise.resolve({ id: `a-${h.audits.length + 1}` });
      },
    },
  };

  const fake = {
    ...txApi,
    shift: {
      ...txApi.shift,
      findFirst: (args: { where: { status: string } }): Promise<{ id: string; status: string; queueVersion: number } | null> =>
        Promise.resolve(args.where.status === 'OPEN' ? { ...h.shift } : null),
    },
    patient: {
      findUnique: (args: { where: { id: string } }): Promise<{ id: string } | null> =>
        Promise.resolve(args.where.id === 'p1' ? { id: 'p1' } : null),
    },
    invoice: {
      findMany: (args: { where: { patientId: string; status: { in: string[] } } }): Promise<InvoiceLite[]> =>
        Promise.resolve(
          h.invoices.filter(
            (i) => i.patientId === args.where.patientId && args.where.status.in.includes(i.status),
          ),
        ),
    },
    queueEntry: {
      ...txApi.queueEntry,
      findUnique: findUniqueEntry,
      findFirst: (args: { where: { shiftId: string; patientId: string; status: { in: string[] } } }): Promise<{ id: string } | null> => {
        const hit = h.entries.find(
          (e) =>
            e.shiftId === args.where.shiftId &&
            e.patientId === args.where.patientId &&
            args.where.status.in.includes(e.status),
        );
        return Promise.resolve(hit === undefined ? null : { id: hit.id });
      },
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txApi),
  };
  h.db = fake as unknown as PrismaClient;
  return h;
}

const SECRETARY = { userId: 'sec-1', role: 'SECRETARY' } as const;
const DEBT_INVOICES: InvoiceLite[] = [
  { patientId: 'p1', status: 'UNPAID', outstandingMinor: 25_000, createdAt: new Date('2026-09-01T00:00:00Z') },
  { patientId: 'p1', status: 'PARTIAL', outstandingMinor: 10_000, createdAt: new Date('2026-09-15T00:00:00Z') },
];

// ---------------------------------------------------------------------------
// Advisory validator contract: no acknowledgement field exists on check-in.
// ---------------------------------------------------------------------------
{
  assert.equal(checkInSchema.safeParse({ patientId: 'p1' }).success, true);
  // The legacy gate vocabulary is REJECTED (strict): debt must never require an ack.
  assert.equal(checkInSchema.safeParse({ patientId: 'p1', acknowledged: true }).success, false);
  assert.equal(debtAckSchema.safeParse({}).success, true);
  assert.equal(debtAckSchema.safeParse({ acknowledged: true }).success, false);
}

// ---------------------------------------------------------------------------
// Check-in with outstanding debt: entry ALWAYS created (201) + advisory alert.
// ---------------------------------------------------------------------------
{
  const h = makeHarness(DEBT_INVOICES);
  const res = await checkIn({ patientId: 'p1' }, SECRETARY, 'key-debt-1', h.db);

  assert.equal(h.entries.length, 1, 'debt must NOT block check-in — the entry is created');
  assert.equal(h.entries[0]!.status, 'WAITING');
  assert.equal(isSecretSafe(res), true);

  const dto = { ...res } as Record<string, unknown>;
  const alert = dto['debtAlert'] as Record<string, unknown> | null;
  assert.ok(alert !== null, 'advisory debtAlert attached');
  assert.equal(alert['outstandingMinor'], 35_000, 'advisory total = sum over UNPAID/PARTIAL');
  assert.equal(alert['oldestInvoiceDate'], '2026-09-01T00:00:00.000Z');
  // No gate vocabulary anywhere in the response.
  assert.equal('requiresAck' in dto, false);
  assert.equal('acknowledged' in dto, false);

  const audit = h.audits.find((a) => a.action === 'QUEUE_CHECKIN');
  assert.ok(audit, 'check-in audit written');

  // Idempotent replay: same key returns the same entry with a FRESH advisory alert.
  const replay = await checkIn({ patientId: 'p1' }, SECRETARY, 'key-debt-1', h.db);
  assert.equal(h.entries.length, 1, 'no duplicate entry on replay');
  const replayDto = { ...replay } as Record<string, unknown>;
  const replayAlert = replayDto['debtAlert'] as Record<string, unknown> | null;
  assert.ok(replayAlert !== null, 'replay still carries the advisory alert');
  assert.equal(replayAlert['outstandingMinor'], 35_000);
}

// ---------------------------------------------------------------------------
// No debt: entry created, debtAlert absent (null) — the advisory is data-driven.
// ---------------------------------------------------------------------------
{
  const h = makeHarness([]);
  const res = await checkIn({ patientId: 'p1' }, SECRETARY, 'key-nodebt-1', h.db);
  assert.equal(h.entries.length, 1);
  const dto = { ...res } as Record<string, unknown>;
  assert.equal(dto['debtAlert'], null, 'no debt -> no advisory alert');
}

// ---------------------------------------------------------------------------
// debt-ack is an OPTIONAL advisory record: it persists who acknowledged and
// audits the outstanding amount, and (being a standalone endpoint) can never
// gate a clinical workflow.
// ---------------------------------------------------------------------------
{
  const h = makeHarness(DEBT_INVOICES);
  await checkIn({ patientId: 'p1' }, SECRETARY, 'key-ack-1', h.db);
  const entry = h.entries[0]!;

  const res = await debtAck(entry.id, SECRETARY, h.db);
  assert.equal(h.entries[0]!.debtAckAt !== null, true, 'ack timestamp recorded');
  assert.equal(h.entries[0]!.debtAckByUserId, 'sec-1', 'ack recorder recorded');

  const audit = h.audits.find((a) => a.action === 'CHECKIN_DEBT_ACK');
  assert.ok(audit, 'CHECKIN_DEBT_ACK audit written');
  assert.equal(audit.afterState?.['outstandingMinor'], 35_000);

  const dto = { ...res } as Record<string, unknown>;
  assert.equal('requiresAck' in dto, false, 'ack response carries no gate vocabulary');
  assert.equal(h.shift.queueVersion, 3, 'queueVersion bumped by check-in then by the advisory write');
}

// eslint-disable-next-line no-console
console.log('Decision 1: debt advisory-only regression tests passed.');
