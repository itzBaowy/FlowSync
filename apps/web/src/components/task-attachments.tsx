'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attachmentSchema, attachmentDownloadSchema, type TaskDetail } from '@flowsync/contracts';
import { api } from '@/lib/api';
import { errorMessage, paged } from '@/lib/organizations';
import { useKanbanAction } from '@/lib/kanban';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Notice, Pager } from './organization-ui';
export function TaskAttachments({ task }: { task: TaskDetail }) {
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; filename: string } | null>(null);
  const action = useKanbanAction();
  const listing = useQuery({
    queryKey: ['attachments', task.id, page],
    queryFn: () =>
      paged(`/tasks/${task.id}/attachments?page=${page}&limit=10&order=desc`, attachmentSchema),
  });
  async function download(id: string) {
    setError(null);
    setDownloading(id);
    try {
      const file = attachmentDownloadSchema.parse(
        await api(`/tasks/${task.id}/attachments/${id}/download`),
      );
      const url = new URL(file.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid download address');
      const link = document.createElement('a');
      link.href = file.url;
      link.rel = 'noopener noreferrer';
      link.click();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDownloading(null);
    }
  }
  return (
    <section aria-label="Task attachments" className="space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">Attachments</h3>
      <Notice error={error || listing.error || action.error} />
      {!task.archivedAt && (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            const form = event.currentTarget;
            try {
              await action.mutateAsync({
                path: `/tasks/${task.id}/attachments`,
                method: 'POST',
                body: new FormData(form),
                message: 'Attachment uploaded',
              });
              form.reset();
              setPage(1);
            } catch (cause) {
              setError(errorMessage(cause));
            }
          }}
        >
          <Input
            type="file"
            name="file"
            aria-label="Choose task attachment"
            required
            accept="image/png,image/jpeg,image/webp,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, PDF, DOCX or ZIP · Up to 10 MiB · 20 files per task
          </p>
          <Button size="sm" disabled={action.isPending}>
            Upload attachment
          </Button>
        </form>
      )}
      {listing.isPending && <p className="text-sm text-muted-foreground">Loading attachments...</p>}
      {listing.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No attachments yet.</p>
      )}
      {!listing.error &&
        listing.data?.data.map((file) => (
          <article
            key={file.id}
            aria-label={`Attachment ${file.filename}`}
            className="space-y-2 rounded-lg border border-border p-3 text-sm"
          >
            <p className="break-words font-medium">{file.filename}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KiB · {file.uploadedBy?.name ?? 'Former member'} ·{' '}
              <time dateTime={file.createdAt}>{new Date(file.createdAt).toLocaleDateString()}</time>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!!downloading}
                onClick={() => {
                  void download(file.id);
                }}
              >
                Download file
              </Button>
              {file.canDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={action.isPending}
                  onClick={() => setDeleting(file)}
                >
                  Remove file
                </Button>
              )}
            </div>
          </article>
        ))}
      <Pager meta={listing.data?.meta} page={page} onPage={setPage} disabled={listing.isFetching} />
      <Confirm
        prompt={
          deleting
            ? {
                title: 'Remove attachment?',
                description: `Permanently remove "${deleting.filename}" from this task.`,
              }
            : null
        }
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setError(null);
          try {
            await action.mutateAsync({
              path: `/tasks/${task.id}/attachments/${deleting.id}`,
              method: 'DELETE',
              message: 'Attachment removed',
            });
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      />
    </section>
  );
}
