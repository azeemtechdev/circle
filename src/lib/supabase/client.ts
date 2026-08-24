import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireSupabaseEnv, readSupabaseEnv, type SupabaseEnv } from '@/lib/env';

/**
 * Supabase client factory.
 *
 * Phase 0 scope: an anon-key client used to prove the database is reachable.
 * Auth-aware (cookie-bound) clients arrive in Phase 3 — see PLAN.md §7.
 *
 * No module-level singleton: Vercel serverless functions cold-start with no
 * shared memory, and a per-request client keeps that honest.
 */
export function createSupabaseClient(env: SupabaseEnv = requireSupabaseEnv()): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: {
      // Phase 0 has no user session to persist; avoid touching browser storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Returns a client, or `null` when Supabase env vars are not set yet. */
export function createSupabaseClientIfConfigured(): SupabaseClient | null {
  const env = readSupabaseEnv();
  return env ? createSupabaseClient(env) : null;
}
