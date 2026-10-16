'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { searchHitSchema, searchKindSchema } from '@flowsync/contracts';
import { paged } from '@/lib/organizations';
import { useSearchShortcut } from '@/hooks/use-search-shortcut';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Notice, Pager, selectClass } from './organization-ui';
export function GlobalSearch() {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useSearchShortcut(setOpen);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const queries = useQueries({
    queries: searchKindSchema.options.map((kind) => ({
      queryKey: ['search', term, kind, type === 'all' ? 1 : page, type === 'all' ? 5 : 10],
      enabled: open && term.length >= 2 && (type === 'all' || type === kind),
      queryFn: () =>
        paged(
          `/search?type=${kind}&search=${encodeURIComponent(term)}&limit=${type === 'all' ? 5 : 10}&page=${type === 'all' ? 1 : page}&order=desc`,
          searchHitSchema,
        ),
    })),
  });
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      <Button
        variant="ghost"
        aria-label="Global search"
        onClick={() => setOpen(true)}
        className="size-10 px-0 text-muted-foreground xl:w-60 xl:justify-start xl:border xl:border-border xl:bg-background xl:px-3"
      >
        <Search size={18} />
        <span className="hidden text-xs xl:inline">Search anything…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[9px] xl:inline">
          Ctrl K
        </kbd>
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={id}
        onCancel={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={id} className="font-semibold">
            Search your workspace
          </h2>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Close search
          </Button>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setTerm(search.trim());
            setPage(1);
          }}
        >
          <Input
            aria-label="Search everything"
            placeholder="Tasks, projects, people, comments"
            required
            minLength={2}
            maxLength={120}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
            className="flex-1"
          />
          <Button>Search</Button>
          <select
            aria-label="Search result type"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="all">All results</option>
            {searchKindSchema.options.map((kind) => (
              <option key={kind} value={kind}>
                {kind[0]!.toUpperCase() + kind.slice(1)}
              </option>
            ))}
          </select>
        </form>
        {term.length < 2 && (
          <p className="mt-5 text-sm text-muted-foreground">
            Enter at least two characters to search the spaces you can access.
          </p>
        )}
        {term.length >= 2 &&
          queries.map((query, index) => {
            const kind = searchKindSchema.options[index]!;
            if (type !== 'all' && type !== kind) return null;
            return (
              <section
                key={kind}
                aria-label={`Search ${kind}`}
                className="mt-5 space-y-3 border-t border-border pt-4"
              >
                <h3 className="text-sm font-semibold capitalize">
                  {kind} {query.data ? `(${query.data.meta.total})` : ''}
                </h3>
                <Notice error={query.error} />
                {query.isPending && <p className="text-sm text-muted-foreground">Searching...</p>}
                {query.data?.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">No matching {kind}.</p>
                )}
                {!query.error &&
                  query.data?.data.map((hit) => (
                    <Link
                      key={hit.id}
                      href={hit.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-lg border border-border p-3 hover:bg-muted"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm font-medium">
                        {hit.title}
                      </p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {hit.context}
                      </p>
                    </Link>
                  ))}
                {type === 'all' ? (
                  query.data &&
                  query.data.meta.total > 5 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setType(kind);
                        setPage(1);
                      }}
                    >
                      See all {kind}
                    </Button>
                  )
                ) : (
                  <Pager
                    meta={query.data?.meta}
                    page={page}
                    onPage={setPage}
                    disabled={query.isFetching}
                  />
                )}
              </section>
            );
          })}
      </dialog>
    </>
  );
}
