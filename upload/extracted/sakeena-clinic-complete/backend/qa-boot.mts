/* eslint-disable no-console */
/**
 * QA harness: boots a fully disposable backend for real-browser testing.
 *  1. Starts embedded PostgreSQL on a random port (temp data dir, deleted on stop).
 *  2. Runs the full Prisma migration chain + provision.sql as the owner.
 *  3. Points DATABASE_URL at the disposable runtime role and boots src/server.ts.
 * Never touches any persistent/production database.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { startDisposableClinicDb } from './tests/db/disposable-db.js';

const infoPath = process.env.QA_INFO_PATH ?? 'd:\\Clinic Glm Last\\clinic-qa-info.json';

console.log('[qa-boot] starting disposable postgres…');
const db = await startDisposableClinicDb();
console.log('[qa-boot] disposable postgres ready');

process.env.DATABASE_URL = db.appUrl;
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.SOCKET_CORS_ORIGIN = 'http://localhost:3000';
process.env.PORT = '4000';
process.env.NODE_ENV = 'development';
process.env.VAULT_KEK = randomBytes(32).toString('base64');
process.env.VAULT_KEK_ID = 'v1';

writeFileSync(infoPath, JSON.stringify({ appUrl: db.appUrl, ownerUrl: db.ownerUrl, port: 4000 }, null, 2));
console.log(`[qa-boot] connection info written (contains throwaway credentials, temp-only)`);

const stopTogether = async (): Promise<void> => {
  try {
    await db.stop();
  } catch {
    /* best-effort */
  }
};
process.on('SIGTERM', () => void stopTogether().finally(() => process.exit(0)));
process.on('SIGINT', () => void stopTogether().finally(() => process.exit(0)));

console.log('[qa-boot] booting backend server…');
await import('./src/server.js');
console.log('[qa-boot] server module loaded');
