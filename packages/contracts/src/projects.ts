import { z } from 'zod';
import { listQuerySchema, organizationInputSchema } from './organizations';

const name = z.string().trim().min(2).max(120);
const description = z.string().trim().max(10000).nullable().default(null);
export const workspaceInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    name,
    slug: organizationInputSchema.shape.slug,
    description,
    icon: z.string().trim().max(32).nullable().default(null),
  })
  .strict();
export const workspaceUpdateSchema = workspaceInputSchema
  .omit({ organizationId: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export const workspaceListSchema = listQuerySchema.extend({ organizationId: z.string().uuid() });
export const workspaceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  canManage: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const scopeMemberInputSchema = z.object({ userId: z.string().uuid() }).strict();
export const scopeMemberSchema = z.object({
  userId: z.string().uuid(),
  joinedAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    avatarUrl: z.string().nullable(),
  }),
});
export const projectStatusSchema = z.enum([
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
]);
export const projectFieldsSchema = z
  .object({
    name,
    description,
    status: projectStatusSchema.default('PLANNING'),
    startDate: z.string().datetime().nullable().default(null),
    dueDate: z.string().datetime().nullable().default(null),
  })
  .strict();
export function validProjectDates(value: { startDate?: string | null; dueDate?: string | null }) {
  return !value.startDate || !value.dueDate || new Date(value.startDate) <= new Date(value.dueDate);
}
export const projectInputSchema = projectFieldsSchema
  .extend({ workspaceId: z.string().uuid() })
  .refine(validProjectDates, {
    message: 'Start date must be on or before due date',
    path: ['dueDate'],
  });
export const projectUpdateSchema = projectFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field')
  .refine(validProjectDates, {
    message: 'Start date must be on or before due date',
    path: ['dueDate'],
  });
export const projectListSchema = listQuerySchema.extend({
  workspaceId: z.string().uuid(),
  status: projectStatusSchema.optional(),
});
export const projectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  startDate: z.string().datetime().nullable(),
  dueDate: z.string().datetime().nullable(),
  canManage: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const projectOverviewSchema = z.object({
  tasks: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  members: z.number().int().nonnegative(),
  recentActivities: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.string(),
      createdAt: z.string().datetime(),
      actorName: z.string().nullable(),
    }),
  ),
});
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;
export type WorkspaceUpdate = z.infer<typeof workspaceUpdateSchema>;
export type WorkspaceList = z.infer<typeof workspaceListSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ScopeMember = z.infer<typeof scopeMemberSchema>;
