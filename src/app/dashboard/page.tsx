import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/lib/auth/actions';
import { listMyCircles } from '@/lib/circles/queries';
import { naira } from '@/lib/format';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The list of your circles.
 *
 * proxy.ts already redirects a signed-out visitor, but this page reads user
 * data, so it re-checks with getUser(). Proxy is an optimistic check; a page
 * that trusts it is one config change away from leaking.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  const circles = await listMyCircles();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your circles</h1>
          <p className="mt-1 text-sm opacity-70">
            {profile?.display_name ? `Signed in as ${profile.display_name}` : 'Signed in'}
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm underline underline-offset-4 opacity-70">
            Sign out
          </button>
        </form>
      </header>

      {profile && !profile.phone ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p>Nobody can invite you until you add your phone number.</p>
          <Link href="/profile" className="mt-1 inline-block underline underline-offset-4">
            Add it now
          </Link>
        </div>
      ) : null}

      <Link
        href="/circles/new"
        className="rounded-lg bg-foreground px-4 py-3 text-center text-base font-medium text-background"
      >
        Start a new circle
      </Link>

      {circles.length === 0 ? (
        <p className="text-sm opacity-70">
          You are not in any circle yet. Start one, or ask a friend to invite you with your phone
          number.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {circles.map((circle) => (
            <li key={circle.id}>
              <Link
                href={`/circles/${circle.id}`}
                className="block rounded-lg border border-black/15 p-4 dark:border-white/20"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{circle.name}</span>
                  <span className="text-xs uppercase tracking-wide opacity-60">
                    {circle.status}
                  </span>
                </div>
                <p className="mt-1 text-sm opacity-70">
                  {naira(circle.amount_kobo_text)} every {circle.period_days} days ·{' '}
                  {circle.joined_count} of {circle.member_target} joined
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-auto pt-6 text-xs opacity-60">
        Circle keeps the books. Money moves between you in your bank app, never through this site.
      </p>
    </main>
  );
}
