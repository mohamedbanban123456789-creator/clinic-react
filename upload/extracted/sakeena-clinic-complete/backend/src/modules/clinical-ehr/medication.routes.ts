import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import {
  adjustMedication,
  createMedication,
  discontinueMedication,
  listMedications,
} from './medication.service.js';
import {
  adjustMedicationSchema,
  createMedicationSchema,
  discontinueMedicationSchema,
  medicationIdParamSchema,
  medicationListQuerySchema,
  patientIdParamSchema,
  type AdjustMedicationInput,
  type CreateMedicationInput,
  type DiscontinueMedicationInput,
  type MedicationListQuery,
} from './medication.validators.js';

/**
 * BE-502 routes — all DOCTOR-only, role-first (generic 403, no oracle).
 * Mounted under /api/v1/ehr.
 */
export const medicationRouter: Router = Router();

medicationRouter.use(authenticate, requireFreshPassword);

// POST /api/v1/ehr/patients/:id/medications [DOCTOR] -> 201 ACTIVE
medicationRouter.post(
  '/patients/:id/medications',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(createMedicationSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    createMedication(params.id, req.body as CreateMedicationInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);

// GET /api/v1/ehr/patients/:id/medications?status= [DOCTOR]
medicationRouter.get(
  '/patients/:id/medications',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(medicationListQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    listMedications(params.id, req.query as MedicationListQuery, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/medications/:id/discontinue [DOCTOR] -> 200 DISCONTINUED
medicationRouter.post(
  '/medications/:id/discontinue',
  requireRole('DOCTOR'),
  validate(medicationIdParamSchema, 'params'),
  validate(discontinueMedicationSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    discontinueMedication(params.id, req.body as DiscontinueMedicationInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/medications/:id/adjust [DOCTOR] -> 201 titration pair
medicationRouter.post(
  '/medications/:id/adjust',
  requireRole('DOCTOR'),
  validate(medicationIdParamSchema, 'params'),
  validate(adjustMedicationSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    adjustMedication(params.id, req.body as AdjustMedicationInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);
