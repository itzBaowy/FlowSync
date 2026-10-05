'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  invitationTokenSchema,
  invitationPreviewSchema,
  organizationSchema,
} from '@flowsync/contracts';
import { ApiError, api, refreshSession, setAccessToken } from '@/lib/api';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { Notice } from './organization-ui';

export function InvitationAccept() {
  const router = useRouter();
  const client = useQueryClient();
  const token = useSearchParams().get('token');
  const valid = invitationTokenSchema.safeParse({ token }).success;
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
    enabled: valid,
  });
  const preview = useQuery({
    queryKey: ['invitation-preview', token, session.data?.user.id],
    queryFn: async () =>
      invitationPreviewSchema.parse(
        await api('/invitations/preview', { method: 'POST', body: JSON.stringify({ token }) }),
      ),
    enabled: valid && !!session.data,
    retry: false,
  });
  const acceptance = useMutation({
    mutationFn: async () =>
      organizationSchema.parse(
        await api('/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }),
      ),
    onSuccess: async (org) => {
      await client.invalidateQueries({ queryKey: ['organizations'] });
      client.removeQueries({ queryKey: ['invitation-preview'] });
      router.replace(`/organizations?id=${org.id}`);
    },
  });
  const signout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      setAccessToken(null);
      client.clear();
      router.replace(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`);
    },
  });
  const authQuery = `?next=${encodeURIComponent(`/invite?token=${token}`)}`;
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-border px-6 py-5">
        <Logo href="/dashboard" />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-lg px-5 py-16">
        <section className="rounded-xl border border-border bg-card p-7">
          <p className="text-xs font-medium tracking-widest text-primary">
            AN INVITATION TO WORK TOGETHER
          </p>
          <h1 className="mt-4 text-2xl font-semibold">Your team is waiting</h1>
          {!valid ? (
            <p role="alert" className="mt-5 text-sm text-destructive">
              This invitation link is invalid. Ask your team for a new invitation.
            </p>
          ) : (
            <>
              {session.isPending && (
                <p className="mt-5 text-sm text-muted-foreground">Checking your account…</p>
              )}
              {session.error instanceof ApiError && session.error.status === 401 ? (
                <div className="mt-5 space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Sign in or create an account using the email address that received this
                    invitation.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <Link href={`/login${authQuery}`}>Sign in</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href={`/register${authQuery}`}>Create an account</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <Notice error={session.error} />
              )}
              {session.error &&
                !(session.error instanceof ApiError && session.error.status === 401) && (
                  <Button className="mt-4" onClick={() => session.refetch()}>
                    Try again
                  </Button>
                )}
              {session.data && (
                <div className="mt-5 space-y-5">
                  <p className="break-all text-xs text-muted-foreground">
                    Signed in as {session.data.user.email}
                  </p>
                  {preview.isPending && <p className="text-sm">Loading invitation…</p>}
                  <Notice error={preview.error || acceptance.error || signout.error} />
                  {preview.data && (
                    <>
                      <h2 className="text-xl font-semibold">
                        Join {preview.data.organizationName}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        You are invited as {preview.data.role}. Your invitation expires{' '}
                        {new Date(preview.data.expiresAt).toLocaleDateString()}.
                      </p>
                      <Button disabled={acceptance.isPending} onClick={() => acceptance.mutate()}>
                        {acceptance.isPending ? 'Joining…' : 'Accept invitation'}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    disabled={signout.isPending || acceptance.isPending}
                    onClick={() => signout.mutate()}
                  >
                    Use another account
                  </Button>
                </div>
              )}
            </>
          )}
          <Link href="/dashboard" className="mt-7 block text-sm text-primary hover:underline">
            Back to your space
          </Link>
        </section>
      </main>
    </div>
  );
}
