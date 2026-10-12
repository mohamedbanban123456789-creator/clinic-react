import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors/AppError.js';
import {
  completeEntry,
  undoComplete,
} from '../src/modules/identity-queue/queue.service.js';

/**
 * Decisions 2 + 3 regression gate (service level, fake Prisma — no PostgreSQL):
 *  - Completion atomically creates the patient's UNPAID invoice shell exactly
 *    once (Decision 2 / INV-5 close trap), using the existing billing rules.
 *  - Undo-complete is a normal reversal to IN_CONSULTATION (Decision 3 /
 *    API-06), retains the invoice, requires a reason, honours OCC.
 * Rollback on real PostgreSQL is guaranteed by the interactive transaction; the
 * fake asserts the ordering contract (audit + version bump only after success).
 */

// ---------------------------------------------------------------------------
// Fake Prisma (mirrors the makeDb() harness style of endpoints-be-remediation).
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  patientId: string;
  queueEntryId: string;
  shiftId: string;
  standardFeeMinor: number;
  finalFeeMinor: number;
  discountMinor: number;
  collectedMinor: number;
  writeOffMinor: number;
  outstandingMinor: number;
  status: string;
  source: string;
  idempotencyKey: string;
}

interface EntryRow {
  id: string;
  patientId: string;
  shiftId: string;
  status: string;
  position: number;
  isEmergency: boolean;
  emergencyReasonCode: string | null;
  checkedInAt: Date;
  calledAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  noShowAt: Date | null;
  abandonAt: Date | null;
  debtAckAt: Date | null;
  undoWindowUntil: Date | null;
}

interface AuditRow {
  action: string;
  entityId: string;
  reasonText: string | null;
  afterState: Record<string, unknown> | null;
}

interface Harness {
  db: PrismaClient;
  entries: Map<string, EntryRow>;
  invoices: InvoiceRow[];
  encounters: Array<{ id: string; queueEntryRef: string; status: string }>;
  receipts: Array<{ invoiceId: string }>;
  audits: AuditRow[];
  shift: { id: string; status: string; queueVersion: number };
  settings: { standardFeeMinor: number } | null;
  failInvoiceCreateOnce: boolean;
}

const PAST = new Date(Date.now() - 60_000);

function makeHarness(opts: { settings?: { standardFeeMinor: number } | null } = {}): Harness {
  const h: Harness = {
    db: null as unknown as PrismaClient,
    entries: new Map(),
    invoices: [],
    encounters: [],
    receipts: [],
    audits: [],
    shift: { id: 'sh1', status: 'OPEN', queueVersion: 3 },
    settings: opts.settings === undefined ? { standardFeeMinor: 50_000 } : opts.settings,
    failInvoiceCreateOnce: false,
  };

  const entryRow = (row: EntryRow): EntryRow & { patient: { fullName: string } } => ({
    ...row,
    patient: { fullName: 'Test Patient' },
  });

  const txApi = {
    $queryRaw: (): Promise<unknown[]> => Promise.resolve([]),
    shift: {
      findUniqueOrThrow: (args: { where: { id: string } }): Promise<{ id: string; queueVersion: number }> => {
        if (args.where.id !== h.shift.id) return Promise.reject(new Error('shift not found'));
        return Promise.resolve({ id: h.shift.id, queueVersion: h.shift.queueVersion });
      },
      update: (args: { data: { queueVersion: { increment: number } } }): Promise<{ queueVersion: number }> => {
        h.shift.queueVersion += args.data.queueVersion.increment;
        return Promise.resolve({ queueVersion: h.shift.queueVersion });
      },
    },
    queueEntry: {
      findUniqueOrThrow: (args: { where: { id: string } }): Promise<EntryRow> => {
        const row = h.entries.get(args.where.id);
        if (row === undefined) return Promise.reject(new Error('entry not found'));
        return Promise.resolve({ ...row });
      },
      update: (args: { where: { id: string }; data: Partial<EntryRow> }): Promise<ReturnType<typeof entryRow>> => {
        const row = h.entries.get(args.where.id);
        if (row === undefined) return Promise.reject(new Error('entry not found'));
        Object.assign(row, args.data);
        return Promise.resolve(entryRow(row));
      },
    },
    invoice: {
      findUnique: (args: { where: { queueEntryId: string } }): Promise<InvoiceRow | null> =>
        Promise.resolve(h.invoices.find((i) => i.queueEntryId === args.where.queueEntryId) ?? null),
      create: (args: { data: Omit<InvoiceRow, 'id'> }): Promise<{ id: string }> => {
        if (h.failInvoiceCreateOnce) {
          h.failInvoiceCreateOnce = false;
          const err = Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['queue_entry_id'] },
          });
          return Promise.reject(err);
        }
        const id = `inv-${h.invoices.length + 1}`;
        h.invoices.push({ id, ...args.data });
        return Promise.resolve({ id });
      },
    },
    encounter: {
      findFirst: (args: { where: { queueEntryRef: string; status: string } }): Promise<{ id: string } | null> => {
        const hit = h.encounters.find((e) => e.queueEntryRef === args.where.queueEntryRef && e.status === args.where.status);
        return Promise.resolve(hit === undefined ? null : { id: hit.id });
      },
    },
    receipt: {
      count: (args: { where: { invoiceId: string } }): Promise<number> =>
        Promise.resolve(h.receipts.filter((r) => r.invoiceId === args.where.invoiceId).length),
    },
    clinicSettings: {
      findUnique: (): Promise<{ standardFeeMinor: number } | null> => Promise.resolve(h.settings),
    },
    auditEvent: {
      create: (args: { data: { action: string; entityId: string; reasonText?: string; afterState?: Record<string, unknown> } }): Promise<{ id: string }> => {
        h.audits.push({
          action: args.data.action,
          entityId: args.data.entityId,
          reasonText: args.data.reasonText ?? null,
          afterState: args.data.afterState ?? null,
        });
        return Promise.resolve({ id: `audit-${h.audits.length + 1}` });
      },
    },
  };

  const fake = {
    ...txApi,
    shift: {
      ...txApi.shift,
      findFirst: (args: { where: { status: string } }): Promise<{ id: string; status: string; queueVersion: number } | null> =>
        Promise.resolve(args.where.status === 'OPEN' ? { id: h.shift.id, status: 'OPEN', queueVersion: h.shift.queueVersion } : null),
    },
    queueEntry: {
      ...txApi.queueEntry,
      findUnique: (args: { where: { id: string } }): Promise<EntryRow | null> =>
        Promise.resolve(h.entries.get(args.where.id) ?? null),
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txApi),
  };
  h.db = fake as unknown as PrismaClient;
  return h;
}

function seedEntry(h: Harness, overrides: Partial<EntryRow> = {}): EntryRow {
  const row: EntryRow = {
    id: 'q1',
    patientId: 'p1',
    shiftId: 'sh1',
    status: 'IN_CONSULTATION',
    position: 2,
    isEmergency: false,
    emergencyReasonCode: null,
    checkedInAt: PAST,
    calledAt: PAST,
    completedAt: null,
    skippedAt: null,
    noShowAt: null,
    abandonAt: null,
    debtAckAt: null,
    undoWindowUntil: null,
    ...overrides,
  };
  h.entries.set(row.id, row);
  return row;
}

const DOCTOR = { userId: 'doctor-1', role: 'DOCTOR' } as const;

// ---------------------------------------------------------------------------
// Decision 2: completion auto-creates the UNPAID invoice shell exactly once.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  const entry = seedEntry(h);

  const res = await completeEntry('q1', DOCTOR, h.db);
  assert.equal(res.status, 'COMPLETED');

  // Exactly one invoice, standard-fee snapshot from the existing billing rules.
  assert.equal(h.invoices.length, 1, 'completion creates exactly one invoice');
  const inv = h.invoices[0]!;
  assert.equal(inv.queueEntryId, 'q1');
  assert.equal(inv.patientId, 'p1');
  assert.equal(inv.shiftId, 'sh1');
  assert.equal(inv.status, 'UNPAID');
  assert.equal(inv.standardFeeMinor, 50_000, 'standard fee from clinic settings');
  assert.equal(inv.finalFeeMinor, 50_000, 'no fee invented: final = standard');
  assert.equal(inv.discountMinor, 0);
  assert.equal(inv.collectedMinor, 0);
  assert.equal(inv.outstandingMinor, 50_000);
  assert.equal(inv.idempotencyKey, `completion:q1`, 'deterministic idempotency key');

  // Audit records the auto-created invoice.
  const audit = h.audits.find((a) => a.action === 'QUEUE_COMPLETE');
  assert.ok(audit, 'QUEUE_COMPLETE audit written');
  assert.equal(audit.afterState?.['invoiceId'], 'inv-1');
  assert.equal(audit.afterState?.['invoiceCreated'], true);
  // INV-10 (QA): the auto-created shell gets its own Invoice-keyed billing
  // audit in the same transaction — without it every bare completion failed
  // shift close with INVARIANT_VIOLATION (missing audit coverage).
  const billingAudit = h.audits.find((a) => a.action === 'CHECKOUT' && a.entityId === 'inv-1');
  assert.ok(billingAudit, 'CHECKOUT billing audit written for the auto-created invoice (INV-10)');
  assert.equal(h.shift.queueVersion, 4, 'queueVersion bumped once');

  // Undo window armed for API-06.
  assert.ok(h.entries.get('q1')?.undoWindowUntil !== null);
  assert.equal(entry.id, 'q1');
}

// ---------------------------------------------------------------------------
// Decision 2: re-completion after undo reuses the SAME invoice (no duplicates).
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  seedEntry(h);
  await completeEntry('q1', DOCTOR, h.db);
  // Undo (as Decision 3 defines it) retains the UNPAID shell.
  h.entries.get('q1')!.status = 'IN_CONSULTATION';
  const before = h.invoices.length;
  await completeEntry('q1', DOCTOR, h.db);
  assert.equal(h.invoices.length, before, 're-completion must NOT create a second invoice');
  assert.equal(h.invoices[0]!.id, 'inv-1', 'the original shell is reused');
  const audit = h.audits.filter((a) => a.action === 'QUEUE_COMPLETE').pop();
  assert.equal(audit?.afterState?.['invoiceCreated'], false, 'audit reports reuse, not creation');
}

// ---------------------------------------------------------------------------
// Decision 2: pre-existing invoice (checkout path) is reused, never duplicated.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  seedEntry(h);
  h.invoices.push({
    id: 'inv-manual',
    patientId: 'p1',
    queueEntryId: 'q1',
    shiftId: 'sh1',
    standardFeeMinor: 60_000,
    finalFeeMinor: 60_000,
    discountMinor: 0,
    collectedMinor: 0,
    writeOffMinor: 0,
    outstandingMinor: 60_000,
    status: 'UNPAID',
    source: 'CHECKOUT',
    idempotencyKey: 'manual-key',
  });
  await completeEntry('q1', DOCTOR, h.db);
  assert.equal(h.invoices.length, 1, 'existing invoice preserved');
  assert.equal(h.invoices[0]!.standardFeeMinor, 60_000, 'existing financials untouched');
  const audit = h.audits.find((a) => a.action === 'QUEUE_COMPLETE');
  assert.equal(audit?.afterState?.['invoiceId'], 'inv-manual');
  assert.equal(audit?.afterState?.['invoiceCreated'], false);
}

// ---------------------------------------------------------------------------
// Decision 2: concurrent completion race — P2002 on queueEntryId converges on
// the winner's invoice instead of failing the completion.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  seedEntry(h);
  h.failInvoiceCreateOnce = true;
  h.invoices.push({
    id: 'inv-winner',
    patientId: 'p1',
    queueEntryId: 'q1',
    shiftId: 'sh1',
    standardFeeMinor: 50_000,
    finalFeeMinor: 50_000,
    discountMinor: 0,
    collectedMinor: 0,
    writeOffMinor: 0,
    outstandingMinor: 50_000,
    status: 'UNPAID',
    source: 'COMPLETION_AUTO',
    idempotencyKey: 'completion:q1',
  });
  const res = await completeEntry('q1', DOCTOR, h.db);
  assert.equal(res.status, 'COMPLETED', 'race loser still completes');
  assert.equal(h.invoices.length, 1, 'no duplicate invoice');
  const audit = h.audits.find((a) => a.action === 'QUEUE_COMPLETE');
  assert.equal(audit?.afterState?.['invoiceId'], 'inv-winner');
}

// ---------------------------------------------------------------------------
// Decision 2 financial-integrity rule: a misconfigured (non-positive) fee is a
// clear 422 failure — never a fabricated invoice.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ settings: { standardFeeMinor: 0 } });
  seedEntry(h);
  let thrown: unknown = null;
  try {
    await completeEntry('q1', DOCTOR, h.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'FEE_NOT_CONFIGURED');
  assert.equal((thrown as AppError).statusCode, 422);
  assert.equal(h.invoices.length, 0, 'no invoice shell created');
  assert.equal(h.audits.length, 0, 'completion audit not written on failure');
}

// ---------------------------------------------------------------------------
// Decision 3: undo restores IN_CONSULTATION (API-06), keeps position/calledAt,
// retains the invoice, audits the reason.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  const entry = seedEntry(h, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  h.invoices.push({
    id: 'inv-shell',
    patientId: 'p1',
    queueEntryId: 'q1',
    shiftId: 'sh1',
    standardFeeMinor: 50_000,
    finalFeeMinor: 50_000,
    discountMinor: 0,
    collectedMinor: 0,
    writeOffMinor: 0,
    outstandingMinor: 50_000,
    status: 'UNPAID',
    source: 'COMPLETION_AUTO',
    idempotencyKey: 'completion:q1',
  });

  const res = await undoComplete('q1', { reason: 'Signed the wrong patient' }, DOCTOR, h.db);
  assert.equal(res.status, 'IN_CONSULTATION', 'undo restores the ACTIVE consultation state (API-06)');
  assert.equal(res.estimatedWaitMin, 0);

  const row = h.entries.get('q1')!;
  assert.equal(row.status, 'IN_CONSULTATION');
  assert.equal(row.completedAt, null, 'completion timestamp cleared');
  assert.equal(row.undoWindowUntil, null, 'undo window consumed');
  assert.ok(row.calledAt !== null, 'calledAt preserved — patient was already called');
  assert.equal(row.position, entry.position, 'queue position preserved');

  assert.equal(h.invoices.length, 1, 'invoice retained (zero-hard-delete)');
  assert.equal(h.invoices[0]!.status, 'UNPAID');

  const audit = h.audits.find((a) => a.action === 'QUEUE_COMPLETE_UNDO');
  assert.ok(audit, 'QUEUE_COMPLETE_UNDO audit written');
  assert.equal(audit.reasonText, 'Signed the wrong patient', 'reason audited');
  assert.equal(audit.afterState?.['status'], 'IN_CONSULTATION');
  assert.equal(audit.afterState?.['retainedInvoiceId'], 'inv-shell');
}

// ---------------------------------------------------------------------------
// Decision 3: OCC + guard rails on undo.
// ---------------------------------------------------------------------------
{
  // Stale lastSeenQueueVersion -> 409 STALE_QUEUE.
  const h1 = makeHarness();
  seedEntry(h1, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  let thrown: unknown = null;
  try {
    await undoComplete('q1', { reason: 'r', lastSeenQueueVersion: 2 }, DOCTOR, h1.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'STALE_QUEUE');
  assert.equal((thrown as AppError).statusCode, 409);

  // Matching version passes.
  const h2 = makeHarness();
  seedEntry(h2, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  const ok = await undoComplete('q1', { reason: 'r', lastSeenQueueVersion: 3 }, DOCTOR, h2.db);
  assert.equal(ok.status, 'IN_CONSULTATION');

  // Not COMPLETED -> ILLEGAL_TRANSITION.
  const h3 = makeHarness();
  seedEntry(h3, { status: 'IN_CONSULTATION' });
  thrown = null;
  try {
    await undoComplete('q1', { reason: 'r' }, DOCTOR, h3.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'ILLEGAL_TRANSITION');

  // Expired window -> 400 UNDO_WINDOW_EXPIRED.
  const h4 = makeHarness();
  seedEntry(h4, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() - 1_000) });
  thrown = null;
  try {
    await undoComplete('q1', { reason: 'r' }, DOCTOR, h4.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'UNDO_WINDOW_EXPIRED');
  assert.equal((thrown as AppError).statusCode, 400);

  // Signed encounter linked -> 409 UNDO_BLOCKED.
  const h5 = makeHarness();
  seedEntry(h5, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  h5.encounters.push({ id: 'enc-1', queueEntryRef: 'q1', status: 'SIGNED' });
  thrown = null;
  try {
    await undoComplete('q1', { reason: 'r' }, DOCTOR, h5.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'UNDO_BLOCKED');

  // Invoice PARTIAL -> UNDO_BLOCKED (money moved).
  const h6 = makeHarness();
  seedEntry(h6, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  h6.invoices.push({
    id: 'inv-part', patientId: 'p1', queueEntryId: 'q1', shiftId: 'sh1',
    standardFeeMinor: 50_000, finalFeeMinor: 50_000, discountMinor: 0,
    collectedMinor: 10_000, writeOffMinor: 0, outstandingMinor: 40_000,
    status: 'PARTIAL', source: 'CHECKOUT', idempotencyKey: 'k',
  });
  thrown = null;
  try {
    await undoComplete('q1', { reason: 'r' }, DOCTOR, h6.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'UNDO_BLOCKED');

  // UNPAID invoice but receipts exist -> UNDO_BLOCKED.
  const h7 = makeHarness();
  seedEntry(h7, { status: 'COMPLETED', undoWindowUntil: new Date(Date.now() + 60_000) });
  h7.invoices.push({
    id: 'inv-unpaid', patientId: 'p1', queueEntryId: 'q1', shiftId: 'sh1',
    standardFeeMinor: 50_000, finalFeeMinor: 50_000, discountMinor: 0,
    collectedMinor: 0, writeOffMinor: 0, outstandingMinor: 50_000,
    status: 'UNPAID', source: 'CHECKOUT', idempotencyKey: 'k',
  });
  h7.receipts.push({ invoiceId: 'inv-unpaid' });
  thrown = null;
  try {
    await undoComplete('q1', { reason: 'r' }, DOCTOR, h7.db);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof AppError);
  assert.equal((thrown as AppError).code, 'UNDO_BLOCKED');
}

// ---------------------------------------------------------------------------
// Decision 2 + INV-5: after completion, every COMPLETED entry has exactly one
// invoice — the shift-close INV-5 predicate holds on the shell path.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  seedEntry(h, { id: 'q1', position: 1 });
  seedEntry(h, { id: 'q2', position: 2 });
  await completeEntry('q1', DOCTOR, h.db);
  await completeEntry('q2', DOCTOR, h.db);

  const invoiceByQueueEntry = new Map<string, number>();
  for (const inv of h.invoices) {
    invoiceByQueueEntry.set(inv.queueEntryId, (invoiceByQueueEntry.get(inv.queueEntryId) ?? 0) + 1);
  }
  for (const entry of h.entries.values()) {
    if (entry.status !== 'COMPLETED') continue;
    assert.equal(invoiceByQueueEntry.get(entry.id) ?? 0, 1, `INV-5: ${entry.id} has exactly one invoice`);
  }
}

// eslint-disable-next-line no-console
console.log('Decisions 2+3: completion auto-invoice + API-06 undo regression tests passed.');
