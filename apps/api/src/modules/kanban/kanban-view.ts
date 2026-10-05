import type { Board, Prisma } from '../../generated/prisma/client';
export const taskInclude = {
  column: { select: { kind: true } },
  assignees: {
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { userId: 'asc' },
  },
  labels: { include: { label: true }, orderBy: { labelId: 'asc' } },
} as const satisfies Prisma.TaskInclude;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export const taskView = (row: TaskRow, userId: string, canManage: boolean) => ({
  id: row.id,
  columnId: row.columnId,
  title: row.title,
  description: row.description,
  priority: row.priority,
  status: row.column.kind,
  position: row.position.toString(),
  version: row.version,
  createdById: row.createdById,
  dueDate: row.dueDate?.toISOString() ?? null,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  canEdit:
    canManage ||
    row.createdById === userId ||
    row.assignees.some((assignee) => assignee.userId === userId),
  canArchive: canManage || row.createdById === userId,
  assignees: row.assignees.map((assignee) => assignee.user),
  labels: row.labels.map((label) => label.label),
});
export const boardView = (row: Board, canManage: boolean) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  revision: row.revision,
  canManage,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
