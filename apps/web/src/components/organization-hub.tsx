'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowLeft, Plus } from 'lucide-react';
import { organizationInputSchema, organizationSchema } from '@flowsync/contracts';
import { ApiError, api, refreshSession } from '@/lib/api';
import { paged, useOrganizationAction, errorMessage } from '@/lib/organizations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ThemeToggle } from './theme-toggle';
import { Field, Notice, Pager, selectClass } from './organization-ui';
import { OrganizationSettings } from './organization-settings';

export function OrganizationHub() {
  const router = useRouter();
  const selected = useSearchParams().get('id');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const organizations = useQuery({
    queryKey: ['organizations', page, search, sort],
    queryFn: () =>
      paged(
        `/organizations?page=${page}&limit=10&search=${encodeURIComponent(search)}&sort=${sort}&order=${sort === 'name' ? 'asc' : 'desc'}`,
        organizationSchema,
      ),
    enabled: !!session.data,
  });
  const organization = useQuery({
    queryKey: ['organization', selected],
    queryFn: async () => organizationSchema.parse(await api(`/organizations/${selected}`)),
    enabled: !!session.data && !!selected,
    refetchInterval: 240000,
    retry: false,
  });
  const action = useOrganizationAction();
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) router.replace('/login');
  }, [session.error, router]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      const body = organizationInputSchema.parse({
        name: form.get('name'),
        slug: form.get('slug'),
      });
      const { data } = await action.mutateAsync({
        path: '/organizations',
        method: 'POST',
        body,
        message: 'Organization created',
      });
      setCreating(false);
      router.replace(`/organizations?id=${organizationSchema.parse(data).id}`);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }
  if (!session.data)
    return (
      <main className="mx-auto max-w-lg p-8">
        <p>Loading your organizations…</p>
        <Notice
          error={
            session.error instanceof ApiError && session.error.status === 401 ? null : session.error
          }
        />
        {session.error && <Button onClick={() => session.refetch()}>Try again</Button>}
      </main>
    );
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-10">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm">
          <ArrowLeft size={16} />
          Overview
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              PEOPLE & SHARED PURPOSE
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your organizations</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              A home for your team. Choose an organization to manage people and settings.
            </p>
          </div>
          <Button
            onClick={() => {
              setCreating(!creating);
              setFormError(null);
            }}
          >
            <Plus size={16} />
            {creating ? 'Close form' : 'Create organization'}
          </Button>
        </div>
        {creating && (
          <form
            onSubmit={create}
            className="mt-6 grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
          >
            <Field id="org-name" label="Organization name">
              <Input id="org-name" name="name" required minLength={2} maxLength={120} autoFocus />
            </Field>
            <Field id="org-slug" label="Organization slug">
              <Input
                id="org-slug"
                name="slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={2}
                maxLength={120}
                placeholder="your-team"
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Use lowercase letters, numbers and hyphens for a unique slug.
            </p>
            <div className="sm:col-span-2">
              <Notice error={formError} />
            </div>
            <Button type="submit" disabled={action.isPending}>
              Create team
            </Button>
          </form>
        )}
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[280px_1fr]">
          <section
            aria-label="Organization list"
            className="min-w-0 rounded-xl border border-border bg-card p-5"
          >
            <Field id="org-search" label="Find an organization">
              <Input
                id="org-search"
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
              <Field id="org-sort" label="Sort organizations">
                <select
                  id="org-sort"
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
            <Notice error={organizations.error} />
            <div className="mt-5 space-y-2">
              {organizations.data?.data.map((org) => (
                <Link
                  key={org.id}
                  href={`/organizations?id=${org.id}`}
                  aria-current={selected === org.id ? 'true' : undefined}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${selected === org.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                >
                  <Building2 size={18} className="shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground">{org.role}</p>
                  </div>
                </Link>
              ))}
            </div>
            {organizations.isPending && (
              <p className="mt-5 text-sm text-muted-foreground">Loading…</p>
            )}
            {organizations.data?.data.length === 0 && (
              <p className="mt-5 text-sm text-muted-foreground">
                {search
                  ? 'No matching organizations.'
                  : 'Create your first team, or accept an email invitation.'}
              </p>
            )}
            <Pager
              meta={organizations.data?.meta}
              page={page}
              onPage={setPage}
              disabled={organizations.isFetching}
            />
          </section>
          <section aria-label="Selected organization" className="min-w-0 space-y-6">
            {!selected && (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-20 text-center">
                <Building2 size={32} className="text-primary" />
                <h2 className="mt-5 text-lg font-semibold">Make space for your team</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Select an organization, or create a new one to get started.
                </p>
              </div>
            )}
            {selected && organization.isPending && <p>Loading organization…</p>}
            <Notice error={organization.error} />
            {organization.data && (
              <OrganizationSettings
                key={organization.data.id}
                organization={organization.data}
                onDeleted={() => router.replace('/organizations')}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
