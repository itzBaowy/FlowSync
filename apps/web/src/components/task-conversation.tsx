'use client';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  commentInputSchema,
  commentSchema,
  scopeMemberSchema,
  type Comment,
  type TaskDetail,
} from '@flowsync/contracts';
import { errorMessage, paged } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';
function CommentText({ comment }: { comment: Comment }) {
  const parts = comment.text.split(/(@\[[^\]\r\n]{1,80}\]\([0-9a-f-]{36}\))/gi);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((part, index) => {
        const id = /\(([0-9a-f-]{36})\)$/i.exec(part)?.[1]?.toLowerCase();
        const user = id ? comment.mentions.find((member) => member.id === id) : undefined;
        return user ? (
          <span key={index} className="font-medium text-primary">
            @{user.name}
          </span>
        ) : (
          part
        );
      })}
    </p>
  );
}
export function TaskConversation({ task, projectId }: { task: TaskDetail; projectId: string }) {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const action = useKanbanAction();
  const listing = useQuery({
    queryKey: ['comments', task.id, page],
    queryFn: () =>
      paged(`/tasks/${task.id}/comments?page=${page}&limit=10&order=desc`, commentSchema),
  });
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
  return (
    <section aria-label="Task comments" className="space-y-4 border-t border-border pt-5">
      <h3 className="font-semibold">Comments</h3>
      <Notice error={error || listing.error} />
      {!task.archivedAt && (
        <CommentComposer
          key={composerKey}
          projectId={projectId}
          pending={action.isPending}
          onSubmit={async (text) => {
            if (await change(`/tasks/${task.id}/comments`, 'POST', { text }, 'Comment posted')) {
              setComposerKey((value) => value + 1);
              setPage(1);
            }
          }}
        />
      )}
      {task.archivedAt && (
        <p className="text-sm text-muted-foreground">Restore the task to add or edit comments.</p>
      )}
      {listing.isPending && <p className="text-sm text-muted-foreground">Loading comments...</p>}
      {listing.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Start the conversation.</p>
      )}
      {!listing.error &&
        listing.data?.data.map((comment) => (
          <article
            key={comment.id}
            aria-label={`Comment by ${comment.author?.name ?? 'Former member'}`}
            className="space-y-3 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {comment.author?.name ?? 'Former member'}
              </span>
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString()}
                {comment.version > 0 ? ' · Edited' : ''}
              </time>
            </div>
            {editing?.id === comment.id ? (
              <>
                {editing.version !== comment.version && (
                  <Notice error="This comment changed while you were editing. Your draft is preserved; cancel to load the latest version." />
                )}
                <CommentComposer
                  key={`${editing.id}-${editing.version}`}
                  projectId={projectId}
                  initialText={editing.text}
                  pending={action.isPending}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (text) => {
                    if (
                      await change(
                        `/tasks/${task.id}/comments/${comment.id}`,
                        'PATCH',
                        { text, expectedVersion: editing.version },
                        'Comment saved',
                      )
                    )
                      setEditing(null);
                  }}
                />
              </>
            ) : (
              <>
                <CommentText comment={comment} />
                <div className="flex gap-2">
                  {comment.canEdit && !task.archivedAt && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(comment)}>
                      Edit comment
                    </Button>
                  )}
                  {comment.canDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      className="text-destructive"
                      onClick={() => setDeleting(comment)}
                    >
                      Delete comment
                    </Button>
                  )}
                </div>
              </>
            )}
          </article>
        ))}
      <Pager meta={listing.data?.meta} page={page} onPage={setPage} disabled={listing.isFetching} />
      <Confirm
        prompt={
          deleting
            ? {
                title: 'Delete comment?',
                description:
                  'Permanently remove this comment and its mentions. Activity history is retained.',
              }
            : null
        }
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting)
            await change(
              `/tasks/${task.id}/comments/${deleting.id}`,
              'DELETE',
              { expectedVersion: deleting.version },
              'Comment deleted',
            );
        }}
      />
    </section>
  );
}
function CommentComposer({
  projectId,
  initialText = '',
  pending,
  onSubmit,
  onCancel,
}: {
  projectId: string;
  initialText?: string;
  pending: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const members = useQuery({
    queryKey: ['scope-members', 'mentions', projectId, page, search],
    enabled: selecting,
    queryFn: () =>
      paged(
        `/projects/${projectId}/members?limit=10&page=${page}&search=${encodeURIComponent(search)}&sort=name&order=asc`,
        scopeMemberSchema,
      ),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          await onSubmit(commentInputSchema.parse({ text }).text);
        } catch (cause) {
          setError(errorMessage(cause));
        }
      }}
    >
      <Notice error={error || members.error} />
      <Field label={onCancel ? 'Edit comment text' : 'Comment text'} id={id}>
        <textarea
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
          maxLength={10000}
          rows={3}
          className={`${selectClass} h-auto py-3`}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {onCancel ? 'Save comment' : 'Post comment'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSelecting(!selecting)}
          aria-expanded={selecting}
        >
          Mention a member
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel editing
          </Button>
        )}
      </div>
      {selecting && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Input
            aria-label="Search mention members"
            placeholder="Search project members"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          {members.data?.data.map((member) => (
            <Button
              type="button"
              key={member.userId}
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setText(
                  (value) =>
                    `${value}${value && !/\s$/.test(value) ? ' ' : ''}@[${member.user.name.replaceAll(']', '')}](${member.userId}) `,
                );
                setSelecting(false);
              }}
            >
              Mention {member.user.name}
            </Button>
          ))}
          <Pager
            meta={members.data?.meta}
            page={page}
            onPage={setPage}
            disabled={members.isFetching}
          />
        </div>
      )}
    </form>
  );
}
