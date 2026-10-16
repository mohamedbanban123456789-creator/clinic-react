import { createServer } from 'node:http';
import { createApp } from './app.js';
import { prisma } from './common/prisma.js';
import { verifyDatabaseEncoding } from './common/db-encoding.js';
import { purgeExpiredScribeAudio } from './modules/ai-scribe/scribe.service.js';
import { setLogLevel, logger } from './common/utils/logger.js';
import { loadEnv } from './config/env.js';
import { ensureSeededClinicSettings, ensureSeededDoctor } from './config/seed.js';
import { createWsGateway } from './ws-gateway.js';

/** BE-604: daily retention sweep cadence for expired scribe audio. */
const AUDIO_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function boot(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  // P0-2: fail loudly on non-UTF8 clusters (Arabic would corrupt to ?????)
  // before any write happens. Never blocks boot on probe failure.
  await verifyDatabaseEncoding();
  // BE-104: idempotent primary-doctor bootstrap before accepting traffic.
  await ensureSeededDoctor();
  // Startup ClinicSettings seed from env defaults (never overwrites an existing row).
  await ensureSeededClinicSettings();
  const app = createApp({ corsOrigin: env.CORS_ORIGIN });

  // BE-401: wrap the Express app in an HTTP server so Socket.io can share the port.
  const httpServer = createServer(app);
  const ws = createWsGateway(httpServer, { corsOrigin: env.CORS_ORIGIN });

  httpServer.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`clinic-backend listening on :${env.PORT} (${env.NODE_ENV})`);
    // BE-604 retention worker: best-effort initial sweep + daily cadence.
    void purgeExpiredScribeAudio().catch((err: unknown) => logger.warn('scribe.purge.initialFailed', { err: String(err) }));
    setInterval(() => {
      void purgeExpiredScribeAudio().catch((err: unknown) => logger.warn('scribe.purge.sweepFailed', { err: String(err) }));
    }, AUDIO_PURGE_INTERVAL_MS).unref();
  });

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`received ${signal}, shutting down`);
    ws.close();
    httpServer.close(() => {
      prisma
        .$disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

boot().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('clinic-backend failed to boot', err);
  prisma
    .$disconnect()
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
});
