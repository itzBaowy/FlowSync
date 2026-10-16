'use client';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  CircleCheck,
  FolderKanban,
  Search,
} from 'lucide-react';
import { taskPrioritySchema } from '@flowsync/contracts';
import { dashboardCopy as copy } from '@/data/mockData';
import { useDashboardWork } from '@/hooks/use-dashboard-work';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Notice, Pager, selectClass } from './organization-ui';
import { DashboardInsights, RecentActivity, RecentProjects } from './dashboard-insights';
import { EmptyState, PriorityBadge, TaskStatus } from './workspace-ui';
interface DashboardWorkProps {
  readonly children?: never;
}
const metricIcons = [FolderKanban, CheckCheck, CalendarDays, AlertCircle];
const metricTones = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};
export function DashboardWork(_props: DashboardWorkProps) {
  const {
    dashboard,
    tasks,
    page,
    setPage,
    search,
    changeSearch,
    due,
    changeDue,
    priority,
    changePriority,
  } = useDashboardWork();
  const data = dashboard.data;
  return (
    <div className="mt-7 space-y-6">
      <Notice error={dashboard.error} />
      <section aria-label="Dashboard totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {copy.metrics.map((metric, index) => {
          const Icon = metricIcons[index]!;
          return (
            <div
              key={metric.key}
              className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">{metric.label}</p>
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${metricTones[metric.tone]}`}
                >
                  <Icon size={16} />
                </span>
              </div>
              <p className="mt-2 text-[30px] font-semibold tracking-tight tabular-nums">
                {dashboard.error ? '—' : (data?.[metric.key] ?? '…')}
              </p>
              <p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">
                {metric.caption}
              </p>
            </div>
          );
        })}
      </section>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_296px]">
        <div className="min-w-0 space-y-5">
          <section
            id="my-tasks"
            aria-label="My tasks"
            className="scroll-mt-24 rounded-xl border border-border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
              <div>
                <h2 className="text-base font-semibold">
                  My tasks{' '}
                  <span className="ml-2 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {tasks.data?.meta.total ?? '…'}
                  </span>
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.taskDescription}</p>
              </div>
              <div
                role="group"
                aria-label="Task deadline shortcuts"
                className="inline-flex rounded-lg bg-muted/70 p-1"
              >
                {copy.deadlines.map((item) => (
                  <button
                    key={item.value}
                    aria-pressed={due === item.value}
                    onClick={() => changeDue(item.value)}
                    className={`min-h-8 rounded-md px-3 text-[11px] font-medium transition-colors ${due === item.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-y border-border bg-background/40 px-5 py-3">
              <div className="relative min-w-32 flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground"
                />
                <Input
                  aria-label="Search my tasks"
                  className="h-10 border-transparent bg-card pl-9"
                  placeholder="Search assigned tasks"
                  maxLength={120}
                  value={search}
                  onChange={(event) => changeSearch(event.target.value)}
                />
              </div>
              <select
                aria-label="My task deadline"
                className={`${selectClass} h-10 sm:max-w-36`}
                value={due}
                onChange={(event) => changeDue(event.target.value)}
              >
                <option value="all">All deadlines</option>
                <option value="overdue">Overdue</option>
                <option value="soon">Due in 7 days</option>
              </select>
              <select
                aria-label="My task priority"
                className={`${selectClass} h-10 sm:max-w-32`}
                value={priority}
                onChange={(event) => changePriority(event.target.value)}
              >
                <option value="">All priorities</option>
                {taskPrioritySchema.options.map((level) => (
                  <option key={level} value={level}>
                    {level[0] + level.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-5">
              <Notice error={tasks.error} />
            </div>
            {tasks.isPending && (
              <p role="status" className="p-8 text-center text-sm text-muted-foreground">
                Loading your tasks...
              </p>
            )}
            {tasks.data?.data.length === 0 && (
              <EmptyState
                icon={CircleCheck}
                title={copy.emptyTasks}
                description={copy.emptyTasksDescription}
              >
                <Button asChild variant="outline" size="sm">
                  <Link href="/organizations">
                    Explore projects
                    <ArrowUpRight size={13} />
                  </Link>
                </Button>
              </EmptyState>
            )}
            {!tasks.error &&
              tasks.data?.data.map((task) => (
                <Link
                  key={task.id}
                  className="group flex min-h-[82px] items-center gap-3 border-b border-border/70 px-5 py-4 transition-colors hover:bg-primary/5"
                  href={`/boards?projectId=${task.projectId}&id=${task.boardId}&taskId=${task.id}`}
                >
                  <TaskStatus status={task.status} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium group-hover:text-primary">
                      {task.title}
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {task.projectName} <span className="mx-1">·</span>{' '}
                      {task.status.toLowerCase().replaceAll('_', ' ')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 sm:hidden">
                      <PriorityBadge priority={task.priority} />
                      <span className="text-[10px] text-muted-foreground">
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
                    <PriorityBadge priority={task.priority} />
                    <span
                      className={`flex items-center gap-1.5 text-[10px] ${task.status !== 'DONE' && task.dueDate && new Date(task.dueDate) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      <CalendarDays size={11} />
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                    </span>
                  </div>
                  <ArrowUpRight
                    size={14}
                    className="shrink-0 text-muted-foreground/50 group-hover:text-primary"
                  />
                </Link>
              ))}
            <div className="px-5 pb-4">
              <Pager
                meta={tasks.data?.meta}
                page={page}
                onPage={setPage}
                disabled={tasks.isFetching}
              />
            </div>
          </section>
          {data && !dashboard.error && <RecentProjects projects={data.recentProjects} />}
        </div>
        {data && !dashboard.error && (
          <div className="min-w-0 space-y-5">
            <DashboardInsights data={data} />
            <RecentActivity activities={data.recentActivities} />
          </div>
        )}
      </div>
    </div>
  );
}
