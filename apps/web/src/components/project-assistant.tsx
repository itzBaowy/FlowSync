'use client';
import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aiAvailabilitySchema,
  aiRequestSchema,
  aiRunSchema,
  boardSchema,
  boardSnapshotSchema,
  memberSchema,
  type AIRun,
  type AIRequest,
} from '@flowsync/contracts';
import { api, refreshSession } from '@/lib/api';
import { paged } from '@/lib/organizations';
import { kanbanKeys } from '@/lib/kanban';
import { Button } from './ui/button';
import { Field, Notice, Pager, Confirm, selectClass } from './organization-ui';
const prompts: Record<AIRequest['kind'], string> = {
  SUMMARY: 'What changed in this project during the last 24 hours?',
  OVERDUE: 'Which important tasks are overdue, and what should we address first?',
  MEETING_NOTES: '',
};
export function ProjectAssistant({ projectId }: { projectId: string }) {
  const id = useId();
  const client = useQueryClient();
  const [kind, setKind] = useState<AIRequest['kind']>('SUMMARY');
  const [prompt, setPrompt] = useState(prompts.SUMMARY);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(1);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    staleTime: Infinity,
    retry: false,
  });
  const userId = session.data?.user.id;
  const base = `/projects/${projectId}/ai`;
  const key = ['ai', userId, projectId];
  const availability = useQuery({
    queryKey: [...key, 'availability'],
    enabled: !!userId,
    queryFn: async () => aiAvailabilitySchema.parse(await api(`${base}/availability`)),
    retry: false,
  });
  const history = useQuery({
    queryKey: [...key, 'history', page],
    enabled: !!userId,
    queryFn: () => paged(`${base}/requests?page=${page}&limit=5`, aiRunSchema),
    refetchInterval: (query) =>
      query.state.data?.data.some((run) => ['PENDING', 'RUNNING'].includes(run.status))
        ? 3000
        : false,
  });
  const result = useQuery({
    queryKey: [...key, selected],
    enabled: !!userId && !!selected,
    queryFn: async () => aiRunSchema.parse(await api(`${base}/requests/${selected}`)),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && ['PENDING', 'RUNNING'].includes(query.state.data.status) ? 2000 : false,
  });
  const create = useMutation({
    mutationFn: async () =>
      aiRunSchema.parse(
        await api(`${base}/requests`, {
          method: 'POST',
          body: JSON.stringify(aiRequestSchema.parse({ kind, prompt })),
        }),
      ),
    onSuccess: async (run) => {
      setSelected(run.id);
      setPage(1);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <section
      aria-label="Project assistant"
      className="space-y-5 rounded-xl border border-border bg-card p-6"
    >
      <div>
        <h2 className="text-lg font-semibold">Project assistant</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Summarize progress, review overdue work, or turn meeting notes into task suggestions.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your conversations are private. Suggestions create tasks only after you confirm.
        </p>
      </div>
      <Notice error={availability.error || history.error || create.error || result.error} />
      {availability.data && !availability.data.enabled && (
        <p role="status" className="text-sm text-muted-foreground">
          The assistant is unavailable. Contact your workspace admin.
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Assistant mode" id={`${id}-mode`}>
          <select
            id={`${id}-mode`}
            className={selectClass}
            value={kind}
            onChange={(event) => {
              const mode = event.target.value as AIRequest['kind'];
              setKind(mode);
              setPrompt(prompts[mode]);
            }}
          >
            <option value="SUMMARY">Project summary</option>
            <option value="OVERDUE">Overdue analysis</option>
            <option value="MEETING_NOTES">Meeting notes to tasks</option>
          </select>
        </Field>
        <Field
          label={kind === 'MEETING_NOTES' ? 'Meeting notes' : 'Ask about this project'}
          id={`${id}-prompt`}
        >
          <textarea
            id={`${id}-prompt`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            required
            minLength={2}
            maxLength={16000}
            rows={4}
            disabled={!availability.data?.enabled || create.isPending}
            className="w-full rounded-lg border border-border bg-background p-3 text-sm disabled:opacity-50"
          />
        </Field>
        <Button
          type="submit"
          disabled={!availability.data?.enabled || create.isPending || prompt.trim().length < 2}
        >
          {create.isPending
            ? 'Sending...'
            : kind === 'MEETING_NOTES'
              ? 'Suggest tasks'
              : 'Ask assistant'}
        </Button>
      </form>
      {!!history.data?.data.length && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Your recent requests</h3>
          {history.data.data.map((run) => (
            <button
              type="button"
              key={run.id}
              onClick={() => setSelected(run.id)}
              aria-pressed={selected === run.id}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0 truncate">{run.prompt}</span>
              <span className="text-xs text-muted-foreground">{run.status.toLowerCase()}</span>
            </button>
          ))}
          <Pager
            meta={history.data.meta}
            page={page}
            onPage={setPage}
            disabled={history.isFetching}
          />
        </div>
      )}
      {selected && result.isPending && (
        <p role="status" className="text-sm">
          Loading your request...
        </p>
      )}
      {result.data && !result.error && (
        <AssistantResult
          key={result.data.id}
          run={result.data}
          projectId={projectId}
          userId={userId!}
        />
      )}
    </section>
  );
}
function AssistantResult({
  run,
  projectId,
  userId,
}: {
  run: AIRun;
  projectId: string;
  userId: string;
}) {
  const id = useId();
  const client = useQueryClient();
  const [indexes, setIndexes] = useState<number[]>([]);
  const [boardId, setBoardId] = useState('');
  const [boardPage, setBoardPage] = useState(1);
  const [columnId, setColumnId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const suggestions = run.output?.suggestions ?? [];
  const preview = run.status === 'COMPLETED' && run.kind === 'MEETING_NOTES' && !run.confirmedAt;
  const boards = useQuery({
    queryKey: ['ai-boards', userId, projectId, boardPage],
    enabled: preview,
    queryFn: () => paged(`/boards?projectId=${projectId}&page=${boardPage}&limit=20`, boardSchema),
  });
  const board = useQuery({
    queryKey: ['ai-board', userId, projectId, boardId],
    enabled: preview && !!boardId,
    queryFn: async () => boardSnapshotSchema.parse(await api(`/boards/${boardId}`)),
    retry: false,
  });
  const members = useQuery({
    queryKey: ['ai-members', userId, projectId],
    enabled: suggestions.length > 0,
    queryFn: () => paged(`/projects/${projectId}/members?limit=100`, memberSchema),
  });
  const create = useMutation({
    mutationFn: async () =>
      aiRunSchema.parse(
        await api(`/projects/${projectId}/ai/requests/${run.id}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ confirmed: true, columnId, suggestionIndexes: indexes }),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['ai', userId, projectId] }),
        ...kanbanKeys.map((key) => client.invalidateQueries({ queryKey: [key] })),
        ...['dashboard', 'my-tasks', 'search', 'notifications'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      ]);
    },
  });
  const names = new Map(members.data?.data.map((member) => [member.user.id, member.user.name]));
  return (
    <div className="space-y-4 border-t border-border pt-5">
      {['PENDING', 'RUNNING'].includes(run.status) && (
        <p role="status" className="text-sm">
          The assistant is reviewing this project...
        </p>
      )}
      {run.status === 'FAILED' && <Notice error={run.error} />}
      {run.status === 'CANCELLED' && (
        <p role="status" className="text-sm">
          This request could not continue because project access changed.
        </p>
      )}
      {run.output && (
        <>
          <h3 className="font-semibold">{run.output.headline}</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {run.output.bullets.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
          {!!run.output.risks.length && (
            <div>
              <h4 className="text-sm font-medium">Risks and unknowns</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {run.output.risks.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          {!!run.output.references.length && (
            <details className="text-sm">
              <summary>Related work</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {run.output.references.map((reference, i) => (
                  <li key={i}>{reference.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {suggestions.map((suggestion, index) => (
        <article key={index} className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <label className="flex items-start gap-3 font-medium">
            <input
              type="checkbox"
              checked={indexes.includes(index)}
              disabled={!preview || create.isPending}
              onChange={(event) =>
                setIndexes((old) =>
                  event.target.checked ? [...old, index] : old.filter((value) => value !== index),
                )
              }
            />
            {suggestion.title}
          </label>
          {suggestion.description && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {suggestion.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {suggestion.priority.toLowerCase()} priority ·{' '}
            {suggestion.dueDate
              ? `Due ${new Date(suggestion.dueDate).toLocaleDateString()}`
              : 'No deadline'}{' '}
            ·{' '}
            {suggestion.assigneeIds.length
              ? suggestion.assigneeIds.map((id) => names.get(id) ?? 'Former member').join(', ')
              : 'Unassigned'}
          </p>
        </article>
      ))}
      {preview && suggestions.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Task destination</legend>
          <Field label="Destination board" id={`${id}-board`}>
            <select
              id={`${id}-board`}
              className={selectClass}
              value={boardId}
              disabled={create.isPending}
              onChange={(event) => {
                setBoardId(event.target.value);
                setColumnId('');
              }}
            >
              <option value="">Choose a board</option>
              {boards.data?.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          {boards.data && boards.data.meta.totalPages > 1 && (
            <Pager
              meta={boards.data.meta}
              page={boardPage}
              onPage={setBoardPage}
              disabled={boards.isFetching}
            />
          )}
          <Field label="Destination column" id={`${id}-column`}>
            <select
              id={`${id}-column`}
              className={selectClass}
              value={columnId}
              disabled={!board.data || !!board.error || create.isPending}
              onChange={(event) => setColumnId(event.target.value)}
            >
              <option value="">Choose a column</option>
              {!board.error &&
                board.data?.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
            </select>
          </Field>
          <Notice error={boards.error || board.error || members.error || create.error} />
          <Button
            disabled={!columnId || !indexes.length || create.isPending}
            onClick={() => setConfirming(true)}
          >
            Create {indexes.length} selected {indexes.length === 1 ? 'task' : 'tasks'}
          </Button>
        </fieldset>
      )}
      {run.confirmedAt && (
        <p role="status" className="text-sm">
          {run.confirmedTaskIds.length} {run.confirmedTaskIds.length === 1 ? 'task' : 'tasks'}{' '}
          created.{' '}
          <Link
            className="text-primary hover:underline"
            href={`/boards?projectId=${projectId}${boardId ? `&id=${boardId}` : ''}`}
          >
            Open boards
          </Link>
        </p>
      )}
      <Confirm
        prompt={
          confirming
            ? {
                title: 'Create suggested tasks?',
                description: `Create ${indexes.length} selected tasks with the shown assignments and deadlines in this column?`,
              }
            : null
        }
        onClose={() => setConfirming(false)}
        onConfirm={() => create.mutate()}
      />
    </div>
  );
}
