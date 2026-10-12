/* eslint-disable no-console */
// Runtime-role permission verification (DB-05 / Appendix A / F-7).
//
// Proves the REVOKE + base grants are EFFECTIVE FOR THE REAL APPLICATION ROLE
// (clinic_app) — not merely present in a doc. Run AFTER provisioning:
//
//   DATABASE_URL="postgresql://clinic_app:<pw>@<host>:<port>/<db>" \
//     node scripts/db/verify-runtime-role.mjs
//
// Expected: every "must fail" probe throws P0003/42501, every "must succeed"
// probe returns, and every unique probe fails SPECIFICALLY on its intended
// constraint (R8: a fixture-collision 23505 must never be mistaken for proof).
// Exit 0 = all guarantees hold.
import pkg from '@prisma/client/index.js';
const { PrismaClient } = pkg;

const db = new PrismaClient();
let failures = 0;

async function expectDeny(label, fn) {
  try {
    await fn();
    console.error(`DENY-FAILED ${label}: operation unexpectedly succeeded`);
    failures += 1;
  } catch (err) {
    const code = err?.code ?? err?.meta?.code ?? String(err).slice(0, 60);
    if (code === 'P0003' || String(err).includes('permission denied') || String(err).includes('42501')) {
      console.log(`deny-ok      ${label} (${code})`);
    } else {
      console.error(`deny-odd     ${label}: unexpected error ${code}`);
      failures += 1;
    }
  }
}

async function expectOk(label, fn) {
  try {
    await fn();
    console.log(`allow-ok     ${label}`);
  } catch (err) {
    console.error(`allow-FAILED ${label}: ${err?.code ?? ''} ${String(err).slice(0, 140)}`);
    failures += 1;
  }
}

/** Fixture creation step — ANY failure here is a verification failure, never a pass. */
function errorDetail(err) {
  // Prisma wraps raw-query failures as P2010 with the PG detail in `meta` —
  // String(err) alone misses the constraint name and error code.
  return `${String(err)} ${JSON.stringify(err?.meta ?? {})}`;
}

async function fixture(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`fixture-FAILED ${label}: ${err?.code ?? ''} ${errorDetail(err).slice(0, 220)}`);
    failures += 1;
    throw err;
  }
}

/** Fixture pre-assertion: the intended unique INDEX must exist by name. */
async function fixtureIndex(indexName) {
  const rows = await fixture(`index ${indexName} present`, () =>
    db.$queryRawUnsafe(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, indexName),
  );
  if (rows.length !== 1) throw new Error(`required unique index ${indexName} is missing — provisioning incomplete`);
}

/**
 * Expects `fn` to fail with 23505 whose DETAIL matches `expectedKeyDetail`
 * (R8). Prisma surfaces unique-INDEX violations WITHOUT the constraint name —
 * only the DETAIL key (e.g. `Key (status)=(OPEN) already exists.`) — so the
 * probe asserts (a) the intended index exists by name beforehand, and (b) the
 * failure's key matches that index's expression. Any other 23505 (fixture
 * collision) or non-unique failure is a verification failure, never a pass.
 */
async function expectUniqueViolationDetail(label, fn, indexName, expectedKeyDetail) {
  await fixtureIndex(indexName);
  try {
    await fn();
    console.error(`unique-FAILED ${label}: operation unexpectedly succeeded`);
    failures += 1;
  } catch (err) {
    const detail = errorDetail(err);
    if (detail.includes('23505') && detail.includes(expectedKeyDetail)) {
      console.log(`unique-ok    ${label} (23505: ${expectedKeyDetail})`);
    } else if (detail.includes('23505')) {
      console.error(`unique-ODD   ${label}: 23505 fired on an UNRELATED key (expected ${expectedKeyDetail}): ${detail.slice(0, 220)}`);
      failures += 1;
    } else {
      console.error(`unique-odd   ${label}: unexpected error ${err?.code ?? ''} ${detail.slice(0, 200)}`);
      failures += 1;
    }
  }
}

/** First free business date at/after `startIso` (collision-safe fixture dates). */
async function findFreeBusinessDate(startIso) {
  const start = new Date(startIso);
  for (let offset = 0; offset < 400; offset += 1) {
    const day = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const clash = await db.$queryRawUnsafe(`SELECT 1 FROM shifts WHERE business_date = $1::date LIMIT 1`, day);
    if (clash.length === 0) return day;
  }
  throw new Error('no free probe business date found');
}

// Probe user (patients/shifts FKs) — recreate deterministically each run.
await db.$executeRawUnsafe(`DELETE FROM users WHERE id = 'probe-user' OR identifier = 'probe-user-ident'`).catch(() => undefined);
await db.$executeRawUnsafe(
  `INSERT INTO users (id, name, identifier, password_hash, role, is_active, token_version, password_must_change, created_at, updated_at)
   VALUES ('probe-user', 'Probe User', 'probe-user-ident', 'x', 'DOCTOR', true, 0, false, now(), now())`,
);

// --- Baseline runtime access (must all succeed) ---
await expectOk('SELECT patients', () => db.$queryRawUnsafe('SELECT id FROM patients LIMIT 1'));
await expectOk('INSERT patient', async () => {
  await db.$executeRawUnsafe(
    `INSERT INTO patients (id, full_name, full_name_norm, date_of_birth, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, physical_address, created_at, created_by_user_id)
     VALUES ('probe-patient-1', 'Probe Patient', 'probe patient', '1990-01-01', 'Kin', '000', 'SELF', 'n/a', now(), 'probe-user')
     ON CONFLICT (id) DO NOTHING`,
  );
});
await expectOk('UPDATE patient', () =>
  db.$executeRawUnsafe(`UPDATE patients SET physical_address = 'n/a' WHERE id = 'probe-patient-1'`),
);
await expectOk('DELETE probe patient', () => db.$executeRawUnsafe(`DELETE FROM patients WHERE id = 'probe-patient-1'`));

// --- DDL must be denied (app role never holds DDL after provisioning; R10
//     makes this version-independent by revoking PUBLIC CREATE explicitly) ---
await expectDeny('CREATE TABLE as clinic_app', () =>
  db.$executeRawUnsafe('CREATE TABLE probe_ddl_should_fail (id int)'),
);

// --- DB-05 immutability: receipts + audit_events are append-only ---
await expectDeny('UPDATE receipts', () => db.$executeRawUnsafe('UPDATE receipts SET amount_minor = 0 WHERE false'));
await expectDeny('DELETE receipts', () => db.$executeRawUnsafe('DELETE FROM receipts WHERE false'));
await expectDeny('UPDATE audit_events', () => db.$executeRawUnsafe(`UPDATE audit_events SET action = 'LOGIN' WHERE false`));
await expectDeny('DELETE audit_events', () => db.$executeRawUnsafe('DELETE FROM audit_events WHERE false'));

// --- Frozen partial uniques (canon.sql / migration 0010) are the race authority ---
// R8 probes: collision-safe fixture dates, fixture steps that must SUCCEED,
// and constraint-specific violation assertions.

// One OPEN shift clinic-wide (uq_shifts_single_open, migration 0010).
{
  const dateA = await findFreeBusinessDate('2099-01-01');
  const dateB = await findFreeBusinessDate('2099-01-02');
  await db.$executeRawUnsafe(`DELETE FROM shifts WHERE id IN ('probe-shift-a', 'probe-shift-b')`).catch(() => undefined);
  try {
    // Fixture: the FIRST valid OPEN shift must actually be created.
    const inserted = await fixture('probe shift A insert', () =>
      db.$executeRawUnsafe(
        `INSERT INTO shifts (id, business_date, status, opening_float_minor, queue_version, opened_by_user_id)
         VALUES ('probe-shift-a', $1::date, 'OPEN', 0, 0, 'probe-user')`,
        dateA,
      ),
    );
    if (inserted !== 1) throw new Error(`probe shift A reported rowcount ${inserted}`);
    // Shift B uses a DIFFERENT free business date, so the ONLY constraint that
    // can fire is the single-OPEN invariant — never the business_date unique.
    // Shift B uses a DIFFERENT free business date, so the ONLY constraint that
    // can fire is the single-OPEN invariant — never the business_date unique.
    await expectUniqueViolationDetail(
      'second OPEN shift (uq_shifts_single_open)',
      () =>
        db.$executeRawUnsafe(
          `INSERT INTO shifts (id, business_date, status, opening_float_minor, queue_version, opened_by_user_id)
           VALUES ('probe-shift-b', $1::date, 'OPEN', 0, 0, 'probe-user')`,
          dateB,
        ),
      'uq_shifts_single_open',
      'Key (status)=(OPEN) already exists',
    );
  } finally {
    await db.$executeRawUnsafe(`DELETE FROM shifts WHERE id IN ('probe-shift-a', 'probe-shift-b')`).catch(() => undefined);
  }
}

// One IN_CONSULTATION per shift (uq_queue_single_consult) — self-contained shift.
{
  const date = await findFreeBusinessDate('2099-01-03');
  await db.$executeRawUnsafe(`DELETE FROM queue_entries WHERE shift_id = 'probe-shift-consult'`).catch(() => undefined);
  await db.$executeRawUnsafe(`DELETE FROM shifts WHERE id = 'probe-shift-consult'`).catch(() => undefined);
  await db.$executeRawUnsafe(`DELETE FROM patients WHERE id IN ('probe-p-a', 'probe-p-b')`).catch(() => undefined);
  try {
    await fixture('consult probe shift', () =>
      db.$executeRawUnsafe(
        `INSERT INTO shifts (id, business_date, status, opening_float_minor, queue_version, opened_by_user_id)
         VALUES ('probe-shift-consult', $1::date, 'OPEN', 0, 0, 'probe-user')`,
        date,
      ),
    );
    for (const pid of ['probe-p-a', 'probe-p-b']) {
      await fixture(`consult probe patient ${pid}`, () =>
        db.$executeRawUnsafe(
          `INSERT INTO patients (id, full_name, full_name_norm, date_of_birth, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, physical_address, created_at, created_by_user_id)
           VALUES ('${pid}', 'Probe ${pid}', 'probe ${pid}', '1990-01-01', 'Kin', '000', 'SELF', 'n/a', now(), 'probe-user')`,
        ),
      );
    }
    // Fixture: the FIRST IN_CONSULTATION entry must actually be created.
    const first = await fixture('consult probe entry A', () =>
      db.$executeRawUnsafe(
        `INSERT INTO queue_entries (id, patient_id, shift_id, status, position, is_emergency, checked_in_at, reorder_count, idempotency_key)
         VALUES ('probe-entry-a', 'probe-p-a', 'probe-shift-consult', 'IN_CONSULTATION', 1, false, now(), 0, 'probe-entry-a-key')`,
      ),
    );
    if (first !== 1) throw new Error(`probe entry A reported rowcount ${first}`);
    await expectUniqueViolationDetail(
      'second IN_CONSULTATION in one shift (uq_queue_single_consult)',
      () =>
        db.$executeRawUnsafe(
          `INSERT INTO queue_entries (id, patient_id, shift_id, status, position, is_emergency, checked_in_at, reorder_count, idempotency_key)
           VALUES ('probe-entry-b', 'probe-p-b', 'probe-shift-consult', 'IN_CONSULTATION', 2, false, now(), 0, 'probe-entry-b-key')`,
        ),
      'uq_queue_single_consult',
      'Key (shift_id)=(probe-shift-consult) already exists',
    );
  } finally {
    await db.$executeRawUnsafe(`DELETE FROM queue_entries WHERE shift_id = 'probe-shift-consult'`).catch(() => undefined);
    await db.$executeRawUnsafe(`DELETE FROM shifts WHERE id = 'probe-shift-consult'`).catch(() => undefined);
    await db.$executeRawUnsafe(`DELETE FROM patients WHERE id IN ('probe-p-a', 'probe-p-b')`).catch(() => undefined);
  }
}

// --- Cleanup probe rows (base grants allow DELETE for the app role; audit/
//     receipts immutability is untouched — nothing append-only is written). ---
await db.$executeRawUnsafe(`DELETE FROM queue_entries WHERE shift_id LIKE 'probe-shift-%'`).catch(() => undefined);
await db.$executeRawUnsafe(`DELETE FROM shifts WHERE id LIKE 'probe-shift-%'`).catch(() => undefined);
await db.$executeRawUnsafe(`DELETE FROM patients WHERE id LIKE 'probe-p-%'`).catch(() => undefined);
await db.$executeRawUnsafe(`DELETE FROM patients WHERE id = 'probe-patient-1'`).catch(() => undefined);
await db.$executeRawUnsafe(`DELETE FROM users WHERE id = 'probe-user'`).catch(() => undefined);
await db.$disconnect();

if (failures > 0) {
  console.error(`\n${failures} probe(s) FAILED — runtime-role guarantees NOT verified.`);
  process.exit(1);
}
console.log('\nRuntime-role verification green: base grants + REVOKE + constraint-specific frozen uniques all effective for clinic_app.');
