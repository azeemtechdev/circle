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
});

describe('requireSupabaseEnv', () => {
  it('throws an actionable message when unconfigured', () => {
    expect(() => requireSupabaseEnv({})).toThrowError(/Copy \.env\.example to \.env\.local/);
  });
});
