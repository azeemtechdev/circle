import { describe, expect, it } from 'vitest';

import { readSupabaseEnv } from '@/lib/env';
import { createSupabaseClient } from '@/lib/supabase/client';

/**
 * Phase 0 acceptance criterion: "Supabase reachable from a test."
 *
 * This suite skips itself until `.env.local` holds a real project URL and anon
 * key, so a fresh clone still has a green test run. Once configured:
 *
 *   npm run test:smoke
 */
const env = readSupabaseEnv();

describe.skipIf(env === null)('Supabase connection smoke test', () => {
  it('reaches the auth service', async () => {
    // Non-null: describe.skipIf guarantees env is set inside this block.
    const { url, anonKey } = env!;

    // /auth/v1/health is the only liveness endpoint an anon key may call.
    // (/rest/v1/ itself is service_role-only and answers 401 to the anon key.)
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
    });

    expect(response.status).toBe(200);
  });

  it('round-trips a query through supabase-js', async () => {
    const supabase = createSupabaseClient();

    // No tables exist yet (schema lands in Phase 1), so we deliberately query a
    // table that will never exist. PostgREST replying PGRST205 proves three
    // things at once: the host resolved, PostgREST is running, and the anon key
    // was accepted — a rejected key returns 401 "Invalid API key" instead.
    const { data, error } = await supabase
      .from('__circle_connection_smoke_test')
      .select('*')
      .limit(1);

    expect(data).toBeNull();
    expect(error?.code).toBe('PGRST205');
  });
});

describe.skipIf(env !== null)('Supabase connection smoke test (unconfigured)', () => {
  it('is skipped until .env.local is filled in', () => {
    expect(readSupabaseEnv()).toBeNull();
  });
});
