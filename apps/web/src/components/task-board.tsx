'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { taskPrioritySchema, taskSchema, type BoardSnapshot } from '@flowsync/contracts';
import { paged } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Notice, Pager, selectClass } from './organization-ui';
import { TaskForm } from './task-form';
import { TaskPanel } from './task-panel';
import { KanbanCanvas } from './kanban-canvas';
import { useBoardRealtime } from '@/lib/use-board-realtime';
export function TaskBoard({ board }: { board: BoardSnapshot }) {
  const router = useRouter();
  const params = useSearchParams();
  const taskId = params.get('taskId');
  const { status: realtime, presence } = useBoardRealtime(board.id);
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const selected = z.string().uuid().safeParse(taskId).success ? taskId : opened;
  const setSelected = (id: string | null) => {
    setOpened(id);
    if (taskId) {
      const next = new URLSearchParams(params);
      next.delete('taskId');
      router.replace(`/boards?${next}`, { scroll: false });
    }
  };
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
      <p className="text-xs text-muted-foreground" aria-label="Realtime status">
        {realtime === 'live'
          ? 'Live updates connected'
          : realtime === 'revoked'
            ? 'Board access revoked'
            : realtime === 'connecting'
              ? 'Connecting live updates...'
              : 'Live updates disconnected. Reconnecting...'}
      </p>
      {presence && (
        <div
          aria-label="Online board members"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <span>{presence.totalOnline} online</span>
          {presence.members.map((member) => (
            <span
              key={member.id}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-1"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              {member.name}
            </span>
          ))}
        </div>
      )}
      {realtime === 'revoked' ? (
        <Notice error="You no longer have access to this board." />
      ) : (
        <>
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
            <section
              className="rounded-xl border border-border bg-card p-4"
              aria-label="Task results"
            >
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
            <KanbanCanvas
              board={board}
              onOpen={setSelected}
              onBrowse={(id) => {
                setColumnId(id);
                setPage(1);
              }}
            />
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
        </>
      )}
    </div>
  );
}
