'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Columns3, Plus, ArrowUpRight } from 'lucide-react';
import { z } from 'zod';
import {
  boardInputSchema,
  boardSchema,
  boardSnapshotSchema,
  columnKindSchema,
  projectSchema,
  type BoardSnapshot,
} from '@flowsync/contracts';
import { api, ApiError, refreshSession } from '@/lib/api';
import { errorMessage, paged } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';
import { WorkspaceShell } from './workspace-shell';
import { EmptyState } from './workspace-ui';
import { TaskBoard } from './task-board';
import { LabelSettings } from './label-settings';
export function BoardHub() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get('projectId');
  const selected = params.get('id');
  const valid = z.string().uuid().safeParse(projectId).success;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useKanbanAction();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => projectSchema.parse(await api(`/projects/${projectId}`)),
    enabled: !!session.data && valid,
    retry: false,
  });
  const listing = useQuery({
    queryKey: ['boards', projectId, page, search],
    queryFn: () =>
      paged(
        `/boards?projectId=${projectId}&page=${page}&limit=10&search=${encodeURIComponent(search)}`,
        boardSchema,
      ),
    enabled: !!project.data,
  });
  const detail = useQuery({
    queryKey: ['board', selected],
    queryFn: async () => {
      const board = boardSnapshotSchema.parse(await api(`/boards/${selected}`));
      if (board.projectId !== projectId)
        throw new ApiError('Board does not belong to this project', 404, 'RESOURCE_NOT_FOUND');
      return board;
    },
    enabled: !!project.data && !!selected,
    retry: false,
  });
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) router.replace('/login');
  }, [router, session.error]);
  const basePath = `/boards?projectId=${projectId}`;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const values = new FormData(event.currentTarget);
      const { data } = await action.mutateAsync({
        path: '/boards',
        method: 'POST',
        body: boardInputSchema.parse({ projectId, name: values.get('name') }),
        message: 'Board created',
      });
      setCreating(false);
      router.replace(`${basePath}&id=${boardSchema.parse(data).id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  if (!valid)
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Choose a project first</h1>
        <Link href="/organizations" className="mt-4 block text-primary">
          Open your organizations
        </Link>
      </main>
    );
  return (
    <WorkspaceShell
      title="Boards"
      wide
      back={{
        href: project.data
          ? `/projects?workspaceId=${project.data.workspaceId}&id=${projectId}`
          : '/organizations',
        label: `Back to ${project.data?.name ?? 'project'}`,
      }}
    >
      <main className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-primary">
              {project.data?.name}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Kanban boards</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              From the first idea to the final detail. Keep work flowing.
            </p>
          </div>
          {project.data?.canManage && (
            <Button onClick={() => setCreating(!creating)}>
              <Plus size={16} />
              Create board
            </Button>
          )}
        </div>
        <Notice error={session.error ?? project.error ?? listing.error ?? detail.error ?? error} />
        {creating && (
          <form
            onSubmit={create}
            className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-5"
          >
            <Field label="Board name" id="new-board-name">
              <Input id="new-board-name" name="name" required maxLength={120} autoFocus />
            </Field>
            <Button disabled={action.isPending}>Create board now</Button>
          </form>
        )}
        {project.data && (
          <div className="min-w-0 space-y-6">
            <section
              aria-label="Board navigation"
              className="min-w-0 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Columns3 size={16} className="text-primary" />
                  Project boards
                </span>
                <Input
                  className="h-10 sm:ml-auto sm:max-w-56"
                  aria-label="Search boards"
                  placeholder="Search boards"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              {listing.isPending && <p role="status">Loading boards...</p>}
              {listing.data?.data.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No boards found. Create one to organize your tasks.
                </p>
              )}
              <nav aria-label="Choose a board" className="mt-3 flex min-w-0 flex-wrap gap-2">
                {listing.data?.data.map((board) => (
                  <Link
                    key={board.id}
                    href={`${basePath}&id=${board.id}`}
                    aria-current={selected === board.id ? 'page' : undefined}
                    className={`inline-flex min-h-10 max-w-full items-center gap-2 break-words rounded-lg border px-4 py-2 text-xs font-medium ${selected === board.id ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                  >
                    <Columns3 size={14} className="shrink-0" />
                    {board.name}
                  </Link>
                ))}
              </nav>
              <Pager
                meta={listing.data?.meta}
                page={page}
                onPage={setPage}
                disabled={listing.isFetching}
              />
            </section>
            <section className="min-w-0 space-y-5">
              {detail.isFetching && (
                <p role="status" className="text-sm text-muted-foreground">
                  Refreshing board...
                </p>
              )}
              {detail.data && !detail.error ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">{detail.data.name}</h2>
                    <Link
                      href={`/projects?workspaceId=${project.data.workspaceId}&id=${projectId}#project-overview`}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      Project overview
                      <ArrowUpRight size={13} />
                    </Link>
                  </div>
                  <TaskBoard key={detail.data.id} board={detail.data} />
                  {detail.data.canManage && (
                    <div className="grid items-start gap-3 border-t border-border pt-5 xl:grid-cols-2">
                      <BoardSettings
                        board={detail.data}
                        onDeleted={() => router.replace(basePath)}
                      />
                      <LabelSettings projectId={detail.data.projectId} />
                    </div>
                  )}
                </>
              ) : (
                !selected && (
                  <div className="rounded-xl border border-dashed border-border bg-card">
                    <EmptyState
                      icon={Columns3}
                      title="A clear view of what’s next"
                      description="Select a board above to see its tasks, or create a board for your next project."
                    />
                  </div>
                )
              )}
            </section>
          </div>
        )}
      </main>
    </WorkspaceShell>
  );
}
function BoardSettings({ board, onDeleted }: { board: BoardSnapshot; onDeleted: () => void }) {
  const action = useKanbanAction();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ columnId?: string; name: string } | null>(
    null,
  );
  async function change(path: string, method: string, body?: unknown, message = 'Board updated') {
    setError(null);
    try {
      await action.mutateAsync({ path, method, body, message });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  async function reorder(index: number, offset: number) {
    const ids = board.columns.map((column) => column.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    await change(
      `/boards/${board.id}/columns/order`,
      'PATCH',
      { columnIds: ids, expectedRevision: board.revision },
      'Columns reordered',
    );
  }
  return (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Board settings</summary>
      <div className="mt-4 space-y-5">
        <Notice error={error} />
        <form
          key={board.name}
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            await change(`/boards/${board.id}`, 'PATCH', { name: values.get('name') });
          }}
        >
          <Field label="Board title" id="board-title">
            <Input
              id="board-title"
              name="name"
              required
              maxLength={120}
              defaultValue={board.name}
            />
          </Field>
          <Button disabled={action.isPending}>Save board</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmation({ name: board.name })}
          >
            Delete board
          </Button>
        </form>
        {board.columns.map((column, index) => (
          <form
            key={`${column.id}-${column.name}-${column.kind}`}
            className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              await change(
                `/boards/${board.id}/columns/${column.id}`,
                'PATCH',
                { name: values.get('name'), kind: values.get('kind') },
                'Column updated',
              );
            }}
          >
            <Field label="Column name" id={`column-${column.id}`}>
              <Input
                id={`column-${column.id}`}
                name="name"
                defaultValue={column.name}
                maxLength={80}
                required
              />
            </Field>
            <Field label="Column status" id={`kind-${column.id}`}>
              <select
                id={`kind-${column.id}`}
                name="kind"
                defaultValue={column.kind}
                className={selectClass}
              >
                {columnKindSchema.options.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </Field>
            <Button size="sm" disabled={action.isPending}>
              Save column
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={action.isPending || index === 0}
              aria-label={`Move ${column.name} left`}
              onClick={() => reorder(index, -1)}
            >
              Left
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={action.isPending || index === board.columns.length - 1}
              aria-label={`Move ${column.name} right`}
              onClick={() => reorder(index, 1)}
            >
              Right
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setConfirmation({ columnId: column.id, name: column.name })}
            >
              Delete column
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
              await change(
                `/boards/${board.id}/columns`,
                'POST',
                { name: values.get('name'), kind: values.get('kind') },
                'Column created',
              )
            )
              form.reset();
          }}
        >
          <Field label="New column name" id="new-column">
            <Input id="new-column" name="name" required maxLength={80} />
          </Field>
          <Field label="New column status" id="new-kind">
            <select id="new-kind" name="kind" className={selectClass}>
              {columnKindSchema.options.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <Button disabled={action.isPending}>Add column</Button>
        </form>
        <Confirm
          prompt={
            confirmation
              ? {
                  title: `Delete ${confirmation.columnId ? 'column' : 'board'}?`,
                  description: `Delete "${confirmation.name}". Active and archived tasks must be removed first.`,
                }
              : null
          }
          onClose={() => setConfirmation(null)}
          onConfirm={async () => {
            if (
              await change(
                `/boards/${board.id}${confirmation?.columnId ? `/columns/${confirmation.columnId}` : ''}`,
                'DELETE',
                undefined,
                'Deleted',
              )
            ) {
              if (!confirmation?.columnId) onDeleted();
            }
          }}
        />
      </div>
    </details>
  );
}
