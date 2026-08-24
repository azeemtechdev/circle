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
  it('answers the REST endpoint with the anon key', async () => {
    // Non-null: describe.skipIf guarantees env is set inside this block.
    const { url, anonKey } = env!;

    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });

    expect(response.ok).toBe(true);
  });

  it('round-trips a query through supabase-js', async () => {
    const supabase = createSupabaseClient();

    // No tables exist yet (schema lands in Phase 1), so we deliberately query a
    // table that will never exist. PostgREST replying `42P01 undefined_table`
    // proves three things at once: the host resolved, PostgREST is running, and
    // the anon key was accepted. A bad key would fail with 401 instead.
    const { data, error } = await supabase
      .from('__circle_connection_smoke_test')
      .select('*')
      .limit(1);

    expect(data).toBeNull();
    expect(error?.code).toBe('42P01');
  });
});

describe.skipIf(env !== null)('Supabase connection smoke test (unconfigured)', () => {
  it('is skipped until .env.local is filled in', () => {
    expect(readSupabaseEnv()).toBeNull();
  });
});
