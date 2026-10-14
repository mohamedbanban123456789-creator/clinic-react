import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import {
  commitScribeSession,
  getScribeTranscript,
  purgeScribeAudioFiles,
  runCycle1Consultation,
  runCycle2DoctorDecision,
  startScribeSession,
  withdrawConsentScribeSession,
} from './scribe.service.js';
import {
  audioUploadSchema,
  commitSessionSchema,
  createSessionSchema,
  sessionIdParamSchema,
  withdrawConsentSchema,
  type AudioUploadInput,
  type CommitSessionInput,
  type CreateSessionInput,
  type WithdrawConsentInput,
} from './scribe.validators.js';

/**
 * Sprint 6 AI Scribe routes — all DOCTOR-only, role-first (zero-knowledge:
 * generic 403, no existence oracle). Mounted under /api/v1/scribe.
 *
 * 2-cycle foundation:
 *   POST /sessions -> RECORDING
 *   POST /sessions/:id/cycle-1-consultation (Gemini + CYCLE_1 prompt)
 *   POST /sessions/:id/cycle-2-doctor-decision (Gemini + CYCLE_2 prompt)
 *   POST /sessions/:id/commit (Encounter source SCRIBE + Medications)
 *   POST /sessions/:id/purge-audio (delete bytes, keep records)
 */
export const scribeRouter: Router = Router();

scribeRouter.use(authenticate, requireFreshPassword);

// POST /api/v1/scribe/sessions [DOCTOR] -> 201 { sessionId, status: RECORDING }
scribeRouter.post(
  '/sessions',
  requireRole('DOCTOR'),
  validate(createSessionSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    startScribeSession(req.body as CreateSessionInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);

// POST /api/v1/scribe/sessions/:id/cycle-1-consultation [DOCTOR] -> 200 analysis
scribeRouter.post(
  '/sessions/:id/cycle-1-consultation',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  validate(audioUploadSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    runCycle1Consultation(params.id, req.body as AudioUploadInput, {
      userId: auth.userId,
      role: auth.role,
    })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/scribe/sessions/:id/cycle-2-doctor-decision [DOCTOR] -> 200 SOAP+Rx
scribeRouter.post(
  '/sessions/:id/cycle-2-doctor-decision',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  validate(audioUploadSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    runCycle2DoctorDecision(params.id, req.body as AudioUploadInput, {
      userId: auth.userId,
      role: auth.role,
    })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/scribe/sessions/:id/commit [DOCTOR] -> 200 { encounterId, FINALIZED }
scribeRouter.post(
  '/sessions/:id/commit',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  validate(commitSessionSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    commitScribeSession(params.id, req.body as CommitSessionInput, {
      userId: auth.userId,
      role: auth.role,
    })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// GET /api/v1/scribe/sessions/:id/transcript [DOCTOR] -> stored transcript
// labeled by patient name + session date (cleaned, speaker-segmented).
scribeRouter.get(
  '/sessions/:id/transcript',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getScribeTranscript(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/scribe/sessions/:id/purge-audio [DOCTOR] -> 200 { purged: true }
scribeRouter.post(
  '/sessions/:id/purge-audio',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    purgeScribeAudioFiles(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/scribe/sessions/:id/withdraw-consent [DOCTOR] -> 200
// DB-15: locks the session, purges audio, audits CONSENT_WITHDRAWN.
scribeRouter.post(
  '/sessions/:id/withdraw-consent',
  requireRole('DOCTOR'),
  validate(sessionIdParamSchema, 'params'),
  validate(withdrawConsentSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    withdrawConsentScribeSession(params.id, (req.body ?? {}) as WithdrawConsentInput, {
      userId: auth.userId,
      role: auth.role,
    })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);
