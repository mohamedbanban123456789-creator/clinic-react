import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { createPatient } from './patient.create.js';
import { searchPatients } from './patient.search.js';
import { getPatientById } from './patient.detail.js';
import { flagPatientDuplicate, patchPatient } from './patient.update.js';
import {
  createPatientSchema,
  flagDuplicateSchema,
  patchPatientSchema,
  patientIdParamSchema,
  searchPatientsQuerySchema,
  type CreatePatientInput,
  type FlagDuplicateInput,
  type PatchPatientInput,
} from './patient.validators.js';

export const patientRouter: Router = Router();

patientRouter.use(authenticate, requireFreshPassword);

patientRouter.post(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(createPatientSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    createPatient(req.body as CreatePatientInput, { userId: auth.userId, role: auth.role })
      .then((patient) => res.status(201).json(patient))
      .catch(next);
  },
);

patientRouter.get(
  '/search',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(searchPatientsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const query = req.query as { q: string };
    searchPatients(query.q, { userId: auth.userId, role: auth.role })
      .then((rows) => res.status(200).json({ data: rows }))
      .catch(next);
  },
);

patientRouter.get(
  '/:id',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(patientIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getPatientById(params.id, { userId: auth.userId, role: auth.role })
      .then((patient) => res.status(200).json(patient))
      .catch(next);
  },
);

patientRouter.patch(
  '/:id',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(patientIdParamSchema, 'params'),
  validate(patchPatientSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    patchPatient(params.id, req.body as PatchPatientInput, { userId: auth.userId, role: auth.role })
      .then((patient) => res.status(200).json(patient))
      .catch(next);
  },
);

patientRouter.post(
  '/:id/flag-duplicate',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(flagDuplicateSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    const body = req.body as FlagDuplicateInput;
    flagPatientDuplicate(params.id, body.canonicalPatientId, { userId: auth.userId, role: auth.role })
      .then((patient) => res.status(200).json(patient))
      .catch(next);
  },
);
