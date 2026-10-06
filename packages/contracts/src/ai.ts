import { z } from 'zod';
import { taskPrioritySchema } from './kanban';
export const aiRequestSchema = z
  .object({
    kind: z.enum(['SUMMARY', 'OVERDUE', 'MEETING_NOTES']),
    prompt: z.string().trim().min(2).max(16000),
  })
  .strict();
export const aiSuggestionSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().max(10000).nullable(),
    priority: taskPrioritySchema,
    dueDate: z.string().datetime().nullable(),
    assigneeIds: z.array(z.string().uuid()).max(20),
  })
  .strict();
export const aiOutputSchema = z
  .object({
    headline: z.string().min(1).max(240),
    bullets: z.array(z.string().min(1).max(1000)).max(12),
    risks: z.array(z.string().min(1).max(1000)).max(10),
    references: z
      .array(z.object({ taskId: z.string().uuid(), reason: z.string().min(1).max(500) }).strict())
      .max(25),
    suggestions: z.array(aiSuggestionSchema).max(10),
  })
  .strict();
export const aiConfirmSchema = z
  .object({
    confirmed: z.literal(true),
    columnId: z.string().uuid(),
    suggestionIndexes: z
      .array(z.number().int().min(0).max(9))
      .min(1)
      .max(10)
      .refine((indexes) => new Set(indexes).size === indexes.length, 'Choose each suggestion once'),
  })
  .strict();
export const aiRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: aiRequestSchema.shape.kind,
  prompt: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  output: aiOutputSchema.nullable(),
  error: z.string().nullable(),
  confirmedTaskIds: z.array(z.string().uuid()),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export const aiAvailabilitySchema = z.object({ enabled: z.boolean() });
export type AIRequest = z.infer<typeof aiRequestSchema>;
export type AIOutput = z.infer<typeof aiOutputSchema>;
export type AIConfirm = z.infer<typeof aiConfirmSchema>;
export type AIRun = z.infer<typeof aiRunSchema>;
