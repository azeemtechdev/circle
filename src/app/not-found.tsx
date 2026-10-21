import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * Also what a circle you are not in looks like: RLS returns nothing for it,
 * and "not found" is deliberately the same answer as "not yours".
 */
export default function NotFound() {
  return (
    <div style={{ paddingTop: 60 }}>
      <EmptyState icon="users" title="We can’t find that">
        It may have been removed, or it belongs to a circle you are not in.
      </EmptyState>
      <div className="pad">
        <Link href="/dashboard" className="btn">
          Back to home
        </Link>
      </div>
    </div>
  );
}
