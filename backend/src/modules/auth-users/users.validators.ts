import { z } from 'zod';

const nonBlank = (field: string, max: number): z.ZodString =>
  z
    .string({ required_error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(max);

/**
 * BE-104 validators (Zod sole validation; failure -> 422 envelope).
 * All create fields are required non-blank.
 */
export const createSecretarySchema = z.object({
  name: nonBlank('name', 120),
  identifier: nonBlank('identifier', 120),
  password: z.string({ required_error: 'password is required' }).min(8, 'password must be at least 8 characters').max(256),
  gender: z.enum(['MALE', 'FEMALE']).default('FEMALE'),
});

export const userIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(64),
});

export const resetPasswordSchema = z.object({}).strict();

export type CreateSecretaryInput = z.infer<typeof createSecretarySchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
