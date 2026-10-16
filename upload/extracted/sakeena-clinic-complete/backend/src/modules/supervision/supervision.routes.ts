import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { ackShift, runIntegrityCheck } from '../cashier-shift/shift.service.js';
import {
  integrityCheckSchema,
  shiftAckSchema,
  shiftIdParamSchema,
  type IntegrityCheckInput,
  type ShiftAckInput,
  type ShiftIdParam,
} from '../cashier-shift/shift.validators.js';
import {
  getCashSummary,
  getDiscounts,
  getDiscrepancies,
  getExceptions,
  getFrontDeskActivity,
  getNonCash,
  getShiftReadiness,
  getUnsignedNotes,
  listSupervisionShifts,
} from './supervision.service.js';
import {
  cashSummaryQuerySchema,
  discrepanciesQuerySchema,
  discountsQuerySchema,
  exceptionsQuerySchema,
  frontDeskActivityQuerySchema,
  nonCashQuerySchema,
  shiftReadinessQuerySchema,
  supervisionShiftsQuerySchema,
  unsignedNotesQuerySchema,
  type CashSummaryQuery,
  type DiscrepanciesQuery,
  type DiscountsQuery,
  type ExceptionsQuery,
  type FrontDeskActivityQuery,
  type NonCashQuery,
  type ShiftReadinessQuery,
  type SupervisionShiftsQuery,
  type UnsignedNotesQuery,
} from './supervision.validators.js';

/**
 * BE-702 supervision routes (`/api/v1/supervision`).
 *
 * Every route here is DOCTOR-only. `requireRole('DOCTOR')` runs BEFORE any
 * resource lookup so a SECRETARY cannot probe shift existence, financial
 * totals, discounts, unsigned clinical backlog, or invariant violations.
 * There is no SECRETARY DTO variant — clinical safety and cash oversight are
 * doctor-exclusive by design (DB-02, CONV-02).
 */
export const supervisionRouter: Router = Router();
supervisionRouter.use(authenticate, requireFreshPassword);

// GET /api/v1/supervision/front-desk-activity?shiftId=&clinicDayId= [DOCTOR]
supervisionRouter.get(
  '/front-desk-activity',
  requireRole('DOCTOR'),
  validate(frontDeskActivityQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getFrontDeskActivity(req.query as unknown as FrontDeskActivityQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/cash-summary?shiftId= [DOCTOR]
supervisionRouter.get(
  '/cash-summary',
  requireRole('DOCTOR'),
  validate(cashSummaryQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getCashSummary(req.query as unknown as CashSummaryQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/shifts?unacked=&varianceOnly= [DOCTOR]
supervisionRouter.get(
  '/shifts',
  requireRole('DOCTOR'),
  validate(supervisionShiftsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    listSupervisionShifts(req.query as unknown as SupervisionShiftsQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/unsigned-notes?shiftId= [DOCTOR]
supervisionRouter.get(
  '/unsigned-notes',
  requireRole('DOCTOR'),
  validate(unsignedNotesQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getUnsignedNotes(req.query as unknown as UnsignedNotesQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/discounts?shiftId= [DOCTOR]
supervisionRouter.get(
  '/discounts',
  requireRole('DOCTOR'),
  validate(discountsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getDiscounts(req.query as unknown as DiscountsQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/noncash?clinicDayId=&shiftId= [DOCTOR]
supervisionRouter.get(
  '/noncash',
  requireRole('DOCTOR'),
  validate(nonCashQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getNonCash(req.query as unknown as NonCashQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/supervision/exceptions?clinicDayId=&shiftId= [DOCTOR]
supervisionRouter.get(
  '/exceptions',
  requireRole('DOCTOR'),
  validate(exceptionsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getExceptions(req.query as unknown as ExceptionsQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /supervision/discrepancies?shiftId= [DOCTOR] (RPS-2 INV-1..10 gate view)
supervisionRouter.get(
  '/discrepancies',
  requireRole('DOCTOR'),
  validate(discrepanciesQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getDiscrepancies(req.query as unknown as DiscrepanciesQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /supervision/shift-readiness?shiftId= [DOCTOR] (close-readiness probe)
supervisionRouter.get(
  '/shift-readiness',
  requireRole('DOCTOR'),
  validate(shiftReadinessQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    getShiftReadiness(req.query as unknown as ShiftReadinessQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// POST /api/v1/supervision/shifts/:id/ack [DOCTOR] (async review, non-blocking)
supervisionRouter.post(
  '/shifts/:id/ack',
  requireRole('DOCTOR'),
  validate(shiftIdParamSchema, 'params'),
  validate(shiftAckSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as unknown as ShiftIdParam;
    ackShift(params.id, req.body as ShiftAckInput, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// POST /api/v1/supervision/integrity-check [DOCTOR] (on-demand INV probe)
supervisionRouter.post(
  '/integrity-check',
  requireRole('DOCTOR'),
  validate(integrityCheckSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    runIntegrityCheck(req.body as IntegrityCheckInput, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);
