import { z } from 'zod';

const idText = (field: string): z.ZodString =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(64);

function isValidDateString(v: string): boolean {
  return !Number.isNaN(Date.parse(v));
}

/** POST /ehr/vault/patients/:id/notes [DOCTOR] */
export const createVaultNoteSchema = z
  .object({
    content: z
      .string({ required_error: 'content is required' })
      .min(1, 'content is required')
      .max(20000, 'content must be at most 20000 characters'),
    noteDate: z.string().trim().min(1).refine(isValidDateString, 'noteDate must be valid').optional(),
    supersedesNoteId: idText('supersedesNoteId').optional(),
  })
  .strict();

/** GET /ehr/vault/patients/:id/notes?limit<=20&cursor [DOCTOR] */
export const listVaultNotesQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(20).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const patientIdParamSchema = z.object({ id: idText('id') }).strict();

export const noteIdParamSchema = z.object({ id: idText('id') }).strict();

export type CreateVaultNoteInput = z.infer<typeof createVaultNoteSchema>;
export type ListVaultNotesQuery = z.infer<typeof listVaultNotesQuerySchema>;
