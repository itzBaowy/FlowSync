import { Suspense } from 'react';
import { OrganizationHub } from '@/components/organization-hub';
export default function OrganizationsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading organizations…</p>}>
      <OrganizationHub />
    </Suspense>
  );
}
