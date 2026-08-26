import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', async () => {
  const browserClientFactory = vi.fn(() => ({ kind: 'browser' }));
  const serverClientFactory = vi.fn(() => ({ kind: 'server' }));

  return {
    createBrowserClient: browserClientFactory,
    createServerClient: serverClientFactory,
    __mockFactories: { browserClientFactory, serverClientFactory },
  };
});

import { createBrowserSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/client';

const ssrModule = (await import('@supabase/ssr')) as unknown as {
  __mockFactories: {
    browserClientFactory: ReturnType<typeof vi.fn>;
    serverClientFactory: ReturnType<typeof vi.fn>;
  };
};
const browserClientFactory = ssrModule.__mockFactories.browserClientFactory;
const serverClientFactory = ssrModule.__mockFactories.serverClientFactory;

describe('auth client factories', () => {
  beforeEach(() => {
    browserClientFactory.mockClear();
    serverClientFactory.mockClear();
  });

  it('creates a browser client with the configured Supabase project', () => {
    const client = createBrowserSupabaseClient({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key',
    });

    expect(client).toEqual({ kind: 'browser' });
    expect(browserClientFactory).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key', expect.any(Object));
  });

  it('creates a server client from cookie state', () => {
    const cookieState = {
      getAll: vi.fn(() => [{ name: 'sb-access-token', value: 'token' }]),
      setAll: vi.fn(),
    };

    const client = createServerSupabaseClient({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key',
      cookies: cookieState,
    });

    expect(client).toEqual({ kind: 'server' });
    expect(serverClientFactory).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key', expect.objectContaining({
      cookies: expect.objectContaining({
        getAll: cookieState.getAll,
        setAll: cookieState.setAll,
      }),
    }));
  });
});
