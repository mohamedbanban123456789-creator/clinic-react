import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { queryAuditEvents } from './audit.service.js';
import { auditQuerySchema, type AuditQuery } from './audit.validators.js';

/**
 * BE-701 audit query routes (`/api/v1/audit`).
 *
 * DOCTOR sees the full immutable-audit feed; SECRETARY sees only their own
 * operational events with vault/scribe entities filtered out (service-side,
 * role-first — a SECRETARY cannot probe other actors or clinical subsystems).
 */
export const auditRouter: Router = Router();
auditRouter.use(authenticate, requireFreshPassword);

// GET /api/v1/audit?action=&entityType=&entityId=&actorUserId=&startDate=&endDate=&limit=&cursor=
auditRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(auditQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    queryAuditEvents(req.query as AuditQuery, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);
