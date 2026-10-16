/* eslint-disable no-console */
/**
 * R8/R10 verification driver: boots a DISPOSABLE embedded PostgreSQL cluster,
 * applies migrations + provision.sql, then runs scripts/db/verify-runtime-role.mjs
 * TWICE against the runtime role — proving (a) the constraint-specific probes
 * pass, (b) the verifier is repeatable (run 2 must also exit 0 on the same
 * cluster), and (c) the DDL-deny guarantee holds with the R10 explicit REVOKE.
 *
 *   npx tsx tests/db/run-verifier-twice.ts
 */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDisposableClinicDb } from './disposable-db.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifier = path.join(backendRoot, 'scripts', 'db', 'verify-runtime-role.mjs');

const dbh = await startDisposableClinicDb();
try {
  for (const run of [1, 2]) {
    console.log(`— verifier run ${run} —`);
    execFileSync(process.execPath, [verifier], {
      env: { ...process.env, DATABASE_URL: dbh.appUrl },
      stdio: 'inherit',
    });
  }
  console.log('\nVerifier twice-run green on disposable PostgreSQL (repeatability + DDL deny proven).');
  assert.ok(true);
} finally {
  await dbh.stop();
}
