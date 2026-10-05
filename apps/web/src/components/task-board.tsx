'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taskPrioritySchema, taskSchema, type BoardSnapshot } from '@flowsync/contracts';
import { paged } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Notice, Pager, selectClass } from './organization-ui';
import { TaskForm } from './task-form';
import { TaskPanel } from './task-panel';
export function TaskBoard({ board }: { board: BoardSnapshot }) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [columnId, setColumnId] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const filtered = !!(search || priority || columnId || archived);
  const action = useKanbanAction();
  const listing = useQuery({
    queryKey: ['tasks', board.id, search, priority, columnId, archived, page],
    queryFn: () =>
      paged(
        `/tasks?boardId=${board.id}&limit=20&page=${page}&search=${encodeURIComponent(search)}&archived=${archived}${priority ? `&priority=${priority}` : ''}${columnId ? `&columnId=${columnId}` : ''}`,
        taskSchema,
      ),
    enabled: filtered,
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setCreating(!creating)} disabled={board.columns.length === 0}>
          New task
        </Button>
        <Input
          className="sm:max-w-xs"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter task priority"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value);
            setPage(1);
          }}
          className={`${selectClass} sm:max-w-40`}
        >
          <option value="">All priorities</option>
          {taskPrioritySchema.options.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter task column"
          value={columnId}
          onChange={(event) => {
            setColumnId(event.target.value);
            setPage(1);
          }}
          className={`${selectClass} sm:max-w-40`}
        >
          <option value="">All columns</option>
          {board.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
          />
          Archived tasks
        </label>
      </div>
      <Notice error={error ?? listing.error} />
      {creating && (
        <section className="max-w-xl rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-semibold">Create a task</h3>
          <TaskForm
            board={board}
            pending={action.isPending}
            onSubmit={async (body) => {
              const { data } = await action.mutateAsync({
                path: '/tasks',
                method: 'POST',
                body,
                message: 'Task created',
              });
              setCreating(false);
              setSelected(taskSchema.parse(data).id);
            }}
          />
        </section>
      )}
      {filtered ? (
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Task results">
          {listing.isFetching && <p role="status">Loading tasks...</p>}
          {listing.data?.data.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">No matching tasks.</p>
          )}
          {listing.data?.data.map((task) => (
            <button
              key={task.id}
              onClick={() => setSelected(task.id)}
              className="block w-full border-b border-border p-3 text-left hover:bg-muted"
            >
              <span className="break-words text-sm font-medium">{task.title}</span>
              <span className="ml-3 text-xs text-muted-foreground">
                {task.priority} / {task.status}
              </span>
            </button>
          ))}
          <Pager
            meta={listing.data?.meta}
            page={page}
            onPage={setPage}
            disabled={listing.isFetching}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setPriority('');
              setColumnId('');
              setArchived(false);
            }}
          >
            Back to board
          </Button>
        </section>
      ) : (
        <div className="flex min-w-0 gap-4 overflow-x-auto pb-5" aria-label="Kanban columns">
          {board.columns.map((column) => (
            <section
              key={column.id}
              aria-label={column.name}
              className="w-72 shrink-0 space-y-3 rounded-xl border border-border bg-muted/30 p-3"
            >
              <h3 className="font-semibold">
                {column.name}{' '}
                <span className="text-xs text-muted-foreground">{column.totalTasks}</span>
              </h3>
              {column.tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelected(task.id)}
                  className="block w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm hover:border-primary"
                >
                  <span className="block break-words text-sm font-medium">{task.title}</span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {task.priority}
                    {task.dueDate ? ` / Due ${task.dueDate.slice(0, 10)}` : ''}
                  </span>
                  {task.assignees.length > 0 && (
                    <span className="mt-2 block truncate text-xs text-muted-foreground">
                      {task.assignees.map((user) => user.name).join(', ')}
                    </span>
                  )}
                </button>
              ))}
              {column.tasks.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground">No tasks yet</p>
              )}
              {column.totalTasks > column.tasks.length && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setColumnId(column.id);
                    setPage(1);
                  }}
                >
                  Browse all {column.totalTasks} tasks
                </Button>
              )}
            </section>
          ))}
        </div>
      )}
      {selected && (
        <TaskPanel
          key={selected}
          id={selected}
          board={board}
          onClose={() => {
            setSelected(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
