import { Suspense } from 'react';
import { BoardHub } from '@/components/board-hub';
export default function BoardsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading boards...</p>}>
      <BoardHub />
    </Suspense>
  );
}
