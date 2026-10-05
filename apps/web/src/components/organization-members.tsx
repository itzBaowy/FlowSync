'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  memberRoleSchema,
  memberSchema,
  type Organization,
  type OrganizationMember,
} from '@flowsync/contracts';
import { errorMessage, paged, useOrganizationAction } from '@/lib/organizations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';

export function OrganizationMembers({ organization: org }: { organization: Organization }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: 'remove' | 'transfer';
    member: OrganizationMember;
  } | null>(null);
  const action = useOrganizationAction(org.id);
  const members = useQuery({
    queryKey: ['members', org.id, page, search, sort],
    queryFn: () =>
      paged(
        `/organizations/${org.id}/members?page=${page}&limit=10&search=${encodeURIComponent(search)}&sort=${sort}&order=asc`,
        memberSchema,
      ),
    refetchInterval: 60000,
  });
  async function changeRole(member: OrganizationMember, role: string) {
    setError(null);
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}/members/${member.userId}`,
        method: 'PATCH',
        body: memberRoleSchema.parse({ role }),
        message: 'Role updated',
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function confirm() {
    if (!confirmation) return;
    setError(null);
    try {
      await action.mutateAsync(
        confirmation.kind === 'remove'
          ? {
              path: `/organizations/${org.id}/members/${confirmation.member.userId}`,
              method: 'DELETE',
              message: 'Member removed',
            }
          : {
              path: `/organizations/${org.id}/transfer-ownership`,
              method: 'POST',
              body: { userId: confirmation.member.userId },
              message: 'Ownership transferred',
            },
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section aria-label="Members" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Members</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Everyone in {org.name}. The owner manages roles and membership.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field id="member-search" label="Find a member">
          <Input
            id="member-search"
            type="search"
            maxLength={120}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name or email"
          />
        </Field>
        <Field id="member-sort" label="Sort members">
          <select
            id="member-sort"
            className={selectClass}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            <option value="name">Name A–Z</option>
            <option value="createdAt">Joined first</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Notice error={error || members.error} />
      </div>
      <div className="mt-4 divide-y divide-border">
        {members.data?.data.map((member) => (
          <MemberRow
            key={`${member.userId}-${member.role}`}
            member={member}
            owner={org.role === 'OWNER'}
            busy={action.isPending}
            onRole={(role) => void changeRole(member, role)}
            onRemove={() => setConfirmation({ kind: 'remove', member })}
            onTransfer={() => setConfirmation({ kind: 'transfer', member })}
          />
        ))}
      </div>
      {members.isPending && <p className="mt-5 text-sm text-muted-foreground">Loading members…</p>}
      {members.data?.data.length === 0 && (
        <p className="mt-5 text-sm text-muted-foreground">No matching members.</p>
      )}
      <Pager meta={members.data?.meta} page={page} onPage={setPage} disabled={members.isFetching} />
      <Confirm
        prompt={
          confirmation
            ? {
                title: confirmation.kind === 'remove' ? 'Remove member?' : 'Transfer ownership?',
                description:
                  confirmation.kind === 'remove'
                    ? `Remove ${confirmation.member.user.name} from ${org.name}? Their workspace memberships and task assignments will be removed.`
                    : `Make ${confirmation.member.user.name} the owner of ${org.name}? Your role becomes ADMIN and you lose owner controls.`,
              }
            : null
        }
        onClose={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
    </section>
  );
}
function MemberRow({
  member,
  owner,
  busy,
  onRole,
  onRemove,
  onTransfer,
}: {
  member: OrganizationMember;
  owner: boolean;
  busy: boolean;
  onRole: (role: string) => void;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const [role, setRole] = useState(member.role);
  return (
    <article aria-label={`Member ${member.user.email}`} className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium">{member.user.name}</h3>
          <p className="mt-1 break-all text-xs text-muted-foreground">{member.user.email}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs">{member.role}</span>
      </div>
      {owner && member.role !== 'OWNER' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`role-${member.userId}`}>
            Role for {member.user.email}
          </label>
          <select
            id={`role-${member.userId}`}
            value={role}
            disabled={busy}
            onChange={(event) => setRole(memberRoleSchema.parse({ role: event.target.value }).role)}
            className={`${selectClass} max-w-32`}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || role === member.role}
            onClick={() => onRole(role)}
          >
            Save role
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onTransfer}>
            Make owner
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={onRemove}
          >
            Remove member
          </Button>
        </div>
      )}
    </article>
  );
}
