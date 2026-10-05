'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taskDetailSchema, type BoardSnapshot } from '@flowsync/contracts';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, selectClass } from './organization-ui';
import { TaskForm } from './task-form';
export function TaskPanel({
  id,
  board,
  onClose,
}: {
  id: string;
  board: BoardSnapshot;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [optimisticItems, setOptimisticItems] = useState(new Map<string, boolean>());
  const action = useKanbanAction();
  const detail = useQuery({
    queryKey: ['task', id],
    queryFn: async () => taskDetailSchema.parse(await api(`/tasks/${id}`)),
    retry: false,
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function change(path: string, method: string, body: unknown, message: string) {
    setError(null);
    try {
      await action.mutateAsync({ path, method, body, message });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  const task = detail.data;
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-labelledby={headingId}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/50 sm:p-7"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          Task details
        </h2>
        <Button variant="outline" size="sm" onClick={onClose} autoFocus>
          Close task
        </Button>
      </div>
      <Notice error={error ?? detail.error} />
      {detail.isPending && <p role="status">Loading task...</p>}
      {task && (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">
            {task.status} / Version {task.version}
            {task.archivedAt ? ' / Archived' : ''}
          </p>
          {task.canEdit && !task.archivedAt ? (
            <TaskForm
              key={`${id}-${task.version}`}
              board={board}
              task={task}
              pending={action.isPending}
              onSubmit={async (body) => {
                await action.mutateAsync({
                  path: `/tasks/${id}`,
                  method: 'PATCH',
                  body,
                  message: 'Task saved',
                });
              }}
            />
          ) : (
            <div>
              <h3 className="break-words font-semibold">{task.title}</h3>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                {task.description ?? 'No description.'}
              </p>
              <p className="mt-3 text-sm">
                {task.priority}
                {task.dueDate ? ` / Due ${task.dueDate.slice(0, 10)}` : ''}
              </p>
              <p className="mt-3 text-sm">
                Assigned: {task.assignees.map((user) => user.name).join(', ') || 'Unassigned'}
              </p>
              <p className="mt-3 text-sm">
                Labels: {task.labels.map((label) => label.name).join(', ') || 'None'}
              </p>
            </div>
          )}
          {task.canEdit && !task.archivedAt && (
            <form
              className="flex flex-wrap items-end gap-3 border-t border-border pt-5"
              onSubmit={async (event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                await change(
                  `/tasks/${id}/move`,
                  'PATCH',
                  {
                    columnId: values.get('columnId'),
                    beforeTaskId: values.get('beforeTaskId') || null,
                    expectedVersion: task.version,
                    expectedRevision: board.revision,
                  },
                  'Task moved',
                );
              }}
            >
              <Field label="Move to column" id="task-move-column">
                <select
                  id="task-move-column"
                  name="columnId"
                  defaultValue={task.columnId}
                  className={selectClass}
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button disabled={action.isPending}>Move task to end</Button>
            </form>
          )}
          <section className="space-y-4 border-t border-border pt-5">
            <h3 className="font-semibold">Checklists</h3>
            {task.checklists.map((checklist) => (
              <div key={checklist.id} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">{checklist.title}</h4>
                  <span className="text-xs text-muted-foreground">
                    {checklist.items.filter((item) => item.completed).length} /{' '}
                    {checklist.items.length} completed
                  </span>
                </div>
                {checklist.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <label className="flex min-w-0 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={optimisticItems.get(item.id) ?? item.completed}
                        disabled={!task.canEdit || !!task.archivedAt || action.isPending}
                        onChange={async (event) => {
                          const completed = event.target.checked;
                          setOptimisticItems((current) => new Map(current).set(item.id, completed));
                          await change(
                            `/tasks/${id}/checklist-items/${item.id}`,
                            'PATCH',
                            { completed, expectedVersion: task.version },
                            'Checklist updated',
                          );
                          setOptimisticItems((current) => {
                            const next = new Map(current);
                            next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                      <span
                        className={`break-words ${item.completed ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {item.text}
                      </span>
                    </label>
                    {task.canEdit && !task.archivedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.isPending}
                        aria-label={`Delete item ${item.text}`}
                        onClick={() =>
                          change(
                            `/tasks/${id}/checklist-items/${item.id}`,
                            'DELETE',
                            { expectedVersion: task.version },
                            'Item deleted',
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                {task.canEdit && !task.archivedAt && (
                  <>
                    <form
                      className="flex gap-2"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        if (
                          await change(
                            `/tasks/${id}/checklists/${checklist.id}/items`,
                            'POST',
                            { text: new FormData(form).get('text'), expectedVersion: task.version },
                            'Checklist item added',
                          )
                        )
                          form.reset();
                      }}
                    >
                      <Input
                        name="text"
                        aria-label={`New item in ${checklist.title}`}
                        required
                        maxLength={240}
                      />
                      <Button size="sm" disabled={action.isPending}>
                        Add item
                      </Button>
                    </form>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() =>
                        change(
                          `/tasks/${id}/checklists/${checklist.id}`,
                          'DELETE',
                          { expectedVersion: task.version },
                          'Checklist deleted',
                        )
                      }
                    >
                      Delete checklist
                    </Button>
                  </>
                )}
              </div>
            ))}
            {task.checklists.length === 0 && (
              <p className="text-sm text-muted-foreground">No checklists yet.</p>
            )}
            {task.canEdit && !task.archivedAt && (
              <form
                className="flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  if (
                    await change(
                      `/tasks/${id}/checklists`,
                      'POST',
                      { title: new FormData(form).get('title'), expectedVersion: task.version },
                      'Checklist created',
                    )
                  )
                    form.reset();
                }}
              >
                <Input name="title" aria-label="New checklist title" required maxLength={120} />
                <Button size="sm" disabled={action.isPending}>
                  Add checklist
                </Button>
              </form>
            )}
          </section>
          {task.canArchive && (
            <div className="flex gap-3 border-t border-border pt-5">
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  change(
                    `/tasks/${id}/archive`,
                    'PATCH',
                    { archived: !task.archivedAt, expectedVersion: task.version },
                    task.archivedAt ? 'Task restored' : 'Task archived',
                  )
                }
              >
                {task.archivedAt ? 'Restore task' : 'Archive task'}
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setDeleting(true)}
                disabled={action.isPending}
              >
                Delete task
              </Button>
            </div>
          )}
        </div>
      )}
      <Confirm
        prompt={
          deleting
            ? {
                title: 'Delete task?',
                description: `Permanently delete "${task?.title}" and its checklists.`,
              }
            : null
        }
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          if (
            task &&
            (await change(
              `/tasks/${id}`,
              'DELETE',
              { expectedVersion: task.version },
              'Task deleted',
            ))
          )
            onClose();
        }}
      />
    </dialog>
  );
}
