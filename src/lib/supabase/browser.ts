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
 * reads that need the caller's identity.
 */

/**
 * The two values, written out longhand, and that matters.
 *
 * Next replaces `process.env.NEXT_PUBLIC_*` in browser code by textual
 * substitution at build time. It only does so for a literal member expression:
 * per Next's own docs, `process.env[someVariable]` and `const env =
 * process.env; env.NEXT_PUBLIC_X` are both explicitly NOT inlined.
 *
 * `readSupabaseEnv` does both of those things — it takes `process.env` as a
 * parameter and indexes it with a key from a constants object. That is correct
 * and testable on the server, where `process.env` is real, and silently empty
 * in the browser. The result was that this client could never be constructed:
 * requireSupabaseEnv threw "not configured" on a project that is configured,
 * and the invite lookup hung forever.
 *
 * So the literals are spelled out here, once, and then handed to the same
 * validator everything else uses — no second copy of the parsing rules.
 */
const BROWSER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
} as const;

export function createSupabaseBrowserClient(): SupabaseClient {
  const env = requireSupabaseEnv(BROWSER_ENV);
  return createBrowserClient(env.url, env.anonKey);
}
