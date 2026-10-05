import { Suspense } from 'react';
import { ScopeHub } from '@/components/scope-hub';
export default function ProjectsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading projects…</p>}>
      <ScopeHub kind="projects" />
    </Suspense>
  );
}
