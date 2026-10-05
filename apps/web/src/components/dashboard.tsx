'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, ChevronsUpDown, Layers3, LogOut, Menu, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, refreshSession, setAccessToken } from '@/lib/api';
import { Button } from './ui/button';
import { AccountControls } from './account-controls';
import { DashboardWork } from './dashboard-work';
import { Logo } from './logo';

export function Dashboard() {
  const router = useRouter();
  const client = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string; checks: Record<string, string> }>('/health/ready'),
    retry: false,
    refetchInterval: 30000,
    enabled: !!session.data,
  });
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) router.replace('/login');
  }, [session.error, router]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement;
    navigationRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [mobileOpen]);
  async function logout() {
    setLoggingOut(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      setAccessToken(null);
      client.clear();
      router.replace('/login');
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }
  if (session.isPending || (session.error instanceof ApiError && session.error.status === 401))
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-primary" aria-label="Loading your workspace" />
      </div>
    );
  if (!session.data)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">We couldn’t reach your workspace</h1>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button onClick={() => session.refetch()}>Try again</Button>
      </div>
    );
  const user = session.data.user;
  return (
    <div className="min-h-dvh bg-background">
      {mobileOpen && (
        <button
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={navigationRef}
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar p-4 transition-transform md:visible md:translate-x-0 ${mobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-2 py-3">
          <Logo href="/dashboard" />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={16} />
          </Button>
        </div>
        <div className="mt-7 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Layers3 size={16} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold">Personal space</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Your account</p>
          </div>
          <ChevronsUpDown size={13} className="text-muted-foreground" />
        </div>
        <nav className="mt-6">
          <Link
            href="/dashboard"
            aria-current="page"
            className="flex items-center gap-3 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary"
          >
            <Home size={17} />
            Overview
          </Link>
          <Link
            href="/organizations"
            className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted"
          >
            <Layers3 size={17} />
            Organizations
          </Link>
        </nav>
        <div className="mt-9 px-3">
          <h2 className="text-[10px] font-semibold tracking-[.15em] text-muted-foreground">
            WORKSPACES
          </h2>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Open an organization to browse your workspaces and projects.
          </p>
        </div>
        <div className="mt-auto rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-medium">Built for what’s next</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Boards, tasks, and live updates are ready.
          </p>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={logout}
            disabled={loggingOut}
          >
            <LogOut size={15} />
          </Button>
        </div>
      </aside>
      <div className="md:pl-60" inert={mobileOpen}>
        <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={18} />
            </Button>
            <span className="text-sm text-muted-foreground">
              Your space <span className="mx-2 text-border">/</span>
              <span className="text-foreground">Overview</span>
            </span>
          </div>
          <AccountControls />
        </header>
        <main className="mx-auto max-w-6xl px-5 py-10 sm:px-10 lg:py-14">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                LET’S MAKE SPACE FOR GREAT WORK
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Welcome, {user.name.split(' ')[0]}
                <span className="text-primary">.</span>
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                A fresh start for your projects, people, and ideas.
              </p>
            </div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              {health.isPending
                ? 'Checking connection...'
                : health.error
                  ? 'Connection unavailable'
                  : 'Connected'}
            </span>
          </div>
          <DashboardWork />
          <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
            <span>FlowSync — room to do your best work.</span>
            <span>Thoughtfully built. Step by step.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
