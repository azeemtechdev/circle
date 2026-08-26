import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimContributionMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async claimContribution(input: { idempotencyKey: string; id: string }) {
      return claimContributionMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/claim-contribution/route';

describe('POST /api/circles/claim-contribution', () => {
  beforeEach(() => {
    claimContributionMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/claim-contribution', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('uses the authenticated server client and returns the contribution id', async () => {
    claimContributionMock.mockResolvedValueOnce('contribution-claimed');

    const response = await POST(
      new Request('http://localhost/api/circles/claim-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(claimContributionMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      id: 'contribution-1',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'contribution-claimed' });
  });

  it('maps state-machine conflicts to 409', async () => {
    claimContributionMock.mockRejectedValueOnce(Object.assign(new Error('claim is not valid in the current round state'), { code: 'check_violation' }));

    const response = await POST(
      new Request('http://localhost/api/circles/claim-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'contribution-1' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'claim is not valid in the current round state' });
  });

  it('replay returns the original id when the claim is retried', async () => {
    claimContributionMock.mockResolvedValueOnce('claim-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/claim-contribution', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'repeat-key',
        },
        body: JSON.stringify({ id: 'contribution-2' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'claim-replay' });
  });
});
