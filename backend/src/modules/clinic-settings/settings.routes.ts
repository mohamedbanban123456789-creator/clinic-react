import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, requireAuth } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { getPublicSettings, updatePublicSettings } from './settings.service.js';
import { updateSettingsSchema, type UpdateSettingsInput } from './settings.validators.js';

export const settingsRouter: Router = Router();

// GET /api/v1/settings [BOTH] — SecretSafe public configuration.
settingsRouter.get('/', authenticate, (_req: Request, res: Response, next: NextFunction): void => {
  getPublicSettings()
    .then((settings) => {
      res.status(200).json(settings);
    })
    .catch(next);
});

// PUT /api/v1/settings [DOCTOR] — upsert the singleton ClinicSettings row.
settingsRouter.put(
  '/',
  requireRole('DOCTOR'),
  validate(updateSettingsSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req);
    updatePublicSettings(req.body as UpdateSettingsInput)
      .then((settings) => res.status(200).json(settings))
      .catch(next);
  },
);
