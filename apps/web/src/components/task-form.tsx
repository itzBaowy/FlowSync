'use client';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  labelSchema,
  scopeMemberSchema,
  taskInputSchema,
  taskPrioritySchema,
  taskUpdateSchema,
  type BoardSnapshot,
  type TaskDetail,
} from '@flowsync/contracts';
import { api } from '@/lib/api';
import { errorMessage, paged } from '@/lib/organizations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, Notice, Pager, selectClass } from './organization-ui';
export function TaskForm({
  board,
  task,
  pending,
  onSubmit,
}: {
  board: BoardSnapshot;
  task?: TaskDetail;
  pending: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [assignees, setAssignees] = useState(
    () => new Map(task?.assignees.map((user) => [user.id, user.name]) ?? []),
  );
  const [selectedLabels, setSelectedLabels] = useState(
    () => new Set(task?.labels.map((label) => label.id) ?? []),
  );
  const members = useQuery({
    queryKey: ['scope-members', 'task-candidates', board.projectId, page, search],
    queryFn: () =>
      paged(
        `/projects/${board.projectId}/members?limit=10&page=${page}&search=${encodeURIComponent(search)}&sort=name&order=asc`,
        scopeMemberSchema,
      ),
  });
  const labels = useQuery({
    queryKey: ['labels', board.projectId],
    queryFn: async () =>
      z.array(labelSchema).parse(await api(`/projects/${board.projectId}/labels`)),
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    const body = {
      title: values.get('title'),
      description: values.get('description') || null,
      priority: values.get('priority'),
      dueDate: values.get('dueDate') ? `${values.get('dueDate')}T00:00:00.000Z` : null,
      assigneeIds: [...assignees.keys()],
      labelIds: [...selectedLabels],
    };
    try {
      await onSubmit(
        task
          ? taskUpdateSchema.parse({ ...body, expectedVersion: task.version })
          : taskInputSchema.parse({ ...body, columnId: values.get('columnId') }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  const prefix = `task-${task?.id ?? 'new'}`;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Notice error={error ?? members.error ?? labels.error} />
      <Field label="Task title" id={`${prefix}-title`}>
        <Input
          id={`${prefix}-title`}
          name="title"
          defaultValue={task?.title}
          required
          maxLength={240}
          autoFocus
        />
      </Field>
      <Field label="Task description" id={`${prefix}-description`}>
        <textarea
          id={`${prefix}-description`}
          name="description"
          defaultValue={task?.description ?? ''}
          maxLength={20000}
          rows={3}
          className={`${selectClass} h-auto py-3`}
        />
      </Field>
      {!task && (
        <Field label="Task column" id={`${prefix}-column`}>
          <select id={`${prefix}-column`} name="columnId" className={selectClass}>
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task priority" id={`${prefix}-priority`}>
          <select
            id={`${prefix}-priority`}
            name="priority"
            defaultValue={task?.priority ?? 'MEDIUM'}
            className={selectClass}
          >
            {taskPrioritySchema.options.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
        </Field>
        <Field label="Task due date" id={`${prefix}-due`}>
          <Input
            id={`${prefix}-due`}
            name="dueDate"
            type="date"
            defaultValue={task?.dueDate?.slice(0, 10) ?? ''}
          />
        </Field>
      </div>
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Assignees (up to 20)</legend>
        <div className="flex flex-wrap gap-2">
          {[...assignees].map(([id, name]) => (
            <Button
              type="button"
              size="sm"
              variant="outline"
              key={id}
              aria-label={`Unassign ${name}`}
              onClick={() =>
                setAssignees((current) => {
                  const next = new Map(current);
                  next.delete(id);
                  return next;
                })
              }
            >
              {name} / Remove
            </Button>
          ))}
          {assignees.size === 0 && <p className="text-xs text-muted-foreground">Unassigned</p>}
        </div>
        <Input
          aria-label="Search task assignees"
          value={search}
          placeholder="Search project members"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {members.data?.data.map(({ user }) => (
          <label key={user.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={assignees.has(user.id)}
              disabled={!assignees.has(user.id) && assignees.size >= 20}
              onChange={(event) =>
                setAssignees((current) => {
                  const next = new Map(current);
                  if (event.target.checked) next.set(user.id, user.name);
                  else next.delete(user.id);
                  return next;
                })
              }
            />
            {user.name} <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </label>
        ))}
        <Pager
          meta={members.data?.meta}
          page={page}
          onPage={setPage}
          disabled={members.isFetching}
        />
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Labels (up to 20)</legend>
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {labels.data?.map((label) => (
            <label key={label.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedLabels.has(label.id)}
                disabled={!selectedLabels.has(label.id) && selectedLabels.size >= 20}
                onChange={(event) =>
                  setSelectedLabels((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(label.id);
                    else next.delete(label.id);
                    return next;
                  })
                }
              />
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />
              {label.name}
            </label>
          ))}
        </div>
        {labels.data?.length === 0 && (
          <p className="text-xs text-muted-foreground">No project labels yet.</p>
        )}
      </fieldset>
      <Button disabled={pending}>{task ? 'Save task' : 'Create task now'}</Button>
    </form>
  );
}
