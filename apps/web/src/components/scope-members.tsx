'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scopeMemberSchema, type ScopeMember } from '@flowsync/contracts';
import { errorMessage, paged } from '@/lib/organizations';
import { useScopeAction } from '@/lib/scopes';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice, Pager, selectClass } from './organization-ui';
export function ScopeMembers({
  kind,
  id,
  parentId,
  canManage,
  ownerId,
}: {
  kind: 'workspaces' | 'projects';
  id: string;
  parentId: string;
  canManage: boolean;
  ownerId?: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: 'remove' | 'transfer';
    member: ScopeMember;
  } | null>(null);
  const action = useScopeAction();
  const members = useQuery({
    queryKey: ['scope-members', kind, id, page, search, sort],
    queryFn: () =>
      paged(
        `/${kind}/${id}/members?page=${page}&limit=10&search=${encodeURIComponent(search)}&sort=${sort}&order=asc`,
        scopeMemberSchema,
      ),
    refetchInterval: 60000,
  });
  const parentKind = kind === 'workspaces' ? 'organizations' : 'workspaces';
  const candidates = useQuery({
    queryKey: ['scope-members', 'eligible', kind, parentId, candidatePage, candidateSearch],
    queryFn: () =>
      paged(
        `/${parentKind}/${parentId}/members?page=${candidatePage}&limit=10&search=${encodeURIComponent(candidateSearch)}&sort=name&order=asc`,
        scopeMemberSchema,
      ),
    enabled: canManage,
  });
  async function add(member: ScopeMember) {
    setError(null);
    try {
      await action.mutateAsync({
        path: `/${kind}/${id}/members`,
        method: 'POST',
        body: { userId: member.userId },
        message: 'Member added',
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
              path: `/${kind}/${id}/members/${confirmation.member.userId}`,
              method: 'DELETE',
              message: 'Member removed',
            }
          : {
              path: `/projects/${id}/transfer-ownership`,
              method: 'POST',
              body: { userId: confirmation.member.userId },
              message: 'Project ownership transferred',
            },
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section aria-label="Scope members" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">
        {kind === 'workspaces' ? 'Workspace' : 'Project'} members
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Membership gives access to this space. Organization owners and admins retain management
        access.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field id="scope-member-search" label="Find a space member">
          <Input
            id="scope-member-search"
            type="search"
            maxLength={120}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field id="scope-member-sort" label="Sort space members">
          <select
            id="scope-member-sort"
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
        <Notice error={error || members.error || candidates.error} />
      </div>
      <div className="mt-4 divide-y divide-border">
        {members.data?.data.map((member) => (
          <article
            key={member.userId}
            aria-label={`Space member ${member.user.email}`}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <h3 className="break-words text-sm font-medium">
                {member.user.name}
                {ownerId === member.userId && (
                  <span className="ml-2 text-xs text-primary">Owner</span>
                )}
              </h3>
              <p className="mt-1 break-all text-xs text-muted-foreground">{member.user.email}</p>
            </div>
            {canManage && member.userId !== ownerId && (
              <div className="flex flex-wrap gap-2">
                {kind === 'projects' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => setConfirmation({ kind: 'transfer', member })}
                  >
                    Make project owner
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={action.isPending}
                  onClick={() => setConfirmation({ kind: 'remove', member })}
                >
                  Remove from space
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {members.data?.data.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No matching members.</p>
      )}
      <Pager meta={members.data?.meta} page={page} onPage={setPage} disabled={members.isFetching} />
      {canManage && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">Add a teammate</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Choose an existing {kind === 'workspaces' ? 'organization' : 'workspace'} member.
          </p>
          <div className="mt-4">
            <Field id="eligible-search" label="Find eligible people">
              <Input
                id="eligible-search"
                type="search"
                maxLength={120}
                value={candidateSearch}
                onChange={(event) => {
                  setCandidateSearch(event.target.value);
                  setCandidatePage(1);
                }}
                placeholder="Name or email"
              />
            </Field>
          </div>
          <div className="mt-3 divide-y divide-border">
            {candidates.data?.data.map((member) => (
              <article
                key={member.userId}
                aria-label={`Eligible person ${member.user.email}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm">{member.user.name}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {member.user.email}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    action.isPending ||
                    members.data?.data.some((current) => current.userId === member.userId)
                  }
                  onClick={() => void add(member)}
                >
                  Add to space
                </Button>
              </article>
            ))}
          </div>
          {candidates.data?.data.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              No eligible people match your search.
            </p>
          )}
          <Pager
            meta={candidates.data?.meta}
            page={candidatePage}
            onPage={setCandidatePage}
            disabled={candidates.isFetching}
          />
        </div>
      )}
      <Confirm
        prompt={
          confirmation
            ? {
                title:
                  confirmation.kind === 'remove'
                    ? 'Remove from space?'
                    : 'Transfer project ownership?',
                description:
                  confirmation.kind === 'remove'
                    ? `Remove ${confirmation.member.user.name} and their assignments from this space${kind === 'workspaces' ? ', including its projects' : ''}?`
                    : `Make ${confirmation.member.user.name} the project owner? Your management access depends on your organization role after transfer.`,
              }
            : null
        }
        onClose={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
    </section>
  );
}
