import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCircleMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async createCircle(input: { idempotencyKey: string; name: string; amountKobo: bigint; periodDays: number; memberTarget: number }) {
      return createCircleMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/create-circle/route';

describe('POST /api/circles/create-circle', () => {
  beforeEach(() => {
    createCircleMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/create-circle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test Circle', amountKobo: 1000, periodDays: 30, memberTarget: 3 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the new circle id', async () => {
    createCircleMock.mockResolvedValueOnce('circle-123');

    const response = await POST(
      new Request('http://localhost/api/circles/create-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
          cookie: 'sb-access-token=abc123',
        },
        body: JSON.stringify({ name: 'Test Circle', amountKobo: 1000, periodDays: 30, memberTarget: 3 }),
      }),
    );

    expect(createCircleMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      name: 'Test Circle',
      amountKobo: 1000n,
      periodDays: 30,
      memberTarget: 3,
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-123' });
  });

  it('maps check violations to HTTP 409', async () => {
    createCircleMock.mockRejectedValueOnce(Object.assign(new Error('bad input'), { code: 'check_violation' }));

    const response = await POST(
      new Request('http://localhost/api/circles/create-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ name: 'Test Circle', amountKobo: 1000, periodDays: 30, memberTarget: 3 }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'bad input' });
  });

  it('replay returns the original id when the mutation is replayed', async () => {
    createCircleMock.mockResolvedValueOnce('circle-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/create-circle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ name: 'Replay Circle', amountKobo: 1000, periodDays: 30, memberTarget: 3 }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'circle-replay' });
  });
});
