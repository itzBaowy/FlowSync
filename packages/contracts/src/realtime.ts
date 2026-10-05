import { z } from 'zod';
export const boardRoomSchema = z.object({ boardId: z.string().uuid() }).strict();
export const boardChangedSchema = z
  .object({
    boardId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deleted: z.boolean().optional(),
  })
  .strict();
export const realtimeErrorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(['UNAUTHORIZED', 'NOT_FOUND', 'BAD_REQUEST', 'RATE_LIMITED', 'UNAVAILABLE']),
  message: z.string(),
});
export const boardJoinedSchema = z.union([
  z.object({
    ok: z.literal(true),
    boardId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  }),
  realtimeErrorSchema,
]);
export type BoardChanged = z.infer<typeof boardChangedSchema>;
export type BoardJoined = z.infer<typeof boardJoinedSchema>;
export const presenceSchema = z.object({
  boardId: z.string().uuid(),
  members: z
    .array(z.object({ id: z.string().uuid(), name: z.string(), avatarUrl: z.string().nullable() }))
    .max(200),
  totalOnline: z.number().int().nonnegative(),
});
export type BoardPresence = z.infer<typeof presenceSchema>;
