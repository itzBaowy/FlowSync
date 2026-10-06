'use client';
import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationCountSchema, notificationSchema } from '@flowsync/contracts';
import { api, refreshSession } from '@/lib/api';
import { paged } from '@/lib/organizations';
import { useNotificationRealtime } from '@/lib/use-notification-realtime';
import { Button } from './ui/button';
import { Notice, Pager } from './organization-ui';

export function NotificationBell() {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    staleTime: Infinity,
    retry: false,
  });
  const userId = session.data?.user.id;
  useNotificationRealtime(userId);
  const count = useQuery({
    queryKey: ['notifications', userId, 'count'],
    enabled: !!userId,
    queryFn: async () => notificationCountSchema.parse(await api('/notifications/unread-count')),
  });
  const listing = useQuery({
    queryKey: ['notifications', userId, 'list', page, unread],
    enabled: !!userId && open,
    queryFn: () =>
      paged(
        `/notifications?page=${page}&limit=10&order=desc&unread=${unread ? 'true' : 'all'}`,
        notificationSchema,
      ),
  });
  const action = useMutation({
    mutationFn: ({ notificationId, read }: { notificationId?: string; read?: boolean }) =>
      api(notificationId ? `/notifications/${notificationId}/read` : '/notifications/read-all', {
        method: notificationId ? 'PATCH' : 'POST',
        ...(notificationId ? { body: JSON.stringify({ read }) } : {}),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications', userId] }),
  });
  if (!userId) return null;
  const total = count.data?.unread ?? 0;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        popoverTarget={id}
        aria-label={`Notifications (${total} unread)`}
        aria-expanded={open}
        className="relative"
      >
        <Bell size={18} />
        {total > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground"
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </Button>
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Notifications"
        onToggle={(event) => setOpen(event.newState === 'open')}
        className="fixed inset-auto right-4 top-20 z-50 m-0 max-h-[75dvh] w-[min(400px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="icon"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close notifications"
          >
            <X size={18} />
          </Button>
        </div>
        <div className="my-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={unread}
              onChange={(event) => {
                setUnread(event.target.checked);
                setPage(1);
              }}
            />
            Unread only
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending || total === 0}
            onClick={() => action.mutate({})}
          >
            Mark all read
          </Button>
        </div>
        <Notice error={count.error || listing.error || action.error} />
        {listing.isPending && (
          <p className="text-sm text-muted-foreground">Loading notifications...</p>
        )}
        {listing.data?.data.length === 0 && (
          <p className="py-5 text-sm text-muted-foreground">You are all caught up.</p>
        )}
        {listing.data?.data.map((notification) => (
          <article
            key={notification.id}
            aria-label={notification.title}
            className={`space-y-2 border-b border-border py-3 text-sm ${notification.readAt ? 'text-muted-foreground' : ''}`}
          >
            <p className={!notification.readAt ? 'font-medium' : ''}>{notification.title}</p>
            <time dateTime={notification.createdAt} className="text-xs text-muted-foreground">
              {new Date(notification.createdAt).toLocaleString()}
            </time>
            <div className="flex items-center justify-between gap-2">
              <Link
                className="text-primary hover:underline"
                href={notification.href}
                onClick={() => {
                  if (!notification.readAt)
                    action.mutate({ notificationId: notification.id, read: true });
                  ref.current?.hidePopover();
                }}
              >
                {notification.taskId
                  ? 'Open task'
                  : notification.projectId
                    ? 'Open project'
                    : 'Open workspace'}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ notificationId: notification.id, read: !notification.readAt })
                }
              >
                {notification.readAt ? 'Mark unread' : 'Mark read'}
              </Button>
            </div>
          </article>
        ))}
        <Pager
          meta={listing.data?.meta}
          page={page}
          onPage={setPage}
          disabled={listing.isFetching}
        />
      </div>
    </>
  );
}
