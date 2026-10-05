import { z } from 'zod';
import { listQuerySchema } from './organizations';
import { columnKindSchema, taskPrioritySchema } from './kanban';
import { projectStatusSchema } from './projects';
import { activitySchema } from './collaboration';
export const searchKindSchema = z.enum(['tasks', 'projects', 'members', 'comments']);
export const searchQuerySchema = listQuerySchema.extend({
  search: z.string().trim().min(2).max(120),
  type: searchKindSchema,
  sort: z.literal('createdAt').default('createdAt'),
});
export const searchHitSchema = z.object({
  id: z.string().uuid(),
  type: searchKindSchema,
  title: z.string(),
  context: z.string(),
  href: z.string().regex(/^\/(boards|projects|organizations)\?/),
  createdAt: z.string().datetime(),
});
export const myTasksQuerySchema = listQuerySchema.extend({
  sort: z.enum(['createdAt', 'dueDate', 'priority']).default('dueDate'),
  priority: taskPrioritySchema.optional(),
  status: columnKindSchema.optional(),
  due: z.enum(['all', 'overdue', 'soon']).default('all'),
});
export const myTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  priority: taskPrioritySchema,
  status: columnKindSchema,
  dueDate: z.string().datetime().nullable(),
  boardId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
});
export const dashboardSchema = z.object({
  activeProjects: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  dueSoon: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  byPriority: z.array(
    z.object({ priority: taskPrioritySchema, count: z.number().int().nonnegative() }),
  ),
  recentProjects: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      workspaceId: z.string().uuid(),
      status: projectStatusSchema,
      openTasks: z.number().int().nonnegative(),
      completedTasks: z.number().int().nonnegative(),
    }),
  ),
  recentActivities: z.array(activitySchema),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
