import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from './api';
export const kanbanKeys = ['boards', 'board', 'task', 'tasks', 'labels', 'project-overview'];
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
