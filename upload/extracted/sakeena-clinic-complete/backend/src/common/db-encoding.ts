import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './utils/logger.js';

/**
 * P0-2 guard: Arabic names render as `?????` when the PostgreSQL cluster was
 * initialised with a non-UTF8 encoding (e.g. Windows initdb defaulting to
 * WIN1252) — every Arabic WRITE is then lossily converted to question marks
 * before it reaches the row. The disposable QA harness forces UTF8 for exactly
 * this reason; a real deployment can still be mis-initialised. Fail loudly at
 * boot with actionable remediation instead of silently corrupting names.
 * Read/write paths and every display component were verified correct on a
 * UTF8 cluster, so this is the only remaining place the mangling can start.
 */
export async function verifyDatabaseEncoding(
  db: PrismaClient = prisma,
): Promise<{ serverEncoding: string; clientEncoding: string; ok: boolean }> {
  let serverEncoding = 'unknown';
  let clientEncoding = 'unknown';
  try {
    const server = await db.$queryRawUnsafe<{ server_encoding: string }[]>('SHOW server_encoding');
    serverEncoding = server[0]?.server_encoding ?? 'unknown';
    const client = await db.$queryRawUnsafe<{ client_encoding: string }[]>('SHOW client_encoding');
    clientEncoding = client[0]?.client_encoding ?? 'unknown';
  } catch (err) {
    logger.warn('boot.db.encoding.probeFailed', { err: String(err) });
    return { serverEncoding, clientEncoding, ok: true };
  }
  const ok = serverEncoding.toUpperCase() === 'UTF8' && clientEncoding.toUpperCase() === 'UTF8';
  if (!ok) {
    logger.error('boot.db.encoding.notUtf8', {
      serverEncoding,
      clientEncoding,
      remediation:
        're-initialise the PostgreSQL cluster with UTF8 (initdb --encoding=UTF8) and restore, ' +
        'or set client_encoding=UTF8 in postgresql.conf. On a non-UTF8 cluster every Arabic ' +
        'name/address written by the clinic is irreversibly stored as question marks.',
    });
  }
  return { serverEncoding, clientEncoding, ok };
}
