import { describe, expect, it } from 'vitest';

import { readSupabaseEnv, requireSupabaseEnv, SUPABASE_ENV_KEYS } from '@/lib/env';

describe('readSupabaseEnv', () => {
  it('returns config when both values are present', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: 'https://example.supabase.co',
      [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
    });

    expect(env).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key',
    });
  });

  it('returns null when a value is missing', () => {
    expect(readSupabaseEnv({ [SUPABASE_ENV_KEYS.url]: 'https://example.supabase.co' })).toBeNull();
    expect(readSupabaseEnv({})).toBeNull();
  });

  it('treats unedited .env.example placeholders as missing', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: 'your-project-url',
      [SUPABASE_ENV_KEYS.anonKey]: 'your-anon-key',
    });

    expect(env).toBeNull();
  });

  it('treats blank values as missing', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: '   ',
      [SUPABASE_ENV_KEYS.anonKey]: '',
    });

    expect(env).toBeNull();
  });

  it('trims surrounding whitespace from both values', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: '  https://example.supabase.co  ',
      [SUPABASE_ENV_KEYS.anonKey]: '  anon-key\n',
    });

    expect(env).toEqual({ url: 'https://example.supabase.co', anonKey: 'anon-key' });
  });

  it('strips a trailing slash from the project URL', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: 'https://example.supabase.co/',
      [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
    });

    expect(env?.url).toBe('https://example.supabase.co');
  });

  it('accepts a local supabase stack over http', () => {
    const env = readSupabaseEnv({
      [SUPABASE_ENV_KEYS.url]: 'http://127.0.0.1:54321',
      [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
    });

    expect(env?.url).toBe('http://127.0.0.1:54321');
  });

  // Regression: the REST endpoint URL was pasted instead of the project URL, so
  // supabase-js requested /rest/v1//rest/v1/ and every call failed with PGRST125.
  it('rejects a URL that already includes the REST path', () => {
    expect(() =>
      readSupabaseEnv({
        [SUPABASE_ENV_KEYS.url]: 'https://example.supabase.co/rest/v1/',
        [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
      }),
    ).toThrow(/Remove the trailing "rest\/v1"/);
  });

  it('rejects a URL that is not parseable', () => {
    expect(() =>
      readSupabaseEnv({
        [SUPABASE_ENV_KEYS.url]: 'example.supabase.co',
        [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
      }),
    ).toThrow(/is not a valid URL/);
  });

  it('rejects a remote URL served over http', () => {
    expect(() =>
      readSupabaseEnv({
        [SUPABASE_ENV_KEYS.url]: 'http://example.supabase.co',
        [SUPABASE_ENV_KEYS.anonKey]: 'anon-key',
      }),
    ).toThrow(/must use https/);
  });

  it('rejects an anon key containing inner whitespace', () => {
    expect(() =>
      readSupabaseEnv({
        [SUPABASE_ENV_KEYS.url]: 'https://example.supabase.co',
        [SUPABASE_ENV_KEYS.anonKey]: 'eyJhbGci OiJIUzI1',
      }),
    ).toThrow(/pasted across multiple lines/);
  });
});

describe('requireSupabaseEnv', () => {
  it('throws an actionable message when unconfigured', () => {
    expect(() => requireSupabaseEnv({})).toThrow(/Copy \.env\.example to \.env\.local/);
  });
});
