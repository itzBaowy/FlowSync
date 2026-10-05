import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
export function useScopeAction() {
  const client = useQueryClient();
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
      await Promise.all(
        [
          'workspaces',
          'workspace',
          'projects',
          'project',
          'scope-parent',
          'scope-members',
          'project-overview',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(message);
    },
  });
}
