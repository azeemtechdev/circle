'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireSupabaseEnv } from '@/lib/env';

/**
 * Cookie-bound Supabase client for Client Components.
 *
 * Writes the session to cookies rather than localStorage, which is what lets
 * the server clients and proxy.ts see the same session. Only the anon key ever
 * reaches the browser.
 *
 * Mutations do not go through this client — they go through the API routes, so
 * that the idempotency key and the error mapping live in one place. This is for
 * auth state and reads.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const env = requireSupabaseEnv();
  return createBrowserClient(env.url, env.anonKey);
}
