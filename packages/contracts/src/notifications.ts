import { z } from 'zod';
import { listQuerySchema } from './organizations';
export const notificationTypeSchema = z.enum([
  'TASK_ASSIGNED',
  'TASK_UPDATED',
  'TASK_COMMENT',
  'MENTION',
  'PROJECT_INVITE',
  'WORKSPACE_INVITE',
  'DUE_DATE',
]);
export const notificationListSchema = listQuerySchema.extend({
  unread: z.enum(['all', 'true', 'false']).default('all'),
  sort: z.literal('createdAt').default('createdAt'),
});
export const notificationReadSchema = z.object({ read: z.boolean() }).strict();
export const notificationSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  boardId: z.string().uuid(),
  projectId: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export const notificationCountSchema = z.object({ unread: z.number().int().nonnegative() });
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationList = z.infer<typeof notificationListSchema>;
