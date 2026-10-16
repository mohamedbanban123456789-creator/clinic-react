import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  addEncounterAddendum,
  createEncounter,
  discardEncounter,
  getChart,
  getEncounter,
  patchEncounter,
  runAiDiagnosisForEncounter,
  signEncounter,
} from './encounter.service.js';
import {
  addendumSchema,
  chartQuerySchema,
  createEncounterSchema,
  encounterIdParamSchema,
  patchEncounterSchema,
  patientIdParamSchema,
  signEncounterSchema,
  type AddendumInput,
  type ChartQuery,
  type CreateEncounterInput,
  type PatchEncounterInput,
  type SignEncounterInput,
} from './encounter.validators.js';

/**
 * BE-501 routes — all DOCTOR-only, role-first (zero-knowledge: generic 403,
 * no existence oracle). Mounted under /api/v1/ehr.
 */
export const encounterRouter: Router = Router();

encounterRouter.use(authenticate, requireFreshPassword);

function readIfMatch(req: Request): number {
  const raw = req.header('If-Match');
  if (raw === undefined || raw.trim().length === 0) {
    throw new AppError('PRECONDITION_REQUIRED', 'If-Match header with the current rowVersion is required');
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError('PRECONDITION_REQUIRED', 'If-Match header must be a positive integer rowVersion');
  }
  return n;
}

// POST /api/v1/ehr/encounters [DOCTOR] -> 201 { encounterId, status, rowVersion }
encounterRouter.post(
  '/encounters',
  requireRole('DOCTOR'),
  validate(createEncounterSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    createEncounter(req.body as CreateEncounterInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);

// GET /api/v1/ehr/patients/:id/chart?limit&cursor [DOCTOR]
// Registered before /encounters/:id so "patients" is not captured as an id.
encounterRouter.get(
  '/patients/:id/chart',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(chartQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getChart(params.id, req.query as ChartQuery, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// GET /api/v1/ehr/encounters/:id [DOCTOR] -> 200 full
encounterRouter.get(
  '/encounters/:id',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getEncounter(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// PATCH /api/v1/ehr/encounters/:id [DOCTOR] — requires If-Match (428 / 409)
encounterRouter.patch(
  '/encounters/:id',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  validate(patchEncounterSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    let ifMatch: number;
    try {
      ifMatch = readIfMatch(req);
    } catch (err) {
      next(err);
      return;
    }
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    patchEncounter(params.id, req.body as PatchEncounterInput, ifMatch, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/encounters/:id/sign [DOCTOR] -> 200 SIGNED
encounterRouter.post(
  '/encounters/:id/sign',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  validate(signEncounterSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    signEncounter(params.id, req.body as SignEncounterInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/encounters/:id/discard [DOCTOR] — DRAFT only
encounterRouter.post(
  '/encounters/:id/discard',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    discardEncounter(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/encounters/:id/addenda [DOCTOR] — SIGNED only, append-only
encounterRouter.post(
  '/encounters/:id/addenda',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  validate(addendumSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    addEncounterAddendum(params.id, req.body as AddendumInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/encounters/:id/ai-diagnosis [DOCTOR] — runs AI diagnosis analysis over session content
encounterRouter.post(
  '/encounters/:id/ai-diagnosis',
  requireRole('DOCTOR'),
  validate(encounterIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    runAiDiagnosisForEncounter(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

