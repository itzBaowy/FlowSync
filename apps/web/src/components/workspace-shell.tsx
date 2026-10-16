'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCheck,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  Layers3,
  Loader2,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useWorkspaceShell } from '@/hooks/use-workspace-shell';
import { workspaceCopy as copy } from '@/data/mockData';
import { AccountControls } from './account-controls';
import { Logo } from './logo';
import { Button } from './ui/button';
interface WorkspaceShellProps {
  readonly children: ReactNode;
  readonly title: string;
  readonly back?: { readonly href: string; readonly label: string };
  readonly wide?: boolean;
}
export function WorkspaceShell({ children, title, back, wide = false }: WorkspaceShellProps) {
  const pathname = usePathname();
  const {
    session,
    dashboard,
    unauthorized,
    mobileOpen,
    setMobileOpen,
    loggingOut,
    logout,
    navigationRef,
  } = useWorkspaceShell(pathname === '/dashboard');
  if (session.isPending || unauthorized)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-primary" aria-label={copy.loading} />
      </div>
    );
  if (!session.data)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">{copy.unavailable}</h1>
        <p className="text-sm text-muted-foreground">{copy.retryDescription}</p>
        <Button onClick={() => session.refetch()}>{copy.retry}</Button>
      </div>
    );
  const user = session.data.user;
  const navClass =
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors';
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#workspace-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
      >
        {copy.skip}
      </a>
      {mobileOpen && (
        <button
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={navigationRef}
        aria-label={copy.navigation}
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen || undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-border bg-sidebar transition-transform lg:visible lg:translate-x-0 ${mobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
      >
        <div className="flex h-[76px] shrink-0 items-center justify-between px-6">
          <Logo href="/dashboard" />
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-5">
          <Link
            href="/organizations"
            onClick={() => setMobileOpen(false)}
            className="mb-7 mt-3 flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers3 size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{copy.account}</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                {copy.accountDescription}
              </span>
            </span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </Link>
          <p className="mb-2 px-3 text-[10px] font-semibold tracking-[.12em] text-muted-foreground">
            WORKSPACE
          </p>
          <nav aria-label="Main navigation" className="space-y-1">
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              aria-current={pathname === '/dashboard' ? 'page' : undefined}
              className={`${navClass} ${pathname === '/dashboard' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <LayoutDashboard size={18} />
              {copy.overview}
            </Link>
            <Link
              href="/dashboard#my-tasks"
              onClick={() => setMobileOpen(false)}
              className={`${navClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
            >
              <CheckCheck size={18} />
              {copy.tasks}
            </Link>
            <Link
              href="/organizations"
              onClick={() => setMobileOpen(false)}
              aria-current={pathname === '/organizations' ? 'page' : undefined}
              className={`${navClass} ${pathname === '/organizations' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <Building2 size={18} />
              {copy.organizations}
            </Link>
          </nav>
          <div className="mb-3 mt-8 flex items-center justify-between px-3">
            <h2 className="text-[10px] font-semibold tracking-[.12em] text-muted-foreground">
              {copy.projects}
            </h2>
            <FolderKanban size={14} className="text-muted-foreground" />
          </div>
          <nav aria-label="Recent project navigation" className="space-y-1">
            {!dashboard.error &&
              dashboard.data?.recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects?workspaceId=${project.workspaceId}&id=${project.id}`}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <span className="size-2 shrink-0 rounded-sm bg-primary/60" />
                  <span className="truncate">{project.name}</span>
                </Link>
              ))}
          </nav>
          {!dashboard.data?.recentProjects.length && (
            <p className="px-3 text-xs leading-5 text-muted-foreground">{copy.emptyProjects}</p>
          )}
        </div>
        <div className="mx-4 mb-4 rounded-xl bg-primary/5 p-4">
          <span className="mb-3 flex size-8 items-center justify-center rounded-lg bg-card text-primary">
            <Layers3 size={17} />
          </span>
          <p className="text-xs font-semibold">{copy.teamTitle}</p>
          <p className="my-2 text-[11px] leading-5 text-muted-foreground">{copy.teamDescription}</p>
          <Link
            href="/organizations"
            onClick={() => setMobileOpen(false)}
            className="inline-flex min-h-8 items-center gap-2 text-xs font-semibold text-primary"
          >
            {copy.browseTeams}
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {user.name
              .split(' ')
              .map((part) => part[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user.name}</p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            aria-label={copy.signOut}
            onClick={logout}
            disabled={loggingOut}
          >
            <LogOut size={16} />
          </Button>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-[248px]" inert={mobileOpen}>
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-2 border-b border-border bg-card/95 px-4 backdrop-blur-md sm:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </Button>
            <div className="flex min-w-0 items-center gap-3 text-xs">
              <span className="hidden text-muted-foreground sm:inline">Workspace</span>
              <ChevronRight size={13} className="hidden text-muted-foreground/60 sm:inline" />
              {back ? (
                <Link
                  href={back.href}
                  className="flex min-w-0 items-center gap-2 font-medium hover:text-primary"
                >
                  <ArrowLeft size={14} className="shrink-0" />
                  <span className="truncate">{back.label}</span>
                </Link>
              ) : (
                <span className="truncate font-medium">{title}</span>
              )}
            </div>
          </div>
          <AccountControls />
        </header>
        <div
          id="workspace-content"
          tabIndex={-1}
          className={`workspace-content mx-auto min-w-0 px-4 py-7 outline-none sm:px-8 sm:py-9 ${wide ? 'max-w-[1800px]' : 'max-w-[1440px]'}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
