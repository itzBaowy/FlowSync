'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { dashboardSchema, myTaskSchema, taskPrioritySchema } from '@flowsync/contracts';
import { api } from '@/lib/api';
import { paged } from '@/lib/organizations';
import { Input } from './ui/input';
import { Notice, Pager, selectClass } from './organization-ui';
export function DashboardWork() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [due, setDue] = useState('all');
  const [priority, setPriority] = useState('');
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => dashboardSchema.parse(await api('/dashboard')),
    refetchInterval: 30000,
  });
  const tasks = useQuery({
    queryKey: ['my-tasks', search, due, priority, page],
    queryFn: () =>
      paged(
        `/me/tasks?page=${page}&limit=10&order=asc&search=${encodeURIComponent(search)}&due=${due}${priority ? `&priority=${priority}` : ''}`,
        myTaskSchema,
      ),
    refetchInterval: 30000,
  });
  const data = dashboard.data;
  const total = data ? data.openTasks + data.completedTasks : 0;
  const completed = total ? Math.round((data!.completedTasks / total) * 100) : 0;
  return (
    <div className="mt-8 space-y-6">
      <Notice error={dashboard.error} />
      <section aria-label="Dashboard totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['Active projects', data?.activeProjects],
            ['Open tasks', data?.openTasks],
            ['Due in 7 days', data?.dueSoon],
            ['Overdue tasks', data?.overdue],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-3 text-2xl font-semibold">
              {dashboard.error ? 'Unavailable' : (count ?? '...')}
            </p>
          </div>
        ))}
      </section>
      {data && !dashboard.error && (
        <>
          <section aria-label="Task charts" className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Task completion</h2>
              <p className="my-3 text-sm text-muted-foreground">
                {data.completedTasks} of {total} tasks completed ({completed}%)
              </p>
              <meter
                aria-label="Task completion percentage"
                min={0}
                max={100}
                value={completed}
                className="h-4 w-full"
              />
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold">Tasks by priority</h2>
              {taskPrioritySchema.options.map((level) => {
                const count = data.byPriority.find((row) => row.priority === level)?.count ?? 0;
                return (
                  <div key={level} className="mb-2 flex items-center gap-3 text-xs">
                    <span className="w-16">{level}</span>
                    <div className="h-2 flex-1 rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{ width: `${total ? (count / total) * 100 : 0}%` }}
                      />
                    </div>
                    <span>{count}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section
            aria-label="Recent projects"
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2 className="font-semibold">Recent projects</h2>
            {data.recentProjects.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Create an organization and project to get started.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.recentProjects.map((project) => {
                  const total = project.openTasks + project.completedTasks;
                  const progress = total ? Math.round((project.completedTasks / total) * 100) : 0;
                  return (
                    <Link
                      key={project.id}
                      href={`/projects?workspaceId=${project.workspaceId}&id=${project.id}`}
                      className="rounded-lg border border-border p-4 hover:bg-muted"
                    >
                      <p className="break-words text-sm font-medium">{project.name}</p>
                      <p className="my-2 text-xs text-muted-foreground">
                        {project.status.replaceAll('_', ' ')} · {project.openTasks} open ·{' '}
                        {project.completedTasks} completed
                      </p>
                      <meter
                        aria-label={`${project.name} progress`}
                        min={0}
                        max={100}
                        value={progress}
                        className="h-3 w-full"
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
      <section
        aria-label="My tasks"
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="font-semibold">My tasks</h2>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Search my tasks"
            className="sm:max-w-xs"
            placeholder="Search assigned tasks"
            maxLength={120}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="My task deadline"
            className={`${selectClass} sm:max-w-44`}
            value={due}
            onChange={(event) => {
              setDue(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All deadlines</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Due in 7 days</option>
          </select>
          <select
            aria-label="My task priority"
            className={`${selectClass} sm:max-w-44`}
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All priorities</option>
            {taskPrioritySchema.options.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </div>
        <Notice error={tasks.error} />
        {tasks.isPending && <p className="text-sm text-muted-foreground">Loading your tasks...</p>}
        {tasks.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No assigned tasks match these filters.</p>
        )}
        {!tasks.error &&
          tasks.data?.data.map((task) => (
            <Link
              key={task.id}
              className="block rounded-lg border border-border p-3 hover:bg-muted"
              href={`/boards?projectId=${task.projectId}&id=${task.boardId}&taskId=${task.id}`}
            >
              <p className="break-words text-sm font-medium">{task.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {task.projectName} · {task.priority} · {task.status.replaceAll('_', ' ')}
                {task.dueDate ? ` · Due ${new Date(task.dueDate).toLocaleDateString()}` : ''}
              </p>
            </Link>
          ))}
        <Pager meta={tasks.data?.meta} page={page} onPage={setPage} disabled={tasks.isFetching} />
      </section>
      {data && !dashboard.error && (
        <section
          aria-label="Recent activities"
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 className="font-semibold">Recent activities</h2>
          {data.recentActivities.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.recentActivities.map((row) => (
                <li key={row.id} className="text-sm">
                  <p>
                    {row.actor?.name ?? 'Former member'} ·{' '}
                    {row.action.toLowerCase().replaceAll('_', ' ')}
                    {typeof row.metadata?.title === 'string' ? ` · ${row.metadata.title}` : ''}
                  </p>
                  <time dateTime={row.createdAt} className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
