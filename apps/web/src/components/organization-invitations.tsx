'use client';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  invitationInputSchema,
  invitationSchema,
  type Invitation,
  type Organization,
} from '@flowsync/contracts';
import { errorMessage, paged, useOrganizationAction } from '@/lib/organizations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';

export function OrganizationInvitations({ organization: org }: { organization: Organization }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const action = useOrganizationAction(org.id);
  const invitations = useQuery({
    queryKey: ['invitations', org.id, page, search, sort],
    queryFn: () =>
      paged(
        `/organizations/${org.id}/invitations?page=${page}&limit=10&search=${encodeURIComponent(search)}&sort=${sort}&order=${sort === 'name' ? 'asc' : 'desc'}`,
        invitationSchema,
      ),
    refetchInterval: 60000,
  });
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}/invitations`,
        method: 'POST',
        body: invitationInputSchema.parse({ email: form.get('email'), role: form.get('role') }),
        message: 'Invitation queued for email delivery',
      });
      formElement.reset();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function revoke() {
    if (!revoking) return;
    setError(null);
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}/invitations/${revoking.id}/revoke`,
        method: 'POST',
        message: 'Invitation revoked',
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section aria-label="Invitations" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Invitations</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Send an invitation by email. It expires after seven days and must be accepted using the
        invited email address.
      </p>
      <form onSubmit={invite} className="mt-5 grid gap-3 sm:grid-cols-[1fr_130px]">
        <Field id="invite-email" label="Invite email">
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            maxLength={254}
            disabled={action.isPending}
            placeholder="teammate@company.com"
          />
        </Field>
        <Field id="invite-role" label="Invite role">
          <select id="invite-role" name="role" className={selectClass} disabled={action.isPending}>
            <option value="MEMBER">Member</option>
            {org.role === 'OWNER' && <option value="ADMIN">Admin</option>}
          </select>
        </Field>
        <Button
          type="submit"
          disabled={action.isPending}
          className="sm:col-span-2 sm:justify-self-start"
        >
          Send invitation
        </Button>
      </form>
      <div className="mt-4">
        <Notice error={error || invitations.error} />
      </div>
      <div className="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Field id="invitation-search" label="Find an invitation">
          <Input
            id="invitation-search"
            type="search"
            maxLength={120}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by email"
          />
        </Field>
        <Field id="invitation-sort" label="Sort invitations">
          <select
            id="invitation-sort"
            className={selectClass}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            <option value="createdAt">Newest first</option>
            <option value="name">Email A–Z</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 divide-y divide-border">
        {invitations.data?.data.map((invite) => (
          <article
            key={invite.id}
            aria-label={`Invitation ${invite.email}`}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <p className="break-all text-sm font-medium">{invite.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {invite.role} · {invite.status} · Expires{' '}
                {new Date(invite.expiresAt).toLocaleDateString()}
              </p>
            </div>
            {invite.status === 'PENDING' && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => setRevoking(invite)}
              >
                Revoke invitation
              </Button>
            )}
          </article>
        ))}
      </div>
      {invitations.isPending && (
        <p className="mt-5 text-sm text-muted-foreground">Loading invitations…</p>
      )}
      {invitations.data?.data.length === 0 && (
        <p className="mt-5 text-sm text-muted-foreground">No invitations found.</p>
      )}
      <Pager
        meta={invitations.data?.meta}
        page={page}
        onPage={setPage}
        disabled={invitations.isFetching}
      />
      <Confirm
        prompt={
          revoking
            ? {
                title: 'Revoke invitation?',
                description: `The invitation for ${revoking.email} will no longer allow them to join ${org.name}.`,
              }
            : null
        }
        onClose={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}
