import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate, requireIdempotencyKey } from '../../common/middleware/validate.js';
import { idempotency } from '../../common/middleware/idempotency.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  abandonEntry,
  callEntry,
  callNext,
  checkIn,
  completeEntry,
  debtAck,
  deferDocumentation,
  getWaitTimes,
  listQueue,
  markNoShow,
  reorderQueue,
  requeueEntry,
  skipEntry,
  toggleEmergency,
  undoComplete,
} from './queue.service.js';
import {
  abandonSchema,
  callNextSchema,
  callSchema,
  checkInSchema,
  debtAckSchema,
  deferDocumentationSchema,
  emergencyToggleSchema,
  entryIdParamSchema,
  noShowSchema,
  queueQuerySchema,
  reorderSchema,
  requeueSchema,
  undoCompleteSchema,
  waitTimesQuerySchema,
  type AbandonInput,
  type CallInput,
  type CallNextInput,
  type CheckInInput,
  type DeferDocumentationInput,
  type EmergencyToggleInput,
  type NoShowInput,
  type ReorderInput,
  type RequeueInput,
  type UndoCompleteInput,
  type WaitTimesQuery,
} from './queue.validators.js';

export const queueRouter: Router = Router();

queueRouter.use(authenticate, requireFreshPassword);

function readIdempotencyKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  if (raw === undefined || raw.trim().length === 0) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid v4) is required');
  }
  return raw.trim();
}

// POST /api/v1/queue/check-in  [BOTH]  -> 201 SecretSafe<QueueEntryDto> + debtAlert
queueRouter.post(
  '/check-in',
  requireRole('DOCTOR', 'SECRETARY'),
  requireIdempotencyKey,
  validate(checkInSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const key = readIdempotencyKey(req);
    checkIn(req.body as CheckInInput, { userId: auth.userId, role: auth.role }, key)
      .then((entry) => res.status(201).json(entry))
      .catch(next);
  },
);

// GET /api/v1/queue?shiftId=&status=  [BOTH]  -> 200 SecretSafe<QueueListDto>
queueRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(queueQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    listQueue(req.query as Parameters<typeof listQueue>[0], { userId: auth.userId, role: auth.role })
      .then((list) => res.status(200).json(list))
      .catch(next);
  },
);

// GET /api/v1/queue/wait-times?shiftId=  [BOTH]  -> 200 SecretSafe<WaitTimesDto>
// Registered before /:entryId/* so "wait-times" is not captured as an entryId.
queueRouter.get(
  '/wait-times',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(waitTimesQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    getWaitTimes(req.query as WaitTimesQuery, { userId: auth.userId, role: auth.role })
      .then((times) => res.status(200).json(times))
      .catch(next);
  },
);

// POST /api/v1/queue/reorder  [BOTH]  -> 200 SecretSafe<QueueReorderDto>
// OCC via body lastSeenQueueVersion + Idempotency-Key. The idempotency(scope)
// middleware ENFORCES the key (DB-08/CONV-03): identical replays return the
// cached result with `Idempotent-Replayed: true` and zero duplicate side
// effects; a reused key with a different payload is a 409. Registered before
// /:entryId/* so "reorder" is not captured as an entryId.
queueRouter.post(
  '/reorder',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('queue.reorder'),
  validate(reorderSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    reorderQueue(req.body as ReorderInput, { userId: auth.userId, role: auth.role })
      .then((reordered) => res.status(200).json(reordered))
      .catch(next);
  },
);

// POST /api/v1/queue/call-next  [DOCTOR]
queueRouter.post(
  '/call-next',
  requireRole('DOCTOR'),
  validate(callNextSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    callNext(req.body as CallNextInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/call  [DOCTOR]
queueRouter.post(
  '/:entryId/call',
  requireRole('DOCTOR'),
  validate(entryIdParamSchema, 'params'),
  validate(callSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    callEntry(params.entryId, req.body as CallInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/skip  [DOCTOR]
queueRouter.post(
  '/:entryId/skip',
  requireRole('DOCTOR'),
  validate(entryIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    skipEntry(params.entryId, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/requeue  [BOTH]
queueRouter.post(
  '/:entryId/requeue',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(entryIdParamSchema, 'params'),
  validate(requeueSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    requeueEntry(params.entryId, req.body as RequeueInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/emergency  [BOTH]  -> 200 SecretSafe<QueueEntryDto>
// Coded reason on flag; secretary unflag restricted to own flag within grace.
// idempotency(scope) makes a replayed toggle return the cached entry (a replayed
// toggle must NEVER flip the flag a second time).
queueRouter.post(
  '/:entryId/emergency',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('queue.emergency'),
  validate(entryIdParamSchema, 'params'),
  validate(emergencyToggleSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    toggleEmergency(params.entryId, req.body as EmergencyToggleInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/complete  [DOCTOR]
queueRouter.post(
  '/:entryId/complete',
  requireRole('DOCTOR'),
  validate(entryIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    completeEntry(params.entryId, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/undo-complete  [DOCTOR]  (RPS-2 API-06)
// Body { reason } REQUIRED + optional lastSeenQueueVersion OCC; Idempotency-Key
// header ENFORCED by the idempotency middleware (identical replays return the
// cached 200 with zero duplicate side effects; a reused key with a different
// payload is 409 IDEMPOTENCY_KEY_CONFLICT).
queueRouter.post(
  '/:entryId/undo-complete',
  requireRole('DOCTOR'),
  idempotency('queue.undoComplete'),
  validate(entryIdParamSchema, 'params'),
  validate(undoCompleteSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    undoComplete(params.entryId, req.body as UndoCompleteInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/no-show  [BOTH]
queueRouter.post(
  '/:entryId/no-show',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(entryIdParamSchema, 'params'),
  validate(noShowSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    markNoShow(params.entryId, req.body as NoShowInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/abandon  [DOCTOR]
queueRouter.post(
  '/:entryId/abandon',
  requireRole('DOCTOR'),
  validate(entryIdParamSchema, 'params'),
  validate(abandonSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    abandonEntry(params.entryId, req.body as AbandonInput, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/debt-ack  [BOTH]
queueRouter.post(
  '/:entryId/debt-ack',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(entryIdParamSchema, 'params'),
  validate(debtAckSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    debtAck(params.entryId, { userId: auth.userId, role: auth.role })
      .then((entry) => res.status(200).json(entry))
      .catch(next);
  },
);

// POST /api/v1/queue/:entryId/defer-documentation  [DOCTOR]
queueRouter.post(
  '/:entryId/defer-documentation',
  requireRole('DOCTOR'),
  validate(entryIdParamSchema, 'params'),
  validate(deferDocumentationSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { entryId: string };
    deferDocumentation(params.entryId, req.body as DeferDocumentationInput, { userId: auth.userId, role: auth.role })
      .then((result) => res.status(200).json(result))
      .catch(next);
  },
);
