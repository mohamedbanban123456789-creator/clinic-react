/* eslint-disable no-console */
/**
 * Disposable embedded-PostgreSQL harness for DB-backed verification tests.
 *
 * Lifecycle (fully isolated, nothing outside the temp dir is touched):
 *   1. Random free port + fresh cluster data dir under os.tmpdir().
 *   2. Cluster initialised with owner role `clinic_migrate` (superuser), DB `clinic`.
 *   3. Runtime role `clinic_app` created; full prisma migrate deploy (0001→latest);
 *      scripts/db/provision.sql applied as the owner.
 *   4. Caller runs real services/scenarios against `appUrl`/`ownerUrl`.
 *   5. `stop()` shuts the cluster down and DELETES the data dir (persistent:false).
 *
 * This harness never connects to a persistent/production database — the only
 * endpoint it knows is the embedded cluster it just booted on 127.0.0.1.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DisposableDb {
  /** Runtime-role connection string (clinic_app — the role the app uses). */
  readonly appUrl: string;
  /** Owner/migration connection string (clinic_migrate — seed/cleanup only). */
  readonly ownerUrl: string;
  /** Stop the cluster and delete its data directory. */
  readonly stop: () => Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address !== null && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('unexpected listen address')));
      }
    });
    srv.on('error', reject);
  });
}

function runPrismaCli(args: readonly string[], url: string): void {
  const prismaJs = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(prismaJs)) throw new Error('prisma CLI not found — run npm install first');
  execFileSync(process.execPath, [prismaJs, ...args], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

export async function startDisposableClinicDb(): Promise<DisposableDb> {
  const port = await findFreePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'clinic-disposable-pg-'));
  const migratePassword = `mig-${randomBytes(12).toString('hex')}`;
  const appPassword = `app-${randomBytes(12).toString('hex')}`;

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'clinic_migrate',
    password: migratePassword,
    authMethod: 'password',
    persistent: false,
    // Windows initdb would otherwise default the server encoding to WIN1252,
    // which cannot store the UTF-8 characters used by the existing migration
    // files. Production PostgreSQL is UTF-8; mirror that exactly.
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
  });
  await pg.initialise();
  await pg.start();
  // Name matches the scripts/db/e2e-reset.mjs disposable-database rule
  // (contains 'e2e') so any tooling that validates targets stays coherent.
  await pg.createDatabase('clinic_e2e');

  const ownerUrl = `postgresql://clinic_migrate:${migratePassword}@127.0.0.1:${port}/clinic_e2e`;
  const appUrl = `postgresql://clinic_app:${appPassword}@127.0.0.1:${port}/clinic_e2e`;

  // Runtime role (provision.sql expects it to exist; it holds no login defaults).
  const bootstrap = pg.getPgClient('clinic_e2e');
  await bootstrap.connect();
  await bootstrap.query(`CREATE ROLE clinic_app LOGIN PASSWORD '${appPassword}'`);
  await bootstrap.end();

  // Full migration chain (0001 → latest) as the schema owner, then provision.
  runPrismaCli(['migrate', 'deploy'], ownerUrl);
  runPrismaCli(['db', 'execute', '--file', path.join(backendRoot, 'scripts', 'db', 'provision.sql')], ownerUrl);

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await pg.stop(); // persistent:false → deletes the cluster files
    } catch {
      // Stop is best-effort; cleanup below still runs.
    }
    // Windows holds data-dir handles briefly after shutdown — retry the
    // removal and never fail the verification on a temp-dir cleanup error.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        return;
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw err;
        if (attempt === 4) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  };

  return { appUrl, ownerUrl, stop };
}
