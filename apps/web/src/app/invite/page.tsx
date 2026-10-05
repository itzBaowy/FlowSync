import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InvitationAccept } from '@/components/invitation-accept';
export const metadata: Metadata = {
  title: 'Your invitation — FlowSync',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
export default function InvitePage() {
  return (
    <Suspense fallback={<p className="p-8">Loading invitation…</p>}>
      <InvitationAccept />
    </Suspense>
  );
}
