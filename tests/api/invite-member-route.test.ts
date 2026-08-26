import { beforeEach, describe, expect, it, vi } from 'vitest';

const inviteMemberMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ kind: 'server' })),
}));

vi.mock('@/lib/circles/circles', () => ({
  CircleService: class {
    async inviteMember(input: {
      idempotencyKey: string;
      circleId: string;
      userId?: string | null;
      phone?: string | null;
      inviteToken?: string | null;
      payoutPosition: number;
    }) {
      return inviteMemberMock(input);
    }
  },
  CircleError: class extends Error {},
}));

vi.mock('@/lib/circles/supabase-port', () => ({
  SupabaseCirclePort: class {},
}));

import { POST } from '@/app/api/circles/invite-member/route';

describe('POST /api/circles/invite-member', () => {
  beforeEach(() => {
    inviteMemberMock.mockReset();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/circles/invite-member', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ circleId: 'circle-1', userId: 'user-1', payoutPosition: 1 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Idempotency-Key header is required.' });
  });

  it('accepts a phone-based invite and returns the created id', async () => {
    inviteMemberMock.mockResolvedValueOnce('invite-123');

    const response = await POST(
      new Request('http://localhost/api/circles/invite-member', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-1',
        },
        body: JSON.stringify({ circleId: 'circle-1', phone: '+2348000000000', payoutPosition: 2 }),
      }),
    );

    expect(inviteMemberMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'key-1',
      circleId: 'circle-1',
      phone: '+2348000000000',
      payoutPosition: 2,
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'invite-123' });
  });

  it('maps auth failures to 403', async () => {
    inviteMemberMock.mockRejectedValueOnce(Object.assign(new Error('only the circle owner may invite members'), { code: 'insufficient_privilege' }));

    const response = await POST(
      new Request('http://localhost/api/circles/invite-member', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'key-2',
        },
        body: JSON.stringify({ circleId: 'circle-1', userId: 'user-1', payoutPosition: 1 }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'only the circle owner may invite members' });
  });
});
