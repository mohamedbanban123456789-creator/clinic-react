import assert from 'node:assert/strict';
import {
  auditStateHasClinicalKey,
  writeAudit,
  type WriteAuditInput,
} from '../src/common/audit.js';

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the Prisma tx so the test needs no database.
// `auditEvent.create` records the payload; a duplicate requestId simulates the
// unique-index P2002 (DB-19 idempotent replay) when `failOnDuplicate` is set.
// ---------------------------------------------------------------------------
interface Recorded {
  readonly data: Record<string, unknown>;
}

function makeFakeTx(options: { failOnDuplicate?: boolean } = {}): {
  tx: Parameters<typeof writeAudit>[0];
  rows: Recorded[];
} {
  const rows: Recorded[] = [];
  const seen = new Set<string>();
  const tx = {
    auditEvent: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (args: { data: Record<string, unknown> }): Promise<Recorded> => {
        const requestId = args.data.requestId;
        if (options.failOnDuplicate === true && typeof requestId === 'string') {
          if (seen.has(requestId)) {
            const err = new Error('Unique constraint failed') as Error & { code?: string };
            err.code = 'P2002';
            throw err;
          }
          seen.add(requestId);
        }
        const row: Recorded = { data: args.data };
        rows.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { tx, rows };
}

const base: WriteAuditInput = {
  actorUserId: 'u1',
  actorRole: 'DOCTOR',
  action: 'INTERCOM_SEND',
  entityType: 'IntercomMessage',
  entityId: 'm1',
};

// ---------------------------------------------------------------------------
// BE-701 gate: writeAudit logs operational events with a requestId.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
{
  const { tx, rows } = makeFakeTx();
  await writeAudit(tx, { ...base, afterState: { type: 'DOCTOR_NEXT', relatedQueueEntryId: 'e1' } });
  assert.equal(rows.length, 1, 'exactly one audit event written');
  const data = rows[0]!.data;
  assert.equal(data.actorUserId, 'u1');
  assert.equal(data.actorRole, 'DOCTOR');
  assert.equal(data.action, 'INTERCOM_SEND');
  assert.equal(data.entityType, 'IntercomMessage');
  assert.equal(data.entityId, 'm1');
  assert.equal(typeof data.requestId, 'string', 'requestId generated when omitted');
  assert.deepEqual(data.afterState, { type: 'DOCTOR_NEXT', relatedQueueEntryId: 'e1' });
}

// ---------------------------------------------------------------------------
// BE-701: an explicit requestId is honored (matching-requestId dedup contract).
// ---------------------------------------------------------------------------
{
  const { tx, rows } = makeFakeTx();
  const requestId = 'req-123';
  await writeAudit(tx, { ...base, requestId, reasonText: 'sensitive', idempotencyKey: 'k1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.data.requestId, requestId);
  assert.equal(rows[0]!.data.reasonText, 'sensitive');
  assert.equal(rows[0]!.data.idempotencyKey, 'k1');
}

// ---------------------------------------------------------------------------
// BE-701 DB-19: a replayed requestId hits the unique index (P2002) and is
// swallowed — the original event stands, no duplicate row, no throw.
// ---------------------------------------------------------------------------
{
  const { tx, rows } = makeFakeTx({ failOnDuplicate: true });
  await writeAudit(tx, { ...base, requestId: 'dup-1' });
  await writeAudit(tx, { ...base, requestId: 'dup-1' }); // idempotent replay
  assert.equal(rows.length, 1, 'duplicate requestId does not create a second row');
}

// ---------------------------------------------------------------------------
// BE-701: audit state is operational-only — the clinical-key guard flags any
// accidental structured clinical content (defense in depth; snapshots stay clean).
// ---------------------------------------------------------------------------
{
  assert.equal(auditStateHasClinicalKey({ type: 'DOCTOR_NEXT', hasText: true }), false);
  assert.equal(auditStateHasClinicalKey({ soapPlan: 'x' }), true);
  assert.equal(auditStateHasClinicalKey({ transcript: 'x' }), true);
  assert.equal(auditStateHasClinicalKey({ diagnoses: [] }), true);
  assert.equal(auditStateHasClinicalKey(null), false);
  assert.equal(auditStateHasClinicalKey('str'), false);
}

  // eslint-disable-next-line no-console
  console.log('BE-701 writeAudit operational-only + requestId dedup tests passed.');
}

void main();
