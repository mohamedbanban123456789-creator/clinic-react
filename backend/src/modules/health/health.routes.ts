import { Router, type Request, type Response } from 'express';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});
