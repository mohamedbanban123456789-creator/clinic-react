import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { AppError } from './common/errors/AppError.js';
import { errorHandler } from './common/middleware/errorHandler.js';
import { sanitizeSecretaryResponses } from './common/middleware/sanitize.js';
import { authenticate, requireFreshPassword } from './common/middleware/authenticate.js';
import { authRouter } from './modules/auth-users/auth.routes.js';
import { usersRouter } from './modules/auth-users/users.routes.js';
import { settingsRouter } from './modules/clinic-settings/settings.routes.js';
import { patientRouter } from './modules/identity-queue/patient.routes.js';
import { queueRouter } from './modules/identity-queue/queue.routes.js';
import { billingRouter, receiptsRouter, patientSettleRouter } from './modules/cashier-shift/billing.routes.js';
import { shiftsRouter } from './modules/cashier-shift/shift.routes.js';
import { supervisionRouter } from './modules/supervision/supervision.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { intercomRouter, followupsRouter } from './modules/intercom-realtime/intercom.routes.js';
import { encounterRouter } from './modules/clinical-ehr/encounter.routes.js';
import { medicationRouter } from './modules/clinical-ehr/medication.routes.js';
import { vaultRouter } from './modules/clinical-ehr/vault/vault.routes.js';
import { scribeRouter } from './modules/ai-scribe/scribe.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';

export interface AppOptions {
  corsOrigin: string;
}

export function createApp(options: AppOptions): Express {
  const app: Express = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: options.corsOrigin,
      credentials: true,
    }),
  );
  // Body size: 2mb globally (JSON APIs only); the scribe routes opt into 15mb
  // for base64 audio uploads (per-route validators re-check the exact cap).
  const jsonDefault = express.json({ limit: '2mb' });
  const jsonScribe = express.json({ limit: '15mb' });
  app.use((req, res, next): void => {
    if (req.path.startsWith('/api/v1/scribe')) {
      jsonScribe(req, res, next);
      return;
    }
    jsonDefault(req, res, next);
  });
  app.use(cookieParser());
  app.use(sanitizeSecretaryResponses);

  app.use('/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', authenticate, requireFreshPassword, settingsRouter);
  app.use('/api/v1/patients', patientRouter);
  app.use('/api/v1/queue', queueRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1/receipts', receiptsRouter);
  app.use('/api/v1/shifts', shiftsRouter);
  app.use('/api/v1/supervision', supervisionRouter);
  // BE-701 audit query: DOCTOR full feed; SECRETARY own operational scope.
  app.use('/api/v1/audit', auditRouter);
  // BE-402 intercom + follow-up REST fallbacks.
  app.use('/api/v1/intercom', intercomRouter);
  app.use('/api/v1/followups', followupsRouter);
  // Mounted after patientRouter so /patients/:id/settle does not shadow identity routes.
  app.use('/api/v1/patients', patientSettleRouter);
  // BE-501/502 clinical EHR (DOCTOR-only, role-first inside each router).
  app.use('/api/v1/ehr', encounterRouter);
  app.use('/api/v1/ehr', medicationRouter);
  // BE-503 segregated vault router (DOCTOR-only, ciphertext-only at rest).
  app.use('/api/v1/ehr/vault', vaultRouter);
  // Sprint 6 AI scribe 2-cycle foundation (DOCTOR-only, role-first in router).
  app.use('/api/v1/scribe', scribeRouter);

  app.use((_req, _res, next): void => {
    next(AppError.notFound('Route not found'));
  });
  app.use(errorHandler);
  return app;
}
