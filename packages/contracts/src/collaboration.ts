import { z } from 'zod';
import { listQuerySchema } from './organizations';
export const commentInputSchema = z.object({ text: z.string().trim().min(1).max(10000) }).strict();
export const commentVersionSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export const commentUpdateSchema = commentInputSchema.extend(commentVersionSchema.shape).strict();
export const commentListSchema = listQuerySchema.extend({
  sort: z.literal('createdAt').default('createdAt'),
});
export const publicActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export const commentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  text: z.string(),
  version: z.number().int().nonnegative(),
  author: publicActorSchema.nullable(),
  mentions: z.array(publicActorSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export const activityListSchema = listQuerySchema.extend({
  sort: z.literal('createdAt').default('createdAt'),
  taskId: z.string().uuid().optional(),
});
export const activitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  actor: publicActorSchema.nullable(),
  action: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type Comment = z.infer<typeof commentSchema>;
export type CommentList = z.infer<typeof commentListSchema>;
export type ActivityList = z.infer<typeof activityListSchema>;
