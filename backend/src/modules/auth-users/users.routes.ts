import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import {
  createSecretarySchema,
  resetPasswordSchema,
  userIdParamSchema,
  type CreateSecretaryInput,
} from './users.validators.js';
import { createSecretary, listUsers, resetUserPassword, setUserActive } from './users.service.js';

export const usersRouter: Router = Router();

// BE-104 chain: authenticate -> requireRole('DOCTOR') -> requireFreshPassword.
// Role runs before the password gate so SECRETARY callers always receive
// 403 FORBIDDEN (never a password-gate code or an existence oracle).
usersRouter.use(authenticate, requireRole('DOCTOR'), requireFreshPassword);

usersRouter.post(
  ['/secretaries', '/'],
  validate(createSecretarySchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    createSecretary(req.body as CreateSecretaryInput, { userId: auth.userId, role: auth.role })
      .then((user) => res.status(201).json(user))
      .catch(next);
  },
);

usersRouter.get('/', (_req: Request, res: Response, next: NextFunction): void => {
  listUsers()
    .then((users) => res.status(200).json({ data: users }))
    .catch(next);
});

usersRouter.patch(
  '/:id/deactivate',
  validate(userIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    setUserActive(params.id, false, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

usersRouter.patch(
  '/:id/activate',
  validate(userIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    setUserActive(params.id, true, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

usersRouter.post(
  '/:id/reset-password',
  validate(userIdParamSchema, 'params'),
  validate(resetPasswordSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    resetUserPassword(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);
