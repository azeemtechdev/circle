import { beforeEach, describe, expect, it, vi } from 'vitest';

const activateCircleMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async activateCircle(input: { idempotencyKey: string; id: string; startDate?: string | null }) {
      return activateCircleMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/activate-circle/route';

describe('POST /api/circles/activate-circle', () => {
  beforeEach(() => {
    activateCircleMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/activate-circle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'circle-1', startDate: '2026-01-01' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the circle id', async () => {
    activateCircleMock.mockResolvedValueOnce('circle-activated');

    const response = await POST(
      new Request('http://localhost/api/circles/activate-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ id: 'circle-1', startDate: '2026-01-01' }),
      }),
    );

    expect(activateCircleMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      id: 'circle-1',
      startDate: '2026-01-01',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-activated' });
  });

  it('maps lock contention to 409', async () => {
    activateCircleMock.mockRejectedValueOnce(Object.assign(new Error('circle is already being activated'), { code: 'lock_not_available' }));

    const response = await POST(
      new Request('http://localhost/api/circles/activate-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'circle-1', startDate: '2026-01-01' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'circle is already being activated' });
  });

  it('replay returns the original id when activation is retried', async () => {
    activateCircleMock.mockResolvedValueOnce('circle-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/activate-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ id: 'circle-1', startDate: '2026-01-02' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-replay' });
  });
});
