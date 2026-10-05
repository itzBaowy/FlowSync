'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Folder, Plus } from 'lucide-react';
import { z } from 'zod';
import {
  organizationSchema,
  workspaceSchema,
  workspaceInputSchema,
  workspaceUpdateSchema,
  projectSchema,
  projectInputSchema,
  projectUpdateSchema,
  projectStatusSchema,
  projectOverviewSchema,
  type Workspace,
  type Project,
} from '@flowsync/contracts';
import { ApiError, api, refreshSession } from '@/lib/api';
import { errorMessage, paged } from '@/lib/organizations';
import { useScopeAction } from '@/lib/scopes';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ThemeToggle } from './theme-toggle';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';
import { ScopeMembers } from './scope-members';
type ScopeKind = 'workspaces' | 'projects';
type Resource = Workspace | Project;

export function ScopeHub({ kind }: { kind: ScopeKind }) {
  const router = useRouter();
  const params = useSearchParams();
  const isWorkspace = kind === 'workspaces';
  const label = isWorkspace ? 'Workspace' : 'Project';
  const parentKey = isWorkspace ? 'organizationId' : 'workspaceId';
  const parentId = params.get(parentKey);
  const selected = params.get('id');
  const validParent = z.string().uuid().safeParse(parentId).success;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const action = useScopeAction();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const parent = useQuery({
    queryKey: ['scope-parent', kind, parentId],
    queryFn: async () =>
      isWorkspace
        ? organizationSchema.parse(await api(`/organizations/${parentId}`))
        : workspaceSchema.parse(await api(`/workspaces/${parentId}`)),
    enabled: !!session.data && validParent,
    retry: false,
  });
  const canCreate =
    parent.data && ('role' in parent.data ? parent.data.role !== 'MEMBER' : parent.data.canManage);
  const schema = isWorkspace ? workspaceSchema : projectSchema;
  const listing = useQuery({
    queryKey: [kind, parentId, page, search, sort, status],
    queryFn: () =>
      paged<Resource>(
        `/${kind}?${parentKey}=${parentId}&page=${page}&limit=10&search=${encodeURIComponent(search)}&sort=${sort}&order=${sort === 'name' ? 'asc' : 'desc'}${!isWorkspace && status ? `&status=${status}` : ''}`,
        schema,
      ),
    enabled: !!parent.data,
  });
  const detail = useQuery<Resource>({
    queryKey: [isWorkspace ? 'workspace' : 'project', selected],
    queryFn: async () => {
      const row = schema.parse(await api(`/${kind}/${selected}`));
      if (('workspaceId' in row ? row.workspaceId : row.organizationId) !== parentId)
        throw new ApiError(
          'This resource does not belong to this space',
          404,
          'RESOURCE_NOT_FOUND',
        );
      return row;
    },
    enabled: !!parent.data && !!selected,
    retry: false,
  });
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) router.replace('/login');
  }, [router, session.error]);
  const basePath = `/${kind}?${parentKey}=${parentId}`;
  async function submit(event: FormEvent<HTMLFormElement>, creating: boolean) {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      name: values.get('name'),
      description: values.get('description') || null,
    };
    if (isWorkspace) {
      body.slug = values.get('slug');
      body.icon = values.get('icon') || null;
    } else {
      body.status = values.get('status');
      for (const date of ['startDate', 'dueDate'])
        body[date] = values.get(date) ? `${values.get(date)}T00:00:00.000Z` : null;
    }
    if (creating) body[parentKey] = parentId;
    try {
      const validated = isWorkspace
        ? creating
          ? workspaceInputSchema.parse(body)
          : workspaceUpdateSchema.parse(body)
        : creating
          ? projectInputSchema.parse(body)
          : projectUpdateSchema.parse(body);
      const { data } = await action.mutateAsync({
        path: creating ? `/${kind}` : `/${kind}/${selected}`,
        method: creating ? 'POST' : 'PATCH',
        body: validated,
        message: `${label} ${creating ? 'created' : 'updated'}`,
      });
      if (creating) {
        setCreating(false);
        router.replace(`${basePath}&id=${schema.parse(data).id}`);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function remove() {
    setError(null);
    try {
      await action.mutateAsync({
        path: `/${kind}/${selected}`,
        method: 'DELETE',
        message: `${label} deleted`,
      });
      router.replace(basePath);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  if (!validParent)
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Choose an organization first</h1>
        <Link href="/organizations" className="mt-4 block text-primary">
          Open your organizations
        </Link>
      </main>
    );
  const resource = detail.data;
  const back = isWorkspace
    ? `/organizations?id=${parentId}`
    : `/workspaces?organizationId=${parent.data && 'organizationId' in parent.data ? parent.data.organizationId : ''}&id=${parentId}`;
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-10">
        <Link href={back} className="flex items-center gap-2 text-sm">
          <ArrowLeft size={16} />
          {parent.data?.name ?? 'Back to team'}
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              {isWorkspace ? 'ROOM FOR SHARED WORK' : 'TURN IDEAS INTO PROGRESS'}
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              {isWorkspace ? 'Workspaces' : 'Projects'}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {isWorkspace
                ? 'Organize teams into focused spaces.'
                : 'Plan your work and bring the right people together.'}
            </p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                setCreating(!creating);
                setError(null);
              }}
            >
              <Plus size={16} />
              {creating ? 'Close form' : `Create ${label.toLowerCase()}`}
            </Button>
          )}
        </div>
        <div className="mt-5">
          <Notice
            error={
              session.error instanceof ApiError && session.error.status === 401
                ? null
                : session.error || parent.error || error
            }
          />
        </div>
        {!parent.data && !parent.error && <p className="mt-6">Loading your team…</p>}
        {creating && (
          <form
            onSubmit={(event) => void submit(event, true)}
            className="mt-6 space-y-4 rounded-xl border border-border bg-card p-6"
          >
            <ResourceFields key="create" kind={kind} disabled={action.isPending} />
            <Button type="submit" disabled={action.isPending}>
              Create {label.toLowerCase()} now
            </Button>
          </form>
        )}
        {parent.data && (
          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[280px_1fr]">
            <section
              aria-label={`${label} list`}
              className="min-w-0 rounded-xl border border-border bg-card p-5"
            >
              <Field id="scope-search" label={`Find a ${label.toLowerCase()}`}>
                <Input
                  id="scope-search"
                  type="search"
                  maxLength={120}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by name"
                />
              </Field>
              <div className="mt-3">
                <Field id="scope-sort" label={`Sort ${kind}`}>
                  <select
                    id="scope-sort"
                    className={selectClass}
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="createdAt">Newest first</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </Field>
              </div>
              {!isWorkspace && (
                <div className="mt-3">
                  <Field id="scope-status" label="Filter status">
                    <select
                      id="scope-status"
                      className={selectClass}
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All statuses</option>
                      {projectStatusSchema.options.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Notice error={listing.error} />
              <div className="mt-5 space-y-2">
                {listing.data?.data.map((row) => (
                  <Link
                    key={row.id}
                    href={`${basePath}&id=${row.id}`}
                    aria-current={selected === row.id ? 'true' : undefined}
                    className={`block rounded-lg border p-3 ${selected === row.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                  >
                    <p className="break-words text-sm font-medium">{row.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {'status' in row ? row.status.replaceAll('_', ' ') : row.slug}
                    </p>
                  </Link>
                ))}
              </div>
              {listing.isPending && <p className="mt-4 text-sm">Loading…</p>}
              {listing.data?.data.length === 0 && (
                <p className="mt-5 text-sm text-muted-foreground">
                  No {kind} found.{' '}
                  {canCreate ? 'Create one to get started.' : 'Ask your team admin to add you.'}
                </p>
              )}
              <Pager
                meta={listing.data?.meta}
                page={page}
                onPage={setPage}
                disabled={listing.isFetching}
              />
            </section>
            <div className="min-w-0 space-y-6">
              <Notice error={detail.error} />
              {!selected && (
                <div className="rounded-xl border border-dashed border-border px-6 py-20 text-center">
                  <Folder size={32} className="mx-auto text-primary" />
                  <h2 className="mt-5 text-lg font-semibold">Choose a {label.toLowerCase()}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your shared work starts here.
                  </p>
                </div>
              )}
              {selected && detail.isPending && <p>Loading {label.toLowerCase()}…</p>}
              {resource && (
                <>
                  <section className="rounded-xl border border-border bg-card p-6">
                    <h2 className="text-xl font-semibold">{resource.name}</h2>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {resource.canManage
                        ? 'You can manage this space.'
                        : 'You have member access.'}
                    </p>
                    <form
                      key={`${resource.id}-${resource.updatedAt}`}
                      onSubmit={(event) => void submit(event, false)}
                      className="mt-5 space-y-4"
                    >
                      <ResourceFields
                        kind={kind}
                        resource={resource}
                        disabled={!resource.canManage || action.isPending}
                      />
                      {resource.canManage && (
                        <Button type="submit" disabled={action.isPending}>
                          Save {label.toLowerCase()}
                        </Button>
                      )}
                    </form>
                    {isWorkspace && (
                      <Button asChild className="mt-6" variant="outline">
                        <Link href={`/projects?workspaceId=${resource.id}`}>Open projects</Link>
                      </Button>
                    )}
                    {!isWorkspace && (
                      <Button asChild className="mt-6" variant="outline">
                        <Link href={`/boards?projectId=${resource.id}`}>Open boards</Link>
                      </Button>
                    )}
                    {resource.canManage && (
                      <div className="mt-6 border-t border-border pt-5">
                        <Button
                          variant="outline"
                          className="text-destructive"
                          disabled={action.isPending}
                          onClick={() => setDeleting(true)}
                        >
                          Delete {label.toLowerCase()}
                        </Button>
                      </div>
                    )}
                  </section>
                  <ScopeMembers
                    key={`${kind}-${resource.id}`}
                    kind={kind}
                    id={resource.id}
                    parentId={
                      'workspaceId' in resource ? resource.workspaceId : resource.organizationId
                    }
                    canManage={resource.canManage}
                    ownerId={'ownerId' in resource ? resource.ownerId : undefined}
                  />
                  {!isWorkspace && <ProjectOverview id={resource.id} />}
                </>
              )}
            </div>
          </div>
        )}
        <Confirm
          prompt={
            deleting && resource
              ? {
                  title: `Delete ${label.toLowerCase()}?`,
                  description: `Delete ${resource.name} and its memberships? This cannot be undone. Existing work and retained history must be handled first.`,
                }
              : null
          }
          onClose={() => setDeleting(false)}
          onConfirm={() => void remove()}
        />
      </main>
    </div>
  );
}
function ResourceFields({
  kind,
  resource,
  disabled,
}: {
  kind: ScopeKind;
  resource?: Resource;
  disabled: boolean;
}) {
  const prefix = resource ? 'edit' : 'create';
  const label = kind === 'workspaces' ? 'Workspace' : 'Project';
  const workspace = resource && 'slug' in resource ? resource : undefined;
  const project = resource && 'status' in resource ? resource : undefined;
  return (
    <>
      <Field id={`${prefix}-name`} label={`${label} name`}>
        <Input
          id={`${prefix}-name`}
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={resource?.name}
          disabled={disabled}
        />
      </Field>
      {kind === 'workspaces' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${prefix}-slug`} label="Workspace slug">
            <Input
              id={`${prefix}-slug`}
              name="slug"
              required
              minLength={2}
              maxLength={120}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              defaultValue={workspace?.slug}
              disabled={disabled}
            />
          </Field>
          <Field id={`${prefix}-icon`} label="Workspace icon">
            <Input
              id={`${prefix}-icon`}
              name="icon"
              maxLength={32}
              defaultValue={workspace?.icon ?? ''}
              disabled={disabled}
              placeholder="Short symbol or initials"
            />
          </Field>
        </div>
      )}
      <Field id={`${prefix}-description`} label={`${label} description`}>
        <textarea
          id={`${prefix}-description`}
          name="description"
          maxLength={10000}
          rows={3}
          defaultValue={resource?.description ?? ''}
          disabled={disabled}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm focus:outline-primary disabled:opacity-50"
        />
      </Field>
      {kind === 'projects' && (
        <>
          <Field id={`${prefix}-status`} label="Project status">
            <select
              id={`${prefix}-status`}
              name="status"
              className={selectClass}
              defaultValue={project?.status ?? 'PLANNING'}
              disabled={disabled}
            >
              {projectStatusSchema.options.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['startDate', 'dueDate'] as const).map((date) => (
              <Field
                key={date}
                id={`${prefix}-${date}`}
                label={date === 'startDate' ? 'Start date' : 'Due date'}
              >
                <Input
                  id={`${prefix}-${date}`}
                  name={date}
                  type="date"
                  defaultValue={project?.[date]?.slice(0, 10) ?? ''}
                  disabled={disabled}
                />
              </Field>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function ProjectOverview({ id }: { id: string }) {
  const overview = useQuery({
    queryKey: ['project-overview', id],
    queryFn: async () => projectOverviewSchema.parse(await api(`/projects/${id}/overview`)),
  });
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Project overview</h2>
      <Notice error={overview.error} />
      {overview.data ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['tasks', 'completed', 'overdue', 'members'] as const).map((key) => (
              <div key={key} className="rounded-lg border border-border p-4">
                <p className="text-xs capitalize text-muted-foreground">{key}</p>
                <p className="mt-2 text-2xl font-semibold">{overview.data[key]}</p>
              </div>
            ))}
          </div>
          <h3 className="mt-6 text-sm font-semibold">Recent activity</h3>
          {overview.data.recentActivities.length ? (
            <ul className="mt-3 space-y-3 text-sm">
              {overview.data.recentActivities.map((row) => (
                <li key={row.id}>
                  {row.actorName ?? 'Team'} · {row.action}{' '}
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
        </>
      ) : (
        !overview.error && <p className="mt-4 text-sm">Loading overview…</p>
      )}
    </section>
  );
}
