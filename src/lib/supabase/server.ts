import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { requireSupabaseEnv } from '@/lib/env';

/**
 * Cookie-bound Supabase client for Server Components, Server Actions and Route
 * Handlers.
 *
 * This is the client every transition function must be called through. The SQL
 * derives the actor from `auth.uid()`, which reads the `sub` claim of the JWT
 * attached to the request (migration 0004). A client built from the anon key
 * alone carries no JWT, so `current_actor()` raises `insufficient_privilege`
 * and every mutation is refused. Binding the session cookies here is what makes
 * the caller a person rather than an anonymous key.
 *
 * Never use the service-role key here. It bypasses RLS and is created
 * `bypassrls`, so a request holding it can read and write every circle in the
 * database. It belongs only in `scripts/reconcile.mts` and the keep-alive
 * Action, which run without a user.
 *
 * No module-level singleton (ADR-0002), and the reason is sharper now than it
 * was in Phase 0: a cached client would carry one user's session into another
 * user's request on a warm Vercel instance.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = requireSupabaseEnv();
  // Async since Next 15; awaiting it is what makes the route dynamic.
  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is not an error here:
          // proxy.ts refreshes the session on every request, so the refreshed
          // cookie is already on its way to the browser. Throwing would break
          // every page that merely reads the user.
        }
      },
    },
  });
}

/**
 * The signed-in user's id, or null.
 *
 * Uses getUser(), never getSession(). getSession() returns whatever is in the
 * cookie without verifying it, and a cookie is client-controlled; getUser()
 * revalidates the token with Supabase Auth. The database would reject a forged
 * JWT anyway, but code that reads this value to decide what to render must not
 * be the weak link.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
