'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api, refreshSession } from '@/lib/api';
import { dashboardCopy } from '@/data/mockData';
import { Button } from './ui/button';
import { DashboardWork } from './dashboard-work';
import { WorkspaceShell } from './workspace-shell';
interface DashboardProps {
  readonly children?: never;
}
export function Dashboard(_props: DashboardProps) {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/health/ready'),
    retry: false,
    refetchInterval: 30000,
    enabled: !!session.data,
  });
  return (
    <WorkspaceShell title="Overview">
      <main>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold tracking-[.14em] text-muted-foreground">
              {dashboardCopy.eyebrow}
            </p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-.04em] sm:text-[32px]">
              Welcome, {session.data?.user.name.split(' ')[0]}
              <span className="text-primary">.</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{dashboardCopy.description}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${health.error ? 'bg-destructive' : health.isPending ? 'bg-muted-foreground' : 'bg-success'}`}
              />
              {health.isPending
                ? 'Checking connection...'
                : health.error
                  ? 'Connection unavailable'
                  : 'Connected'}
            </span>
            <Button asChild variant="outline">
              <Link href="/organizations">
                Browse teams
                <ArrowUpRight size={15} />
              </Link>
            </Button>
          </div>
        </div>
        <DashboardWork />
      </main>
    </WorkspaceShell>
  );
}
