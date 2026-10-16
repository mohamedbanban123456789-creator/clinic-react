import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { idempotency } from '../../common/middleware/idempotency.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  closeShift,
  createPetty,
  getCurrentShift,
  getShift,
  getShiftSummary,
  listPetty,
  openShift,
  reopenShift,
} from './shift.service.js';
import {
  pettyCreateSchema,
  pettyListQuerySchema,
  shiftCloseSchema,
  shiftIdParamSchema,
  shiftOpenSchema,
  type PettyCreateInput,
  type PettyListQuery,
  type ShiftCloseInput,
  type ShiftIdParam,
  type ShiftOpenInput,
} from './shift.validators.js';

/**
 * BE-304 / BE-305 shift routes (`/api/v1/shifts`).
 *
 * Cash-critical POSTs carry `idempotency('<scope>')`, which enforces a mandatory
 * `Idempotency-Key: <uuid v4>` header (422 when missing), replays the original
 * 2xx body with `Idempotent-Replayed: true`, and rejects cross-payload reuse
 * (409). Mounted after `authenticate` so `req.auth.userId` is available.
 */

function readIdempotencyKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  if (raw === undefined || raw.trim().length === 0) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid v4) is required');
  }
  return raw.trim();
}

export const shiftsRouter: Router = Router();
shiftsRouter.use(authenticate, requireFreshPassword);

// POST /api/v1/shifts/open  [BOTH]  -> 201 SecretSafe<ShiftOpenDto>
// Single-OPEN-shift invariant clinic-wide -> 409 SHIFT_ALREADY_OPEN.
shiftsRouter.post(
  '/open',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('shift.open'),
  validate(shiftOpenSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    openShift(req.body as ShiftOpenInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/shifts/reopen  [BOTH]  -> 200 SecretSafe<ShiftViewDto>
shiftsRouter.post(
  '/reopen',
  requireRole('DOCTOR', 'SECRETARY'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    reopenShift((req.body as { shiftId?: string })?.shiftId, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/shifts/current  [BOTH]  -> 200 SecretSafe<ShiftViewDto> (blind)
// Declared BEFORE '/:id' so the literal segment is not captured as an id.
shiftsRouter.get(
  '/current',
  requireRole('DOCTOR', 'SECRETARY'),
  (_req: Request, res: Response, next: NextFunction): void => {
    getCurrentShift()
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/shifts/:id  [BOTH]  -> 200 SecretSafe<ShiftViewDto> (blind)
shiftsRouter.get(
  '/:id',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(shiftIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const params = req.params as ShiftIdParam;
    getShift(params.id)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/shifts/:id/summary  [BOTH]  -> 200 SecretSafe<ShiftSummaryDto> (blind pre-close)
shiftsRouter.get(
  '/:id/summary',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(shiftIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const params = req.params as ShiftIdParam;
    getShiftSummary(params.id)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/shifts/:id/petty  [BOTH]  -> 200 SecretSafe<PettyListDto>
shiftsRouter.get(
  '/:id/petty',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(shiftIdParamSchema, 'params'),
  validate(pettyListQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const params = req.params as ShiftIdParam;
    listPetty(params.id, req.query as PettyListQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// POST /api/v1/shifts/:id/petty  [BOTH]  -> 201 SecretSafe<PettyExpenseDto>
shiftsRouter.post(
  '/:id/petty',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('shift.petty'),
  validate(shiftIdParamSchema, 'params'),
  validate(pettyCreateSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as ShiftIdParam;
    createPetty(params.id, req.body as PettyCreateInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/shifts/:id/close  [BOTH]  -> 200 SecretSafe<ShiftCloseDto>
// Blind two-phase: expected cash is revealed ONLY in this response body.
shiftsRouter.post(
  '/:id/close',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('shift.close'),
  validate(shiftIdParamSchema, 'params'),
  validate(shiftCloseSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as ShiftIdParam;
    closeShift(params.id, req.body as ShiftCloseInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);
