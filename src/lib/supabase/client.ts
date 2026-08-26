import {
  createBrowserClient,
  createServerClient,
  type CookieOptions,
} from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireSupabaseEnv, readSupabaseEnv, type SupabaseEnv } from '@/lib/env';

export type SupabaseCookieAdapter = {
  getAll: () => Array<{ name: string; value: string }> | Promise<Array<{ name: string; value: string }> | null> | null;
  setAll?: (
    cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
    headers: Record<string, string>,
  ) => void | Promise<void>;
};

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

export function createBrowserSupabaseClient(env: SupabaseEnv = requireSupabaseEnv()): SupabaseClient {
  return createBrowserClient(env.url, env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export function createServerSupabaseClient(config: SupabaseEnv & { cookies: SupabaseCookieAdapter }): SupabaseClient {
  const { url, anonKey, cookies } = config;

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: cookies.getAll,
      setAll: cookies.setAll ?? (() => undefined),
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
