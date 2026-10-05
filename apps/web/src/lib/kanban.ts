import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from './api';
import { z } from 'zod';
import {
  taskDetailSchema,
  type BoardSnapshot,
  type Task,
  type TaskMove,
} from '@flowsync/contracts';
import { errorMessage } from './organizations';
export const kanbanKeys = [
  'boards',
  'board',
  'task',
  'tasks',
  'labels',
  'project-overview',
  'comments',
  'activities',
];
export function useKanbanAction() {
  const client = useQueryClient();
  const invalidate = () =>
    Promise.all(kanbanKeys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  return useMutation({
    mutationFn: async ({
      path,
      method,
      body,
      message,
    }: {
      path: string;
      method: string;
      body?: unknown;
      message: string;
    }) => ({
      data: await api<unknown>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      message,
    }),
    onSuccess: async ({ message }) => {
      await invalidate();
      toast.success(message);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await invalidate();
    },
  });
}
export function useKanbanMove(boardId: string) {
  const client = useQueryClient();
  const key = ['board', boardId];
  return useMutation({
    mutationFn: async ({ task, body }: { task: Task; body: TaskMove }) =>
      z
        .object({ task: taskDetailSchema, revision: z.number().int() })
        .parse(
          await api(`/tasks/${task.id}/move`, { method: 'PATCH', body: JSON.stringify(body) }),
        ),
    onMutate: async ({ task, body }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<BoardSnapshot>(key);
      if (previous)
        client.setQueryData<BoardSnapshot>(key, {
          ...previous,
          revision: previous.revision + 1,
          columns: previous.columns.map((column) => {
            const tasks = column.tasks.filter((row) => row.id !== task.id);
            let totalTasks = column.totalTasks - (column.id === task.columnId ? 1 : 0);
            if (column.id === body.columnId) {
              const before = body.beforeTaskId
                ? tasks.findIndex((row) => row.id === body.beforeTaskId)
                : -1;
              tasks.splice(before < 0 ? tasks.length : before, 0, {
                ...task,
                columnId: column.id,
                status: column.kind,
                version: task.version + 1,
              });
              totalTasks += 1;
            }
            return { ...column, tasks, totalTasks };
          }),
        });
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () =>
      Promise.all(kanbanKeys.map((name) => client.invalidateQueries({ queryKey: [name] }))),
  });
}
