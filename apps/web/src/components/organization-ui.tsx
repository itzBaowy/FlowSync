'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './ui/button';
import type { Pagination } from '@/lib/organizations';

export const selectClass =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-primary disabled:opacity-50';
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
export function Notice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
export function Pager({
  meta,
  page,
  onPage,
  disabled,
}: {
  meta?: Pagination;
  page: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-xs text-muted-foreground">
      <span>
        {meta
          ? `${meta.total} results · Page ${page} of ${Math.max(1, meta.totalPages)}`
          : 'Loading results…'}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !meta || page >= meta.totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function Confirm({
  prompt,
  onClose,
  onConfirm,
}: {
  prompt: { title: string; description: string } | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (prompt) ref.current?.showModal();
    else ref.current?.close();
  }, [prompt]);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {prompt?.title}
      </h2>
      <p id={descriptionId} className="mt-3 text-sm text-muted-foreground">
        {prompt?.description}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} autoFocus>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          Confirm
        </Button>
      </div>
    </dialog>
  );
}
