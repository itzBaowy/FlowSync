'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Something interrupted your flow</h1>
      <p className="text-sm text-muted-foreground">Please try opening your space again.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
