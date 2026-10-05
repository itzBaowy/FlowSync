import { Suspense } from 'react';
import { ScopeHub } from '@/components/scope-hub';
export default function WorkspacesPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading workspaces…</p>}>
      <ScopeHub kind="workspaces" />
    </Suspense>
  );
}
