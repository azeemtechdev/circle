import { redirect } from 'next/navigation';

import { signOut } from '@/lib/auth/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Placeholder dashboard.
 *
 * The real one — who has paid, whose turn it is, the countdown — is Phase 3
 * part 4. What this page exists to prove today is that the whole auth chain
 * works end to end: the session cookie survives the round trip, proxy.ts
 * refreshes it, the cookie-bound server client sends the JWT, and RLS returns
 * this user's own profile row and nobody else's.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // proxy.ts already redirects a signed-out visitor. This is the real guard:
  // proxy is an optimistic check, and a page that reads user data must not
  // depend on it.
  if (!user) redirect('/login');

  // Read through RLS, not by user id in a where clause on a privileged client.
  // If the policy from 0004 were wrong, this would come back empty rather than
  // quietly returning somebody else's row.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, phone, email')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {profile?.display_name ? `Hello, ${profile.display_name}` : 'Hello'}
        </h1>
        <p className="mt-1 text-sm opacity-70">You are signed in.</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Could not load your profile: {error.message}
        </p>
      ) : null}

      {profile && !profile.phone ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You have no phone number saved, so nobody can invite you to a circle yet.
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="opacity-70">Email</dt>
        <dd>{profile?.email ?? '—'}</dd>
        <dt className="opacity-70">Phone</dt>
        <dd>{profile?.phone ?? '—'}</dd>
      </dl>

      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg border border-black/20 px-4 py-3 text-base font-medium dark:border-white/25"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
