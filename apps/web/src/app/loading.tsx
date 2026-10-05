export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status">
      <span className="animate-pulse text-sm text-muted-foreground">Opening your space…</span>
    </div>
  );
}
