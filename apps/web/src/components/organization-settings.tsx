'use client';
import { useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import Image from 'next/image';
import { updateOrganizationSchema, type Organization } from '@flowsync/contracts';
import { errorMessage, useOrganizationAction } from '@/lib/organizations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Confirm, Field, Notice } from './organization-ui';

export function OrganizationSettings({
  organization: org,
  onDeleted,
}: {
  organization: Organization;
  onDeleted: () => void;
}) {
  const action = useOrganizationAction(org.id);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const owner = org.role === 'OWNER';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}`,
        method: 'PATCH',
        body: updateOrganizationSchema.parse({
          name: form.get('name'),
          slug: form.get('slug'),
          allowAdminInvites: form.get('allowAdminInvites') === 'on',
        }),
        message: 'Settings saved',
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 2 * 1024 * 1024) {
      setError('Choose an image up to 2 MiB');
      return;
    }
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}/logo`,
        method: 'POST',
        body: form,
        message: 'Logo updated',
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function remove() {
    setError(null);
    try {
      await action.mutateAsync({
        path: `/organizations/${org.id}`,
        method: 'DELETE',
        message: 'Organization deleted',
      });
      onDeleted();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-primary/5">
          {org.logoUrl ? (
            <Image
              src={org.logoUrl}
              alt={`${org.name} logo`}
              width={56}
              height={56}
              unoptimized
              className="h-full w-full object-contain"
            />
          ) : (
            <Building2 className="text-primary" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold">{org.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Your role: {org.role}</p>
        </div>
      </div>
      <form key={`${org.updatedAt}-${org.role}`} onSubmit={save} className="mt-6 space-y-4">
        <Field id="settings-name" label="Team name">
          <Input
            id="settings-name"
            name="name"
            defaultValue={org.name}
            required
            minLength={2}
            maxLength={120}
            disabled={!owner || action.isPending}
          />
        </Field>
        <Field id="settings-slug" label="Team slug">
          <Input
            id="settings-slug"
            name="slug"
            defaultValue={org.slug}
            required
            minLength={2}
            maxLength={120}
            disabled={!owner || action.isPending}
          />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="allowAdminInvites"
            defaultChecked={org.allowAdminInvites}
            disabled={!owner || action.isPending}
            className="h-4 w-4 accent-primary"
          />
          Allow admins to invite members
        </label>
        {owner ? (
          <Button type="submit" disabled={action.isPending}>
            Save settings
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">The owner manages organization settings.</p>
        )}
      </form>
      {owner && (
        <form onSubmit={upload} className="mt-6 space-y-3 border-t border-border pt-5">
          <Field id="logo-file" label="Organization logo">
            <Input
              id="logo-file"
              name="file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              disabled={action.isPending}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG or WebP · up to 2 MiB. Images are resized to 512 pixels.
          </p>
          <Button type="submit" variant="outline" disabled={action.isPending}>
            Upload logo
          </Button>
        </form>
      )}
      <div className="mt-4">
        <Notice error={error} />
      </div>
      {owner && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">
            Only organizations without workspaces or retained activity can be deleted.
          </p>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={action.isPending}
            onClick={() => setConfirm(true)}
          >
            Delete organization
          </Button>
        </div>
      )}
      <Confirm
        prompt={
          confirm
            ? {
                title: 'Delete organization?',
                description: `Delete ${org.name}, its memberships and invitations? This cannot be undone.`,
              }
            : null
        }
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
