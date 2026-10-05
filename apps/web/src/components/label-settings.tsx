'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { labelSchema } from '@flowsync/contracts';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice } from './organization-ui';
export function LabelSettings({ projectId }: { projectId: string }) {
  const action = useKanbanAction();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<z.infer<typeof labelSchema> | null>(null);
  const labels = useQuery({
    queryKey: ['labels', projectId],
    queryFn: async () => z.array(labelSchema).parse(await api(`/projects/${projectId}/labels`)),
  });
  async function change(path: string, method: string, body?: unknown) {
    setError(null);
    try {
      await action.mutateAsync({ path, method, body, message: 'Project labels updated' });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  const path = `/projects/${projectId}/labels`;
  return (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Project labels</summary>
      <div className="mt-4 space-y-3">
        <Notice error={error ?? labels.error} />
        {labels.data?.map((label) => (
          <form
            key={`${label.id}-${label.name}-${label.color}`}
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              await change(`${path}/${label.id}`, 'PATCH', {
                name: values.get('name'),
                color: values.get('color'),
              });
            }}
          >
            <Field label="Label name" id={`label-${label.id}`}>
              <Input
                id={`label-${label.id}`}
                name="name"
                defaultValue={label.name}
                maxLength={80}
                required
              />
            </Field>
            <Field label="Label color" id={`color-${label.id}`}>
              <Input
                id={`color-${label.id}`}
                name="color"
                type="color"
                defaultValue={label.color}
              />
            </Field>
            <Button size="sm" disabled={action.isPending}>
              Save label
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={() => setDeleting(label)}>
              Delete label
            </Button>
          </form>
        ))}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            if (
              await change(path, 'POST', { name: values.get('name'), color: values.get('color') })
            )
              form.reset();
          }}
        >
          <Field label="New label name" id="new-label">
            <Input id="new-label" name="name" required maxLength={80} />
          </Field>
          <Field label="New label color" id="new-label-color">
            <Input id="new-label-color" name="color" type="color" defaultValue="#64748b" />
          </Field>
          <Button disabled={action.isPending}>Add label</Button>
        </form>
        <Confirm
          prompt={
            deleting
              ? {
                  title: 'Delete label?',
                  description: `Remove "${deleting.name}" from this project and all its tasks.`,
                }
              : null
          }
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting) void change(`${path}/${deleting.id}`, 'DELETE');
          }}
        />
      </div>
    </details>
  );
}
