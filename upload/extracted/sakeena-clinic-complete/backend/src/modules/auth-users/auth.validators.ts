import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'identifier is required').max(120),
  password: z.string().min(1, 'password is required').max(256),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'oldPassword is required').max(256),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters').max(256),
});

export const updateMeSchema = z.object({
  name: z.string({ required_error: 'name is required' }).trim().min(1, 'name is required').max(120),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
