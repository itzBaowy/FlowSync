import { z } from 'zod';
import { emailSchema } from './validation';
export { emailSchema } from './validation';
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Enter your password').max(128),
  })
  .strict();
export const registerSchema = loginSchema
  .extend({
    name: z.string().trim().min(2, 'Use at least 2 characters').max(80),
    password: z.string().min(12, 'Use at least 12 characters').max(128),
  })
  .strict();
export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: emailSchema,
  avatarUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export const authSessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: userSchema,
});
export const errorSchema = z.object({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export interface ApiResponse<T> {
  data: T;
  meta: Record<string, unknown>;
}
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PublicUser = z.infer<typeof userSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export * from './organizations';
export * from './projects';
export * from './kanban';
export * from './realtime';
