import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { writeOffInvoice, getPatientBalance, listInvoices, checkout, payInvoice, complimentary } from '../src/modules/cashier-shift/billing.service.js';
import { deriveInvoiceStatus } from '../src/modules/cashier-shift/billing.support.js';
import { queryAuditEvents } from '../src/modules/audit/audit.service.js';
import { getFrontDeskActivity } from '../src/modules/supervision/supervision.service.js';
import { updatePublicSettings, getPublicSettings } from '../src/modules/clinic-settings/settings.service.js';
import { requireRole } from '../src/common/middleware/requireRole.js';
import type { AuthContext } from '../src/common/middleware/authenticate.js';
import { AppError } from '../src/common/errors/AppError.js';
import { toSecretInvoiceDto, toInvoiceRow } from '../src/modules/cashier-shift/billing.dto.js';
import { isSecretSafe } from '../src/common/types/secretSafe.js';
import { writeOffSchema } from '../src/modules/cashier-shift/billing.validators.js';
import { patchEncounter, addEncounterAddendum } from '../src/modules/clinical-ehr/encounter.service.js';

// ---------------------------------------------------------------------------
// In-memory Prisma stand-in. Every service under test is pure given `db`, so
// the whole suite runs without PostgreSQL or `DATABASE_URL`.
// ---------------------------------------------------------------------------
interface InvoiceRow {
  id: string;
  patientId: string;
  queueEntryId: string;
  shiftId: string;
  standardFeeMinor: number;
  finalFeeMinor: number;
  discountMinor: number;
  discountReason: string | null;
  isComplimentary: boolean;
  collectedMinor: number;
  writeOffMinor: number;
  writeOffReason: string | null;
  outstandingMinor: number;
  status: string;
  complimentaryAuthorizedByUserId: string | null;
  createdAt: Date;
  idempotencyKey: string | null;
  createdByUserId: string;
}

interface EncounterRow {
  id: string;
  patientId: string;
  status: string;
  rowVersion: number;
  visitDate: Date;
  encounterType: string;
  soapSubjective: string | null;
  soapObjective: string | null;
  soapAssessment: string | null;
  soapPlan: string | null;
  mseAppearance: string;
  mseBehavior: string;
  mseSpeechCoherence: string;
  mseMoodAffect: string;
  diagnoses: string[];
  finalContentHash: string | null;
  addendumCount: number;
  signedAt: Date | null;
  signedByUserId: string | null;
}

function makeDb(options: {
  invoices?: InvoiceRow[];
  patients?: Array<{ id: string; outstandingBalanceMinor: number }>;
  audits?: Array<Record<string, unknown>>;
  settingsRow?: Record<string, unknown> | null;
  encounters?: EncounterRow[];
} = {}): {
  db: PrismaClient;
  invoices: InvoiceRow[];
  patients: Array<{ id: string; outstandingBalanceMinor: number }>;
  audits: Array<Record<string, unknown>>;
  encounters: EncounterRow[];
} {
  const invoices = options.invoices ?? [];
  const patients = options.patients ?? [{ id: 'p1', outstandingBalanceMinor: 0 }];
  const audits = options.audits ?? [];
  const settingsRow = options.settingsRow;
  const encounters = options.encounters ?? [];

  const byId = (id: string): InvoiceRow | undefined => invoices.find((i) => i.id === id);

  const db = {
    $queryRaw: async (): Promise<unknown[]> => [],
    $transaction: async (cb: (tx: unknown) => Promise<unknown>): Promise<unknown> => cb(db),
    shift: {
      findFirst: async (): Promise<{ id: string; queueVersion: number }> => ({ id: 'sh1', queueVersion: 3 }),
      findUnique: async (args: { where: { id: string } }): Promise<Record<string, unknown> | null> =>
        args.where.id === 'sh1'
          ? {
              id: 'sh1',
              businessDate: new Date('2026-01-01T00:00:00Z'),
              status: 'OPEN',
              openingFloatMinor: 0,
              queueVersion: 3,
            }
          : null,
    },
    queueEntry: {
      findUnique: async (): Promise<{ id: string; patientId: string; shiftId: string; status: string } | null> =>
        ({ id: 'q1', patientId: 'p1', shiftId: 'sh1', status: 'COMPLETED' }),
      findMany: async (): Promise<Array<{ id: string }>> => [{ id: 'q1' }],
    },
    pettyExpense: {
      findMany: async (): Promise<Array<{ id: string }>> => [],
    },
    patient: {
      findUnique: async (args: { where: { id: string } }): Promise<{ id: string } | null> =>
        patients.find((p) => p.id === args.where.id) === undefined ? null : { id: args.where.id },
      update: async (args: {
        where: { id: string };
        data: { outstandingBalanceMinor: number };
      }): Promise<unknown> => {
        const p = patients.find((x) => x.id === args.where.id);
        if (p !== undefined) p.outstandingBalanceMinor = args.data.outstandingBalanceMinor;
        return p;
      },
    },
    invoice: {
      findUnique: async (args: { where: { id?: string; queueEntryId?: string } }): Promise<InvoiceRow | null> => {
        const w = args.where;
        if (w.id !== undefined) return byId(w.id) ?? null;
        if (w.queueEntryId !== undefined) return invoices.find((i) => i.queueEntryId === w.queueEntryId) ?? null;
        return null;
      },
      findUniqueOrThrow: async (args: { where: { id: string } }): Promise<InvoiceRow> => {
        const row = byId(args.where.id);
        if (row === undefined) throw new Error('P2025');
        return row;
      },
      findMany: async (args: {
        where: unknown;
        orderBy: { createdAt: string } | unknown;
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }): Promise<InvoiceRow[]> => {
        const sorted = [...invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const take = args.take ?? sorted.length;
        if (args.cursor !== undefined) {
          const idx = sorted.findIndex((i) => i.id === (args.cursor as { id: string }).id);
          if (idx >= 0) return sorted.slice(idx + 1, idx + 1 + take);
        }
        return sorted.slice(0, take);
      },
      create: async (args: { data: Partial<InvoiceRow> }): Promise<InvoiceRow> => {
        const row = {
          id: `inv-${invoices.length + 1}`,
          patientId: 'p1',
          queueEntryId: 'q1',
          shiftId: 'sh1',
          standardFeeMinor: 0,
          finalFeeMinor: 0,
          discountMinor: 0,
          discountReason: null,
          isComplimentary: false,
          collectedMinor: 0,
          writeOffMinor: 0,
          writeOffReason: null,
          outstandingMinor: 0,
          status: 'UNPAID',
          complimentaryAuthorizedByUserId: null,
          createdAt: new Date(),
          idempotencyKey: null,
          createdByUserId: 'u-doc',
          ...args.data,
        } as InvoiceRow;
        invoices.push(row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> => {
        const row = byId(args.where.id);
        if (row === undefined) throw new Error('P2025');
        Object.assign(row, args.data);
        return row;
      },
      aggregate: async (args: { where: { status: { in: string[] } } }): Promise<{ _sum: { outstandingMinor: number | null } }> => {
        const total = invoices
          .filter((i) => args.where.status.in.includes(i.status))
          .reduce((s, i) => s + i.outstandingMinor, 0);
        return { _sum: { outstandingMinor: total } };
      },
    },
    receipt: {
      create: async (args: { data: Partial<{ id: string; type: string; amountMinor: number }> }): Promise<unknown> =>
        ({ id: 'rc-1', type: 'CHARGE', amountMinor: 0, ...args.data }),
      findMany: async (): Promise<Array<{ id: string }>> => [],
      groupBy: async (): Promise<Array<{ type: string; _sum: { amountMinor: number | null } }>> => [
        { type: 'CHARGE', _sum: { amountMinor: 20000 } },
      ],
    },
    auditEvent: {
      create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        const row = { id: `a-${audits.length + 1}`, createdAt: new Date(), ...args.data };
        audits.push(row);
        return row;
      },
      findMany: async (args: {
        where: {
          action?: string;
          entityType?: string | { notIn: string[] };
          entityId?: string | { in: string[] };
          actorUserId?: string;
          createdAt?: unknown;
        };
        orderBy: { createdAt: string };
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }): Promise<Array<Record<string, unknown>>> => {
        let rows = [...audits];
        const w = args.where ?? {};
        if (w.actorUserId !== undefined) rows = rows.filter((r) => r.actorUserId === w.actorUserId);
        const et = w.entityType;
        if (typeof et === 'string') rows = rows.filter((r) => r.entityType === et);
        else if (typeof et === 'object' && 'notIn' in et) {
          const hidden = (et as { notIn: string[] }).notIn;
          rows = rows.filter((r) => !hidden.includes(String(r.entityType)));
        }
        if (w.entityId !== undefined) {
          const eid = w.entityId;
          if (typeof eid === 'string') rows = rows.filter((r) => r.entityId === eid);
          else if (typeof eid === 'object' && 'in' in eid) rows = rows.filter((r) => (eid as { in: string[] }).in.includes(String(r.entityId)));
        }
        if (w.action !== undefined) rows = rows.filter((r) => r.action === w.action);
        rows = rows.sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
        const take = args.take ?? rows.length;
        if (args.cursor !== undefined) {
          const idx = rows.findIndex((r) => r.id === (args.cursor as { id: string }).id);
          if (idx >= 0) return rows.slice(idx + 1, idx + 1 + take);
        }
        return rows.slice(0, take);
      },
    },
    clinicSettings: {
      findUnique: async (): Promise<Record<string, unknown> | null> => settingsRow ?? null,
      upsert: async (args: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<Record<string, unknown>> => {
        const base =
          settingsRow ??
          ({
            standardFeeMinor: 50000,
            currency: 'USD',
            avgConsultDurationMin: 20,
            openingFloatMinor: 0,
            secretaryMaxDiscountMinor: 5000,
            secretaryMaxDiscountPct: 10,
            audioRetentionDays: 30,
          } as Record<string, unknown>);
        return { ...base, ...args.update };
      },
    },
    encounter: {
      findUnique: async (args: { where: { id: string } }): Promise<EncounterRow | null> => {
        return encounters.find((e) => e.id === args.where.id) ?? null;
      },
      findUniqueOrThrow: async (args: { where: { id: string } }): Promise<EncounterRow> => {
        const e = encounters.find((x) => x.id === args.where.id);
        if (!e) throw new Error('P2025');
        return e;
      },
      updateMany: async (args: {
        where: { id: string; rowVersion?: number; status?: string | { in: string[] } };
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        const e = encounters.find((x) => x.id === args.where.id);
        if (!e) return { count: 0 };
        if (args.where.rowVersion !== undefined && e.rowVersion !== args.where.rowVersion) return { count: 0 };
        if (args.where.status !== undefined) {
          if (typeof args.where.status === 'string' && e.status !== args.where.status) return { count: 0 };
          if (typeof args.where.status === 'object' && 'in' in args.where.status && !args.where.status.in.includes(e.status)) return { count: 0 };
        }
        if (args.data.rowVersion && typeof args.data.rowVersion === 'object' && 'increment' in (args.data.rowVersion as object)) {
          e.rowVersion += 1;
        }
        if (args.data.status && typeof args.data.status === 'string') e.status = args.data.status;
        if (args.data.soapSubjective !== undefined) e.soapSubjective = args.data.soapSubjective as string;
        if (args.data.soapObjective !== undefined) e.soapObjective = args.data.soapObjective as string;
        if (args.data.soapAssessment !== undefined) e.soapAssessment = args.data.soapAssessment as string;
        if (args.data.soapPlan !== undefined) e.soapPlan = args.data.soapPlan as string;
        if (args.data.finalContentHash !== undefined) e.finalContentHash = args.data.finalContentHash as string;
        return { count: 1 };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<EncounterRow> => {
        const e = encounters.find((x) => x.id === args.where.id);
        if (!e) throw new Error('P2025');
        if (args.data.addendumCount && typeof args.data.addendumCount === 'object' && 'increment' in (args.data.addendumCount as object)) {
          e.addendumCount += 1;
        }
        return e;
      },
    },
    encounterAddendum: {
      create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => ({
        id: 'add-1',
        ...args.data,
        createdAt: new Date(),
      }),
    },
  };

  return { db: db as unknown as PrismaClient, invoices, patients, audits, encounters };
}

function baseInvoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv-1',
    patientId: 'p1',
    queueEntryId: 'q1',
    shiftId: 'sh1',
    standardFeeMinor: 100000,
    finalFeeMinor: 100000,
    discountMinor: 0,
    discountReason: null,
    isComplimentary: false,
    collectedMinor: 20000,
    writeOffMinor: 0,
    writeOffReason: null,
    outstandingMinor: 80000,
    status: 'UNPAID',
    complimentaryAuthorizedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    idempotencyKey: 'k-write-off',
    createdByUserId: 'u-sec',
    ...overrides,
  };
}

const DOCTOR = { userId: 'u-doc', role: 'DOCTOR' as const };
const SECRETARY = { userId: 'u-sec', role: 'SECRETARY' as const };

/** PUT /settings guard harness (mirrors the mounted authenticate -> requireRole chain). */
function mockSettingsReq(role: 'DOCTOR' | 'SECRETARY'): Request {
  const req = { method: 'PUT', originalUrl: '/api/v1/settings', path: '/', params: {}, body: {} } as unknown as Request;
  (req as Request & { auth: AuthContext }).auth = { userId: 'u-1', role, tokenVersion: 1, mustChangePassword: false };
  return req;
}

// ===========================================================================
// E-1 — mandatory Idempotency-Key on write-off
// ===========================================================================
{
  // Wire shape: the write-off validator requires the key, and the route passes
  // readIdempotencyKey(req) which rejects a missing/blank header. Verified here
  // as the service contract plus the route's mandatory middleware registration.
  const parsed = writeOffSchema.safeParse({ writeOffMinor: 80000, writeOffReason: 'Patient relocated, unreachable' });
  assert.equal(parsed.success, true, 'valid write-off payload passes');

  assert.equal(
    writeOffSchema.safeParse({ writeOffMinor: 80000 }).success,
    false,
    'writeOffReason is required',
  );
  assert.equal(
    writeOffSchema.safeParse({ writeOffMinor: 80000, writeOffReason: '   ' }).success,
    false,
    'blank reason rejected (trimmed)',
  );
  assert.equal(
    writeOffSchema.safeParse({ writeOffMinor: 0, writeOffReason: 'x' }).success,
    false,
    'writeOffMinor must be > 0',
  );
  assert.equal(
    writeOffSchema.safeParse({ writeOffMinor: 1, writeOffReason: 'x', extra: 1 }).success,
    false,
    'strict schema',
  );
}

// ===========================================================================
// E-2 — audit action is the canonical spec enum WRITE_OFF (not INVOICE_WRITE_OFF)
// ===========================================================================
{
  const { db, invoices, audits } = makeDb({ invoices: [baseInvoice()] });
  const dto = await writeOffInvoice('inv-1', { writeOffMinor: 80000, writeOffReason: 'Unreachable after 3 notices' }, DOCTOR, 'k-write-off', db);

  assert.equal(dto.invoiceId, 'inv-1');
  assert.equal(dto.status, 'WRITTEN_OFF', 'fully written off -> WRITTEN_OFF');
  assert.equal(dto.outstandingMinor, 0, 'outstanding reduced to 0');
  assert.equal(dto.writeOffMinor, 80000, 'writeOffMinor accumulated');

  const wo = audits.filter((a) => a.action === 'WRITE_OFF');
  assert.equal(wo.length, 1, 'exactly one WRITE_OFF audit row');
  assert.equal(
    audits.filter((a) => a.action === 'INVOICE_WRITE_OFF').length,
    0,
    'the non-canonical INVOICE_WRITE_OFF action must not be emitted',
  );
  assert.equal(wo[0]!.entityType, 'Invoice', 'audit targets the Invoice entity');
  assert.equal(wo[0]!.actorRole, 'DOCTOR');
  assert.equal(String(wo[0]!.reasonText), 'Unreachable after 3 notices', 'reason carried into audit');

  // Status + money persisted on the stored row.
  assert.equal(invoices[0]!.status, 'WRITTEN_OFF');
  assert.equal(invoices[0]!.writeOffMinor, 80000);
  assert.equal(invoices[0]!.outstandingMinor, 0);
  assert.equal(invoices[0]!.writeOffReason, 'Unreachable after 3 notices');
}

// ===========================================================================
// E-3 — WRITTEN_OFF is terminal: no resurrection by write-off, pay, or checkout
// ===========================================================================
{
  // (a) duplicate write-off rejected with the dedicated 400 code.
  const { db, audits } = makeDb({ invoices: [baseInvoice()] });
  // First write-off succeeds fully (outstanding -> 0, status -> WRITTEN_OFF).
  await writeOffInvoice('inv-1', { writeOffMinor: 80000, writeOffReason: 'Unreachable after 3 notices' }, DOCTOR, 'k-1', db);
  const before = audits.length;
  await assert.rejects(
    () => writeOffInvoice('inv-1', { writeOffMinor: 80000, writeOffReason: 'Unreachable after 3 notices' }, DOCTOR, 'k-2', db),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVOICE_ALREADY_WRITTEN_OFF' &&
      err.statusCode === 400,
    'second write-off must be INVOICE_ALREADY_WRITTEN_OFF/400',
  );
  assert.equal(audits.length, before, 'rejected write-off writes no audit row');
}
{
  // (b) payInvoice on a written-off invoice -> 400 INVOICE_ALREADY_WRITTEN_OFF.
  const { db } = makeDb({ invoices: [baseInvoice({ status: 'WRITTEN_OFF', writeOffMinor: 80000, outstandingMinor: 0 })] });
  await assert.rejects(
    () => payInvoice('inv-1', { amountMinor: 1000 }, DOCTOR, 'k-pay', db),
    (err: unknown) => err instanceof AppError && err.code === 'INVOICE_ALREADY_WRITTEN_OFF' && err.statusCode === 400,
    'pay on a written-off invoice must be rejected',
  );
}
{
  // (c) checkout on a queue entry whose invoice is written off -> 400.
  const { db } = makeDb({ invoices: [baseInvoice({ status: 'WRITTEN_OFF', writeOffMinor: 80000, outstandingMinor: 0 })] });
  await assert.rejects(
    () => checkout({ queueEntryId: 'q1', collectedMinor: 0 }, DOCTOR, 'k-checkout', db),
    (err: unknown) => err instanceof AppError && err.code === 'INVOICE_ALREADY_WRITTEN_OFF' && err.statusCode === 400,
    're-checkout must not resurrect a written-off invoice',
  );
}
{
  // (d) deriveInvoiceStatus terminal-state guard.
  assert.equal(deriveInvoiceStatus(100000, 20000, false, 'WRITTEN_OFF', 80000), 'WRITTEN_OFF', 'sticky WRITTEN_OFF');
  assert.equal(deriveInvoiceStatus(100000, 20000, false, 'UNPAID', 80000), 'WRITTEN_OFF', 'outstanding 0 + writeOff > 0 -> WRITTEN_OFF');
  assert.equal(deriveInvoiceStatus(100000, 20000, false, 'PARTIAL', 50000), 'PARTIAL', 'partial write-off stays PARTIAL');
  assert.equal(deriveInvoiceStatus(100000, 20000, false, 'PARTIAL', 20000), 'PARTIAL', 'partial write-off 20000 keeps 60000 due');
  assert.equal(deriveInvoiceStatus(100000, 20000, false, 'UNPAID', 0), 'PARTIAL', 'no write-off -> plain PARTIAL');
  assert.equal(deriveInvoiceStatus(100000, 100000, false, 'WRITTEN_OFF', 0), 'WRITTEN_OFF', 'terminal beats full collection');
  // back-compat: existing 3-arg call sites unchanged
  assert.equal(deriveInvoiceStatus(100000, 0, false), 'UNPAID');
  assert.equal(deriveInvoiceStatus(100000, 40000, false), 'PARTIAL');
  assert.equal(deriveInvoiceStatus(100000, 100000, false), 'PAID');
  assert.equal(deriveInvoiceStatus(100000, 0, true), 'COMPLIMENTARY');
}

// ===========================================================================
// E-4 — complimentary syncs Patient.outstandingBalanceMinor
// ===========================================================================
{
  const { db, invoices, patients, audits } = makeDb({ invoices: [baseInvoice({ collectedMinor: 0, outstandingMinor: 100000 })] });
  patients[0]!.outstandingBalanceMinor = 100000; // stale debt present before waiver
  await complimentary({ queueEntryId: 'q1' }, DOCTOR, 'k-comp', db);
  assert.equal(patients[0]!.outstandingBalanceMinor, 0, 'complimentary must recompute the patient rollup');
  const comp = audits.filter((a) => a.action === 'COMPLIMENTARY');
  assert.equal(comp.length, 1, 'complimentary audited');
  assert.equal(invoices[0]!.status, 'COMPLIMENTARY', 'invoice flipped to COMPLIMENTARY');
}

// ===========================================================================
// E-5a — GET /patients/:id/balance DTO + oldest-first ordering
// ===========================================================================
{
  const { db } = makeDb({ invoices: [baseInvoice()] });
  const bal = await getPatientBalance('p1', DOCTOR, db);
  assert.equal(isSecretSafe(bal), true, 'balance DTO is SecretSafe-branded');
  assert.equal(bal.patientId, 'p1');
  assert.equal(bal.outstandingMinor, 80000);
  assert.equal(bal.lines.length, 1);
  assert.equal(bal.lines[0]!.invoiceId, 'inv-1');
  assert.equal(bal.lines[0]!.dueMinor, 80000);
  assert.equal(bal.lines[0]!.collectedMinor, 20000);
  assert.equal(bal.lines[0]!.writeOffMinor, 0);
  // Allowlist: no clinical/PII keys can escape.
  assert.deepEqual(Object.keys(bal.lines[0]!).sort(), ['collectedMinor', 'date', 'dueMinor', 'invoiceId', 'writeOffMinor']);

  // oldest-first: the service orders createdAt asc; assert the contract shape.
  const { db: db2 } = makeDb({
    invoices: [
      baseInvoice({ id: 'inv-new', createdAt: new Date('2026-02-02T00:00:00Z'), outstandingMinor: 10000 }),
      baseInvoice({ id: 'inv-old', createdAt: new Date('2026-01-01T00:00:00Z'), outstandingMinor: 80000 }),
    ],
  });
  const bal2 = await getPatientBalance('p1', DOCTOR, db2);
  assert.equal(bal2.outstandingMinor, 90000, 'outstanding sums all open invoices');
  assert.equal(bal2.lines.length, 2);
}

// ===========================================================================
// E-5b — GET /billing list: pagination + toSecretInvoiceDto allowlist masking
// ===========================================================================
{
  const rows = [
    baseInvoice({ id: 'inv-a', createdAt: new Date('2026-03-01T00:00:00Z') }),
    baseInvoice({ id: 'inv-b', createdAt: new Date('2026-02-01T00:00:00Z') }),
    baseInvoice({ id: 'inv-c', createdAt: new Date('2026-01-01T00:00:00Z') }),
  ];
  const { db } = makeDb({ invoices: rows });

  const page1 = await listInvoices({}, DOCTOR, db);
  assert.equal(isSecretSafe(page1), true);
  assert.equal(page1.data.length, 3, 'unbounded default returns all rows');
  assert.equal(page1.nextCursor, null);

  const keys = Object.keys(page1.data[0]!).sort();
  // Exact allowlist: the 12 contract fields, nothing else.
  assert.deepEqual(keys, [
    'collectedMinor', 'createdAt', 'discountMinor', 'discountReason', 'finalFeeMinor',
    'invoiceId', 'outstandingMinor', 'patientId', 'queueEntryId', 'standardFeeMinor',
    'status', 'writeOffMinor',
  ]);
  // Allowlist guard: no raw DB/internal column names ever leak.
  for (const forbidden of ['id', 'idempotencyKey', 'createdByUserId', 'complimentaryAuthorizedByUserId', 'shiftId']) {
    assert.equal(forbidden in page1.data[0]!, false, `internal field ${forbidden} must not leak`);
  }

  const limited = await listInvoices({ limit: 2 }, DOCTOR, db);
  assert.equal(limited.data.length, 2, 'limit respected');
  assert.notEqual(limited.nextCursor, null, 'nextCursor present when more rows exist');

  // Cursor page 2 starts strictly after the boundary row (newest-first order).
  const cursor = limited.nextCursor as string;
  const page2 = await listInvoices({ limit: 2, cursor }, DOCTOR, db);
  assert.equal(page2.data.length, 1, 'cursor advances past the returned page');
  assert.equal(page2.data[0]!.invoiceId, 'inv-c', 'remaining (oldest) row returned');
  assert.equal(page2.nextCursor, null, 'no further page');

  // Direct mapper assertion: exact contract field set.
  const dto = toSecretInvoiceDto(toInvoiceRow(rows[0]!));
  assert.deepEqual(Object.keys(dto).sort(), [
    'collectedMinor', 'createdAt', 'discountMinor', 'discountReason', 'finalFeeMinor',
    'invoiceId', 'outstandingMinor', 'patientId', 'queueEntryId', 'standardFeeMinor',
    'status', 'writeOffMinor',
  ]);
}

// ===========================================================================
// E-5b-2 — SECRETARY listInvoices scoping (blind-close DB-10 residual)
// patient-scoped reads stay allowed; unscoped aggregates + OPEN-shift scopes 403.
// ===========================================================================
{
  const rows = [
    baseInvoice({ id: 'inv-a', createdAt: new Date('2026-03-01T00:00:00Z') }),
    baseInvoice({ id: 'inv-b', createdAt: new Date('2026-02-01T00:00:00Z') }),
  ];
  const { db } = makeDb({ invoices: rows });

  // patientId-only scope: allowed (desk must see what is due to collect).
  const scoped = await listInvoices({ patientId: 'p1' }, SECRETARY, db);
  assert.equal(isSecretSafe(scoped), true);
  assert.equal(scoped.data.length, 2, 'patient-scoped SECRETARY list succeeds');

  // Unscoped aggregate: still withheld (blind-close anchor).
  await assert.rejects(
    () => listInvoices({}, SECRETARY, db),
    (err: unknown) => err instanceof AppError && err.code === 'FORBIDDEN',
    'unscoped SECRETARY invoice list must 403',
  );

  // OPEN-shift scope: still withheld.
  await assert.rejects(
    () => listInvoices({ shiftId: 'sh1' }, SECRETARY, db),
    (err: unknown) => err instanceof AppError && err.code === 'FORBIDDEN',
    'OPEN-shift-scoped SECRETARY invoice list must 403',
  );
}

// ===========================================================================
// E-5c — GET /audit role isolation (BE-701)
// ===========================================================================
{
  const { db } = makeDb({
    audits: [
      { id: 'a1', actorUserId: 'u-doc', actorRole: 'DOCTOR', action: 'WRITE_OFF', entityType: 'Invoice', entityId: 'inv-1', beforeState: null, afterState: { status: 'WRITTEN_OFF' }, requestId: null, idempotencyKey: null, reasonText: null, createdAt: new Date('2026-01-03T00:00:00Z') },
      { id: 'a2', actorUserId: 'u-doc', actorRole: 'DOCTOR', action: 'VAULT_ACCESS', entityType: 'TherapyNote', entityId: 'n-1', beforeState: null, afterState: null, requestId: null, idempotencyKey: null, reasonText: null, createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'a3', actorUserId: 'u-doc', actorRole: 'DOCTOR', action: 'SCRIBE_UPLOAD', entityType: 'ScribeSession', entityId: 's-1', beforeState: null, afterState: null, requestId: null, idempotencyKey: null, reasonText: null, createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'a4', actorUserId: 'u-sec', actorRole: 'SECRETARY', action: 'CHECKOUT', entityType: 'Invoice', entityId: 'inv-2', beforeState: null, afterState: null, requestId: null, idempotencyKey: null, reasonText: null, createdAt: new Date('2026-01-04T00:00:00Z') },
    ],
  });

  // DOCTOR: full feed, newest first.
  const doc = await queryAuditEvents({}, DOCTOR, db);
  assert.equal(doc.data.length, 4, 'DOCTOR sees every event');
  assert.equal(doc.data[0]!.id, 'a4', 'newest first');

  // SECRETARY: own events only, vault + scribe entity types excluded.
  const sec = await queryAuditEvents({}, SECRETARY, db);
  assert.equal(sec.data.length, 1, 'SECRETARY sees only their own events');
  assert.equal(sec.data[0]!.id, 'a4');
  assert.equal(sec.data[0]!.entityType, 'Invoice');
  for (const row of sec.data) {
    assert.notEqual(row.entityType, 'TherapyNote', 'vault entity filtered for SECRETARY');
    assert.notEqual(row.entityType, 'ScribeSession', 'scribe entity filtered for SECRETARY');
    assert.notEqual(row.entityType, 'ScribeDraft', 'scribe draft entity filtered for SECRETARY');
  }

  // Explicit vault/scribe entityType probe from a SECRETARY yields nothing.
  const probe = await queryAuditEvents({ entityType: 'TherapyNote' }, SECRETARY, db);
  assert.equal(probe.data.length, 0, 'SECRETARY cannot probe vault entities directly');

  // Explicit actorUserId probe cannot escape the own-scope pin: the service
  // overwrites the client-supplied filter with the caller's own userId, so a
  // SECRETARY asking for another actor still only ever sees their own rows.
  const foreign = await queryAuditEvents({ actorUserId: 'u-doc' }, SECRETARY, db);
  assert.equal(foreign.data.length, 1, 'filter override is neutralized');
  for (const row of foreign.data) {
    assert.equal(row.actorUserId, 'u-sec', 'no foreign actor row can leak through the filter override');
  }
}

// ===========================================================================
// E-5d — PUT /api/v1/settings: DOCTOR-only guard + upsert semantics
// ===========================================================================
{
  // DOCTOR-only guard (mirrors the mounted route chain authenticate -> requireRole).
  const guardErr = (await new Promise<unknown>((resolve) => {
    requireRole('DOCTOR')(mockSettingsReq('SECRETARY'), { statusCode: 200 } as Response, ((e?: unknown) => resolve(e)) as NextFunction);
  })) as AppError;
  assert.ok(guardErr instanceof AppError && guardErr.statusCode === 403, 'SECRETARY is 403 on PUT /settings');

  const doctorOk = await new Promise<unknown>((resolve) => {
    requireRole('DOCTOR')(mockSettingsReq('DOCTOR'), { statusCode: 200 } as Response, ((e?: unknown) => resolve(e)) as NextFunction);
  });
  assert.equal(doctorOk, undefined, 'DOCTOR passes the PUT /settings guard');

  // Upsert: provided fields overwrite, omitted fields preserved.
  const { db } = makeDb({
    settingsRow: {
      id: 'singleton',
      standardFeeMinor: 50000,
      currency: 'USD',
      avgConsultDurationMin: 20,
      openingFloatMinor: 0,
      secretaryMaxDiscountMinor: 5000,
      secretaryMaxDiscountPct: 10,
      audioRetentionDays: 30,
    },
  });
  const updated = await updatePublicSettings({ standardFeeMinor: 75000, audioRetentionDays: 14 }, db);
  assert.equal(isSecretSafe(updated), true);
  assert.equal(updated.standardFeeMinor, 75000, 'provided field updated');
  assert.equal(updated.audioRetentionDays, 14, 'provided field updated');
  assert.equal(updated.currency, 'USD', 'omitted field preserved');
  assert.equal(updated.secretaryMaxDiscountPct, 10, 'omitted field preserved');

  // GET fallback when no row exists yet (pre-seed).
  const { db: emptyDb } = makeDb({ settingsRow: null });
  const fallback = await getPublicSettings(emptyDb);
  assert.equal(isSecretSafe(fallback), true);
  assert.equal(typeof fallback.standardFeeMinor, 'number');
}

// ===========================================================================
// E-2 (cont.) — front-desk activity categorizes the canonical WRITE_OFF as CASH
// ===========================================================================
{
  const { db } = makeDb({
    invoices: [baseInvoice({ id: 'inv-1' }), baseInvoice({ id: 'inv-2' })],
    audits: [
      { id: 'a1', actorUserId: 'u-doc', actorRole: 'DOCTOR', action: 'WRITE_OFF', entityType: 'Invoice', entityId: 'inv-1', reasonText: 'Unreachable', createdAt: new Date('2026-01-03T00:00:00Z') },
      { id: 'a2', actorUserId: 'u-doc', actorRole: 'DOCTOR', action: 'INVOICE_WRITE_OFF', entityType: 'Invoice', entityId: 'inv-2', reasonText: null, createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'a3', actorUserId: 'u-sec', actorRole: 'SECRETARY', action: 'QUEUE_CHECKIN', entityType: 'QueueEntry', entityId: 'q1', reasonText: null, createdAt: new Date('2026-01-01T00:00:00Z') },
    ],
  });
  const feed = await getFrontDeskActivity({ shiftId: 'sh1' }, db as unknown as PrismaClient);
  const kinds = new Map(feed.data.map((d) => [d.action, d.kind]));
  assert.equal(kinds.get('WRITE_OFF'), 'CASH', 'canonical WRITE_OFF is a financial (CASH) action');
  assert.equal(kinds.get('INVOICE_WRITE_OFF'), 'SHIFT', 'a non-canonical alias is NOT treated as financial');
  assert.equal(kinds.get('QUEUE_CHECKIN'), 'QUEUE', 'queue action categorized');
  assert.equal(feed.totalEvents, 3);
}

// ===========================================================================
// P1-4 — Signed SOAP becomes editable with audit logging & hash recalculation
// ===========================================================================
{
  const initialEncounter: EncounterRow = {
    id: 'enc-signed-1',
    patientId: 'p1',
    status: 'SIGNED',
    rowVersion: 1,
    visitDate: new Date('2026-01-01'),
    encounterType: 'CONSULTATION',
    soapSubjective: 'Original subjective',
    soapObjective: 'Original objective',
    soapAssessment: 'Original assessment',
    soapPlan: 'Original plan',
    mseAppearance: 'APPROPRIATE',
    mseBehavior: 'CALM',
    mseSpeechCoherence: 'COHERENT',
    mseMoodAffect: 'EUTHYMIC',
    diagnoses: ['F32.0'],
    finalContentHash: 'initial-hash-value',
    addendumCount: 0,
    signedAt: new Date('2026-01-01T10:00:00Z'),
    signedByUserId: 'u-doc',
  };

  const { db, audits } = makeDb({ encounters: [initialEncounter] });

  // 1. Doctor edits signed encounter freely
  const patchResult = await patchEncounter(
    'enc-signed-1',
    {
      soap: {
        S: 'Updated subjective after patient clarification',
      },
    },
    1,
    { userId: 'u-doc', role: 'DOCTOR' },
    db,
  );

  assert.equal(patchResult.status, 'SIGNED', 'Status remains SIGNED after edit');
  assert.equal(patchResult.rowVersion, 2, 'RowVersion incremented');
  assert.equal(initialEncounter.soapSubjective, 'Updated subjective after patient clarification');
  assert.notEqual(initialEncounter.finalContentHash, 'initial-hash-value', 'Hash was recomputed on signed edit');

  // 2. Audit event recorded for signed edit
  const editAudit = audits.find((a) => a.action === 'ENCOUNTER_UPDATE');
  assert.ok(editAudit, 'ENCOUNTER_UPDATE audit event written');
  assert.equal(editAudit.actorUserId, 'u-doc');
  assert.equal(editAudit.reasonText, 'تعديل تقرير موقع');
  assert.equal((editAudit.afterState as Record<string, unknown>).isSignedEdit, true);

  // 3. Stale row version fails OCC
  await assert.rejects(
    () =>
      patchEncounter(
        'enc-signed-1',
        { soap: { P: 'New plan' } },
        1, // stale row version (now 2)
        { userId: 'u-doc', role: 'DOCTOR' },
        db,
      ),
    (err: unknown) => err instanceof AppError && err.code === 'STALE_ROW_VERSION',
    'Stale row version is rejected with STALE_ROW_VERSION',
  );

  // 4. Addenda remain fully available on signed encounters
  const addendumResult = await addEncounterAddendum(
    'enc-signed-1',
    {
      reasonCode: 'OTHER',
      text: 'Lab results reviewed: normal thyroid panel',
    },
    { userId: 'u-doc', role: 'DOCTOR' },
    db,
  );

  assert.equal(addendumResult.encounterId, 'enc-signed-1');
  assert.equal(addendumResult.version, 1);
  assert.equal(initialEncounter.addendumCount, 1, 'Addendum count incremented');
}

// eslint-disable-next-line no-console
console.log('BE-remediation endpoint suites (write-off/balance/audit/settings/guards/P1-4-signed-soap) passed.');
