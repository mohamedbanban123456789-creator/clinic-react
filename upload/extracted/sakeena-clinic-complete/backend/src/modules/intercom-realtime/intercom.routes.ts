import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  listFollowUps,
  listIntercom,
  sendIntercom,
  updateFollowUpStatus,
} from './intercom.service.js';
import {
  followupIdParamSchema,
  followupPatchSchema,
  followupsQuerySchema,
  intercomHistoryQuerySchema,
  intercomSendSchema,
  type FollowUpPatch,
  type FollowupsQuery,
  type IntercomHistoryQuery,
  type IntercomSendInput,
} from './intercom.validators.js';

/**
 * BE-402 REST fallbacks (`/api/v1/intercom`, `/api/v1/followups`). Mirror the WS
 * behavior for offline/thin clients. `POST /intercom` with DOCTOR_COMPLIMENTARY
 * requires an Idempotency-Key (financial-adjacent, CONV-03); DOCTOR_COMPLIMENTARY
 * is still NOTIFICATION-ONLY here — no financial write occurs from chat.
 */
export const intercomRouter: Router = Router();
export const followupsRouter: Router = Router();

intercomRouter.use(authenticate, requireFreshPassword);
followupsRouter.use(authenticate, requireFreshPassword);

function readOptionalIdempotencyKey(req: Request): string | undefined {
  const raw = req.header('Idempotency-Key');
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const trimmed = raw.trim();
  // Cheap uuid shape guard when a key IS supplied (REST may supply it for replay).
  const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  return uuidish ? trimmed : undefined;
}

// GET /api/v1/intercom?limit&cursor  [BOTH]  -> 200 SecretSafe<IntercomListDto>
intercomRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(intercomHistoryQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    listIntercom(req.query as IntercomHistoryQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// POST /api/v1/intercom  [BOTH]  -> 201 SecretSafe<IntercomDto> (offline REST fallback)
intercomRouter.post(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(intercomSendSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const body = req.body as IntercomSendInput;
    // Role-type ownership is enforced in the service; mirror WS so a forged
    // type yields 403 here too.
    if (body.type === 'DOCTOR_COMPLIMENTARY') {
      // Reserved for the notification-only financial path (REST /billing/complimentary);
      // the chat channel refuses to accept it to keep chat free of financial writes.
      next(new AppError('FORBIDDEN', 'DOCTOR_COMPLIMENTARY is notification-only; use the billing complimentary endpoint'));
      return;
    }
    const idempotencyKey = readOptionalIdempotencyKey(req);
    sendIntercom({ ...body, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) }, { userId: auth.userId, role: auth.role })
      .then((result) => res.status(201).json(result.message))
      .catch(next);
  },
);

// GET /api/v1/followups?patientId=&status=  [BOTH]  -> 200 SecretSafe<FollowUpListDto>
followupsRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(followupsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    listFollowUps(req.query as FollowupsQuery)
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// PATCH /api/v1/followups/:id  [BOTH]  -> 200 SecretSafe<FollowUpDto>
// SECRETARY sets SCHEDULED/DONE; DOCTOR sets CANCELLED (service enforces).
followupsRouter.patch(
  '/:id',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(followupIdParamSchema, 'params'),
  validate(followupPatchSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    const body = req.body as FollowUpPatch;
    updateFollowUpStatus(params.id, body.status, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);
