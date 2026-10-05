import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-semibold">This space doesn’t exist</h1>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Back to your workspace
      </Link>
    </main>
  );
}
