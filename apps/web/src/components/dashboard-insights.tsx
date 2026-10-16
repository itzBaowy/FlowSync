import { taskPrioritySchema, type dashboardSchema } from '@flowsync/contracts';
import type { z } from 'zod';
import { Activity, ArrowUpRight, CircleCheck, FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { dashboardCopy as copy } from '@/data/mockData';
import { EmptyState } from './workspace-ui';
type DashboardData = z.infer<typeof dashboardSchema>;
interface DashboardInsightsProps {
  readonly data: DashboardData;
}
export function DashboardInsights({ data }: DashboardInsightsProps) {
  const total = data.openTasks + data.completedTasks;
  const percentage = total ? Math.round((data.completedTasks / total) * 100) : 0;
  const priorityTotal = data.byPriority.reduce((sum, row) => sum + row.count, 0);
  return (
    <section aria-label="Task charts" className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Task completion</h2>
        <p className="mt-1 text-xs text-muted-foreground">Every step adds up.</p>
        <div className="relative mx-auto my-6 size-36">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--muted)" strokeWidth="9" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="9"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${percentage} 100`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tracking-tight">{percentage}%</span>
            <span className="mt-1 text-[10px] text-muted-foreground">COMPLETED</span>
          </div>
        </div>
        <meter
          aria-label="Task completion percentage"
          min={0}
          max={100}
          value={percentage}
          className="sr-only"
        />
        <div className="grid grid-cols-2 divide-x divide-border border-t border-border pt-4 text-center">
          <div>
            <p className="text-lg font-semibold">{data.completedTasks}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Completed</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{data.openTasks}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Remaining</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Tasks by priority</h2>
        <div className="mt-5 space-y-4">
          {[...taskPrioritySchema.options].reverse().map((level) => {
            const count = data.byPriority.find((row) => row.priority === level)?.count ?? 0;
            return (
              <div key={level} className={`priority-${level.toLowerCase()}`}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-current" />
                    {level[0] + level.slice(1).toLowerCase()}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-current"
                    style={{ width: `${priorityTotal ? (count / priorityTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
interface RecentProjectsProps {
  readonly projects: DashboardData['recentProjects'];
}
export function RecentProjects({ projects }: RecentProjectsProps) {
  return (
    <section aria-label="Recent projects" className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Recent projects</h2>
        <Link
          href="/organizations"
          className="flex min-h-8 items-center gap-1 text-xs font-medium text-primary"
        >
          Browse teams
          <ArrowUpRight size={13} />
        </Link>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={copy.emptyProjects}
          description={copy.emptyProjectsDescription}
        />
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {projects.map((project) => {
            const total = project.openTasks + project.completedTasks;
            const progress = total ? Math.round((project.completedTasks / total) * 100) : 0;
            return (
              <Link
                key={project.id}
                href={`/projects?workspaceId=${project.workspaceId}&id=${project.id}`}
                className="group min-w-0 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderKanban size={18} />
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="text-muted-foreground group-hover:text-primary"
                  />
                </div>
                <h3 className="break-words text-sm font-semibold">{project.name}</h3>
                <span className="my-3 inline-flex rounded bg-muted px-2 py-1 text-[9px] font-medium capitalize text-muted-foreground">
                  {project.status.toLowerCase().replaceAll('_', ' ')}
                </span>
                <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {project.completedTasks}/{total} tasks
                  </span>
                  <span>{progress}%</span>
                </div>
                <meter
                  aria-label={`${project.name} progress`}
                  min={0}
                  max={100}
                  value={progress}
                  className="block h-1.5 w-full"
                />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
interface RecentActivityProps {
  readonly activities: DashboardData['recentActivities'];
}
export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <section aria-label="Recent activities" className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-5">
        <h2 className="text-sm font-semibold">Recent activities</h2>
        <Activity size={16} className="text-muted-foreground" />
      </div>
      {activities.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={copy.emptyActivity}
          description={copy.emptyActivityDescription}
        />
      ) : (
        <ul className="space-y-5 p-5">
          {activities.map((row) => (
            <li key={row.id} className="flex gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                {(row.actor?.name ?? '?').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="break-words text-xs leading-5">
                  <span className="font-semibold">{row.actor?.name ?? 'Former member'}</span>{' '}
                  {row.action.toLowerCase().replaceAll('_', ' ')}
                  {typeof row.metadata?.title === 'string' ? ` · ${row.metadata.title}` : ''}
                </p>
                <time
                  dateTime={row.createdAt}
                  className="mt-1 block text-[10px] text-muted-foreground"
                >
                  {new Date(row.createdAt).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
