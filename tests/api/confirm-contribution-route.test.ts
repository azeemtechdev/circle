import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmContributionMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async confirmContribution(input: { idempotencyKey: string; id: string }) {
      return confirmContributionMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/confirm-contribution/route';

describe('POST /api/circles/confirm-contribution', () => {
  beforeEach(() => {
    confirmContributionMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/confirm-contribution', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the contribution id', async () => {
    confirmContributionMock.mockResolvedValueOnce('contribution-confirmed');

    const response = await POST(
      new Request('http://localhost/api/circles/confirm-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(confirmContributionMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      id: 'contribution-1',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'contribution-confirmed' });
  });

  it('maps missing entities to 404', async () => {
    confirmContributionMock.mockRejectedValueOnce(Object.assign(new Error('contribution was not found'), { code: 'foreign_key_violation' }));

    const response = await POST(
      new Request('http://localhost/api/circles/confirm-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'contribution was not found' });
  });

  it('replay returns the original id when confirmation is retried', async () => {
    confirmContributionMock.mockResolvedValueOnce('confirm-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/confirm-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ id: 'contribution-2' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'confirm-replay' });
  });
});
