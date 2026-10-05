import { z } from 'zod';
import { listQuerySchema } from './organizations';
const uuid = z.string().uuid();
const version = z.number().int().min(0).max(2147483647);
const identifiers = z
  .array(uuid)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Do not repeat IDs');
const name = z.string().trim().min(1).max(120);
export const columnKindSchema = z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const boardInputSchema = z.object({ projectId: uuid, name }).strict();
export const boardUpdateSchema = z.object({ name }).strict();
export const boardListSchema = listQuerySchema.extend({ projectId: uuid });
export const columnInputSchema = z
  .object({ name: name.max(80), kind: columnKindSchema.default('TODO') })
  .strict();
export const columnUpdateSchema = z
  .object({ name: name.max(80).optional(), kind: columnKindSchema.optional() })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Provide at least one field');
export const reorderColumnsSchema = z
  .object({
    columnIds: z
      .array(uuid)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, 'Do not repeat columns'),
    expectedRevision: version,
  })
  .strict();
export const taskInputSchema = z
  .object({
    columnId: uuid,
    title: z.string().trim().min(1).max(240),
    description: z.string().max(20000).nullable().default(null),
    priority: taskPrioritySchema.default('MEDIUM'),
    dueDate: z.string().datetime().nullable().default(null),
    assigneeIds: identifiers.default([]),
    labelIds: identifiers.default([]),
  })
  .strict();
export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(20000).nullable().optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: z.string().datetime().nullable().optional(),
    assigneeIds: identifiers.optional(),
    labelIds: identifiers.optional(),
    expectedVersion: version,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, 'Provide at least one field');
export const taskVersionSchema = z.object({ expectedVersion: version }).strict();
export const taskMoveSchema = z
  .object({
    columnId: uuid,
    beforeTaskId: uuid.nullable().default(null),
    expectedVersion: version,
    expectedRevision: version,
  })
  .strict();
export const taskArchiveSchema = z
  .object({ archived: z.boolean(), expectedVersion: version })
  .strict();
export const taskListSchema = listQuerySchema.extend({
  boardId: uuid,
  columnId: uuid.optional(),
  archived: z.enum(['true', 'false']).default('false'),
  priority: taskPrioritySchema.optional(),
  assigneeId: uuid.optional(),
  sort: z.enum(['position', 'createdAt', 'dueDate', 'priority']).default('position'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export const labelInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((color) => color.toLowerCase()),
  })
  .strict();
export const checklistInputSchema = z.object({ title: name, expectedVersion: version }).strict();
export const checklistItemInputSchema = z
  .object({ text: z.string().trim().min(1).max(240), expectedVersion: version })
  .strict();
export const checklistItemUpdateSchema = z
  .object({
    text: z.string().trim().min(1).max(240).optional(),
    completed: z.boolean().optional(),
    expectedVersion: version,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, 'Provide at least one field');
export const labelSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string(),
  color: z.string(),
});
export const taskSchema = z.object({
  id: uuid,
  columnId: uuid,
  title: z.string(),
  description: z.string().nullable(),
  priority: taskPrioritySchema,
  status: columnKindSchema,
  position: z.string(),
  version,
  createdById: uuid.nullable(),
  dueDate: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  canEdit: z.boolean(),
  canArchive: z.boolean(),
  assignees: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      email: z.string().email(),
      avatarUrl: z.string().nullable(),
    }),
  ),
  labels: z.array(labelSchema),
});
export const checklistSchema = z.object({
  id: uuid,
  title: z.string(),
  position: z.number().int(),
  items: z.array(
    z.object({ id: uuid, text: z.string(), completed: z.boolean(), position: z.number().int() }),
  ),
});
export const taskDetailSchema = taskSchema.extend({ checklists: z.array(checklistSchema) });
export const columnSchema = z.object({
  id: uuid,
  boardId: uuid,
  name: z.string(),
  kind: columnKindSchema,
  position: z.number().int(),
});
export const boardSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string(),
  revision: version,
  canManage: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const boardSnapshotSchema = boardSchema.extend({
  columns: z.array(
    columnSchema.extend({ tasks: z.array(taskSchema), totalTasks: z.number().int().nonnegative() }),
  ),
});
export type BoardInput = z.infer<typeof boardInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type TaskMove = z.infer<typeof taskMoveSchema>;
export type TaskList = z.infer<typeof taskListSchema>;
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
