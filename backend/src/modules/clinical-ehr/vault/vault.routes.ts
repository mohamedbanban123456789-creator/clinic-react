import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../../common/middleware/authenticate.js';
import { requireRole } from '../../../common/middleware/requireRole.js';
import { validate } from '../../../common/middleware/validate.js';
import { createVaultNote, listVaultNotes, shredVaultNote } from './vault.service.js';
import {
  createVaultNoteSchema,
  listVaultNotesQuerySchema,
  noteIdParamSchema,
  patientIdParamSchema,
  type CreateVaultNoteInput,
  type ListVaultNotesQuery,
} from './vault.validators.js';

/**
 * BE-503 segregated vault router — DOCTOR-only, role-first.
 * Mounted under /api/v1/ehr/vault (see app.ts).
 */
export const vaultRouter: Router = Router();

vaultRouter.use(authenticate, requireFreshPassword);

// POST /api/v1/ehr/vault/patients/:id/notes [DOCTOR] -> 201 { noteId, noteDate, seq }
vaultRouter.post(
  '/patients/:id/notes',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(createVaultNoteSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    createVaultNote(params.id, req.body as CreateVaultNoteInput, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(201).json(out))
      .catch(next);
  },
);

// GET /api/v1/ehr/vault/patients/:id/notes?limit<=20&cursor [DOCTOR]
vaultRouter.get(
  '/patients/:id/notes',
  requireRole('DOCTOR'),
  validate(patientIdParamSchema, 'params'),
  validate(listVaultNotesQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    listVaultNotes(params.id, req.query as ListVaultNotesQuery, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);

// POST /api/v1/ehr/vault/notes/:id/shred [DOCTOR] -> 200 tombstone
vaultRouter.post(
  '/notes/:id/shred',
  requireRole('DOCTOR'),
  validate(noteIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    shredVaultNote(params.id, { userId: auth.userId, role: auth.role })
      .then((out) => res.status(200).json(out))
      .catch(next);
  },
);
