'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { activitySchema } from '@flowsync/contracts';
import { paged } from '@/lib/organizations';
import { Notice, Pager } from './organization-ui';
export function ActivityFeed({ projectId, taskId }: { projectId: string; taskId?: string }) {
  const [page, setPage] = useState(1);
  const listing = useQuery({
    queryKey: ['activities', projectId, taskId, page],
    queryFn: () =>
      paged(
        `${taskId ? `/tasks/${taskId}` : `/projects/${projectId}`}/activities?page=${page}&limit=10&order=desc`,
        activitySchema,
      ),
  });
  const label = taskId ? 'Task activity' : 'Project activity';
  return (
    <section aria-label={label} className="space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">{label}</h3>
      <Notice error={listing.error} />
      {listing.isPending && <p className="text-sm text-muted-foreground">Loading activity...</p>}
      {listing.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      )}
      {!listing.error &&
        listing.data?.data.map((row) => (
          <article key={row.id} className="border-b border-border pb-3 text-sm">
            <p>
              <span className="font-medium">{row.actor?.name ?? 'Former member'}</span>{' '}
              {row.action.toLowerCase().replaceAll('_', ' ').replaceAll('.', ' ')}
              {typeof row.metadata?.title === 'string' && (
                <>
                  {' '}
                  · <span className="break-words">{row.metadata.title}</span>
                </>
              )}
            </p>
            {typeof row.metadata?.fromStatus === 'string' &&
              typeof row.metadata?.toStatus === 'string' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.metadata.fromStatus} → {row.metadata.toStatus}
                </p>
              )}
            <time dateTime={row.createdAt} className="text-xs text-muted-foreground">
              {new Date(row.createdAt).toLocaleString()}
            </time>
          </article>
        ))}
      <Pager meta={listing.data?.meta} page={page} onPage={setPage} disabled={listing.isFetching} />
    </section>
  );
}
