// One-shot E2E reset (owner role): remove concurrency-probe leftovers so the
// server seed can bootstrap a fresh doctor. Audit rows are deleted BY THE OWNER
// (the REVOKE only binds the runtime role).
//
// R9 (post-review remediation) — FAIL-CLOSED GUARD: this script deletes data
// INCLUDING the singleton clinic-settings row, so it refuses to run unless
//   1. CLINIC_E2E_RESET_CONFIRM=I-UNDERSTAND-THIS-DELETES-DATA  (explicit opt-in), AND
//   2. the target database name matches the documented disposable-test rule
//      (contains 'e2e' or 'disposable' or 'test'; case-insensitive), AND
//   3. a CLEANUP_URL is present.
// Connection secrets are NEVER printed — output shows a redacted URL only.
// Keep disposable DB names aligned with tests/db/disposable-db.ts naming and
// DATABASE_SCHEMA_SPEC.md §16. Plain JS (run directly with `node`); types live
// in e2e-reset.d.mts.
import { pathToFileURL } from 'node:url';

export const RESET_CONFIRM_ENV = 'CLINIC_E2E_RESET_CONFIRM';
export const RESET_CONFIRM_VALUE = 'I-UNDERSTAND-THIS-DELETES-DATA';

/** True when the database name looks like an isolated disposable test database. */
export function isDisposableDbName(dbName) {
  if (typeof dbName !== 'string' || dbName.length === 0) return false;
  return /e2e|disposable|test/i.test(dbName);
}

/** Redacted URL safe for output (never contains credentials). */
export function redactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const port = u.port === '' ? '' : `:${u.port}`;
    return `${u.protocol}//${u.hostname}${port}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '<unparseable-url>';
  }
}

/**
 * Throws when the reset must NOT run. `rawUrl` is the CLEANUP_URL, `confirm`
 * the value of the confirmation env var (undefined when unset).
 */
export function assertResetAllowed(rawUrl, confirm) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('e2e-reset: CLEANUP_URL is required (owner-role connection string).');
  }
  if (confirm !== RESET_CONFIRM_VALUE) {
    throw new Error(
      `e2e-reset: explicit opt-in required — set ${RESET_CONFIRM_ENV}=${RESET_CONFIRM_VALUE}. This script DELETES data (including the singleton clinic settings row).`,
    );
  }
  let dbName;
  try {
    dbName = decodeURIComponent(new URL(rawUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('e2e-reset: CLEANUP_URL is not a parseable postgres URL.');
  }
  if (!isDisposableDbName(dbName)) {
    throw new Error(
      `e2e-reset: target database "${redactUrl(rawUrl)}" does not match the disposable-test naming rule (name must contain e2e/disposable/test). Refusing to run against a persistent database.`,
    );
  }
}

async function reset() {
  const rawUrl = process.env['CLEANUP_URL'] ?? '';
  assertResetAllowed(rawUrl, process.env[RESET_CONFIRM_ENV]);
  console.log(`e2e-reset: guarded target ${redactUrl(rawUrl)} — proceeding.`);
  const { default: pkg } = await import('@prisma/client/index.js');
  const { PrismaClient } = pkg;
  const owner = new PrismaClient({ datasources: { db: { url: rawUrl } } });
  await owner.auditEvent.deleteMany({ where: { OR: [{ entityId: { startsWith: 'cc-' } }, { actorUserId: 'cc-doctor' }] } });
  await owner.receipt.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.invoice.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.queueEntry.deleteMany({ where: { shiftId: 'cc-shift' } });
  await owner.shift.deleteMany({ where: { id: 'cc-shift' } });
  await owner.patient.deleteMany({ where: { id: { startsWith: 'cc-patient-' } } });
  await owner.clinicSettings.deleteMany({ where: { id: 'singleton' } });
  await owner.user.deleteMany({ where: { id: 'cc-doctor' } });
  console.log('e2e reset done');
  await owner.$disconnect();
}

// Run only when executed directly (`node scripts/db/e2e-reset.mjs`); importing
// the module (e.g. from the guard tests) must have no side effects.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await reset().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
