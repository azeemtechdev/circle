import { beforeEach, describe, expect, it, vi } from 'vitest';

const closeRoundMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async closeRound(input: { idempotencyKey: string; id: string }) {
      return closeRoundMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/close-round/route';

describe('POST /api/circles/close-round', () => {
  beforeEach(() => {
    closeRoundMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/close-round', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'round-1' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the round id', async () => {
    closeRoundMock.mockResolvedValueOnce('round-closed');

    const response = await POST(
      new Request('http://localhost/api/circles/close-round', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ id: 'round-1' }),
      }),
    );

    expect(closeRoundMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      id: 'round-1',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'round-closed' });
  });

  it('maps permission failures to 403', async () => {
    closeRoundMock.mockRejectedValueOnce(Object.assign(new Error('only the recipient or circle owner can close this round'), { code: 'insufficient_privilege' }));

    const response = await POST(
      new Request('http://localhost/api/circles/close-round', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'round-1' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'only the recipient or circle owner can close this round' });
  });

  it('replay returns the original id when the round close is retried', async () => {
    closeRoundMock.mockResolvedValueOnce('close-round-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/close-round', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ id: 'round-2' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'close-round-replay' });
  });
});
