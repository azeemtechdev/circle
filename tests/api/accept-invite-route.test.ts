import { beforeEach, describe, expect, it, vi } from 'vitest';

const acceptInviteMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async acceptInvite(input: { idempotencyKey: string; id?: string; inviteToken?: string | null; phone?: string | null }) {
      return acceptInviteMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/accept-invite/route';

describe('POST /api/circles/accept-invite', () => {
  beforeEach(() => {
    acceptInviteMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'membership-1' }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('accepts a tokenized invite and returns the membership id', async () => {
    acceptInviteMock.mockResolvedValueOnce('membership-456');

    const response = await POST(
      new Request('http://localhost/api/circles/accept-invite', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ inviteToken: 'abc123' }),
      }),
    );

    expect(acceptInviteMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      inviteToken: 'abc123',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'membership-456' });
  });

  it('maps authorization failures to 403', async () => {
    acceptInviteMock.mockRejectedValueOnce(Object.assign(new Error('this invite is not for this user'), { code: 'insufficient_privilege' }));

    const response = await POST(
      new Request('http://localhost/api/circles/accept-invite', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ id: 'membership-1' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'this invite is not for this user' });
  });

  it('replay returns the original membership id for the same token', async () => {
    acceptInviteMock.mockResolvedValueOnce('membership-replay');

    const response = await POST(
      new Request('http://localhost/api/circles/accept-invite', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-repeat',
        },
        body: JSON.stringify({ inviteToken: 'repeat-token' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'membership-replay' });
  });
});
