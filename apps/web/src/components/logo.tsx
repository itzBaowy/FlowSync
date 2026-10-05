import { Workflow } from 'lucide-react';
import Link from 'next/link';
export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Workflow size={19} strokeWidth={2.4} />
      </span>
      <span className="text-lg">
        FlowSync<span className="text-primary">.</span>
      </span>
    </Link>
  );
}
