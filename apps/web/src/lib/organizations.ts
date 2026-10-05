import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiEnvelope } from './api';

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof paginationSchema>;
export async function paged<T>(path: string, schema: z.ZodType<T>) {
  const response = await apiEnvelope<unknown>(path);
  return {
    data: z.array(schema).parse(response.data),
    meta: paginationSchema.parse(response.meta),
  };
}
export function useOrganizationAction(id?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method,
      body,
      message,
    }: {
      path: string;
      method: string;
      body?: unknown;
      message: string;
    }) =>
      api<unknown>(path, {
        method,
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      }).then((data) => ({ data, message })),
    onSuccess: async ({ message }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['organizations'] }),
        client.invalidateQueries({ queryKey: ['organization', id] }),
        client.invalidateQueries({ queryKey: ['members', id] }),
        client.invalidateQueries({ queryKey: ['invitations', id] }),
      ]);
      toast.success(message);
    },
  });
}
export function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the form values';
  return error instanceof Error ? error.message : 'Please try again';
}
