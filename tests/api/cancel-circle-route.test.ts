import { beforeEach, describe, expect, it, vi } from 'vitest';

const cancelCircleMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async cancelCircle(input: { idempotencyKey: string; id: string; reason?: string | null }) {
      return cancelCircleMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/cancel-circle/route';

describe('POST /api/circles/cancel-circle', () => {
  beforeEach(() => {
    cancelCircleMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/cancel-circle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'circle-1', reason: 'changed plans' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the circle id', async () => {
    cancelCircleMock.mockResolvedValueOnce('circle-cancelled');

    const response = await POST(
      new Request('http://localhost/api/circles/cancel-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ id: 'circle-1', reason: 'changed plans' }),
      }),
    );

    expect(cancelCircleMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      id: 'circle-1',
      reason: 'changed plans',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-cancelled' });
  });

  it('maps forbidden state changes to 409', async () => {
    cancelCircleMock.mockRejectedValueOnce(Object.assign(new Error('circle cannot be cancelled after activation'), { code: 'check_violation' }));

    const response = await POST(
      new Request('http://localhost/api/circles/cancel-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'circle-1', reason: 'changed plans' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'circle cannot be cancelled after activation' });
  });

  it('replay returns the original id when cancellation is retried', async () => {
    cancelCircleMock.mockResolvedValueOnce('circle-cancel-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/cancel-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ id: 'circle-1', reason: 'replay cancel' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-cancel-replay' });
  });
});
