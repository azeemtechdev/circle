import { redirect } from 'next/navigation';

import { ActivityRow } from '@/components/ui/activity-row';
import { EmptyState } from '@/components/ui/empty-state';
import { loadActivity } from '@/lib/circles/activity';
import { listMyCircles } from '@/lib/circles/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The history view (PLAN.md Phase 3): every transition in your circles,
 * newest first, read from the `events` audit log. RLS limits it to circles
 * you belong to.
 */
export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const circles = await listMyCircles();
  const items = await loadActivity(user.id, circles, 60);

  return (
    <>
      <div className="page-head">
        <h1>Activity</h1>
        <p className="mute">Every payment and confirmation, newest first.</p>
      </div>
      {items.length === 0 ? (
        <div className="card">
          <EmptyState icon="activity" title="Nothing yet">
            When someone joins, pays or confirms in one of your circles, it shows up here.
          </EmptyState>
        </div>
      ) : (
        <div className="card card--list">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
