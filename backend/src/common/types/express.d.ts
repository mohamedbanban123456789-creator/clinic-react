/**
 * Global Express request augmentation (BE-102).
 * Declares `req.auth` so strict-mode handlers do not need casts.
 */
import type { AuthContext } from '../middleware/authenticate.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
