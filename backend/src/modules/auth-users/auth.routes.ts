import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, requireAuth } from '../../common/middleware/authenticate.js';
import { validate } from '../../common/middleware/validate.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, isCookieSecure } from '../../config/auth.js';
import { changePasswordSchema, loginSchema, updateMeSchema } from './auth.validators.js';
import { changePassword, getMe, updateMe } from './auth.profile.js';
import { login } from './auth.service.js';
import { logout, refresh } from './auth.session.js';

export const authRouter: Router = Router();

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

authRouter.post('/login', validate(loginSchema), (req: Request, res: Response, next: NextFunction): void => {
  login(req.body as { identifier: string; password: string })
    .then((out) => {
      setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
      res.status(200).json({ accessToken: out.accessToken, user: out.user, mustChangePassword: out.mustChangePassword });
    })
    .catch(next);
});

authRouter.post('/refresh', (req: Request, res: Response, next: NextFunction): void => {
  const cookies: Record<string, string | undefined> | undefined = req.cookies as
    | Record<string, string | undefined>
    | undefined;
  const raw: string | undefined = cookies?.[REFRESH_COOKIE_NAME];
  refresh(raw)
    .then((out) => {
      setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
      res.status(200).json({ accessToken: out.accessToken });
    })
    .catch(next);
});

authRouter.post('/logout', (req: Request, res: Response, next: NextFunction): void => {
  const cookies: Record<string, string | undefined> | undefined = req.cookies as
    | Record<string, string | undefined>
    | undefined;
  const raw: string | undefined = cookies?.[REFRESH_COOKIE_NAME];
  logout(raw)
    .then((out) => {
      clearRefreshCookie(res);
      res.status(200).json(out);
    })
    .catch(next);
});

authRouter.get('/me', authenticate, (req: Request, res: Response, next: NextFunction): void => {
  getMe(requireAuth(req).userId)
    .then((me) => res.status(200).json(me))
    .catch(next);
});

authRouter.patch(
  '/me',
  authenticate,
  validate(updateMeSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    updateMe(requireAuth(req).userId, req.body as { name: string })
      .then((me) => res.status(200).json(me))
      .catch(next);
  },
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { oldPassword: string; newPassword: string };
    changePassword(requireAuth(req).userId, body)
      .then((out) => {
        clearRefreshCookie(res);
        res.status(200).json(out);
      })
      .catch(next);
  },
);
