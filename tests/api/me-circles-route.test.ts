import { beforeEach, describe, expect, it, vi } from 'vitest';

const authGetUser = vi.fn();
const membershipsQuery = vi.fn();
const circlesQuery = vi.fn();

vi.mock('@/lib/circles/route-helpers', () => ({
  getCircleRouteClient: () => ({
    auth: { getUser: authGetUser },
    from: (table: string) => {
      if (table === 'memberships') return membershipsQuery();
      if (table === 'circles') return circlesQuery();
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { GET } from '@/app/api/circles/me/route';

describe('GET /api/circles/me', () => {
  beforeEach(() => {
    authGetUser.mockReset();
    membershipsQuery.mockReset();
    circlesQuery.mockReset();
  });

  it('returns the signed-in user circles for the dashboard', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    membershipsQuery.mockReturnValue({
      select: () => ({
        eq: () => ({
          neq: async () => ({ data: [{ circle_id: 'circle-1' }, { circle_id: 'circle-2' }], error: null }),
        }),
      }),
    });

    circlesQuery.mockReturnValue({
      select: () => ({
        in: async () => ({
          data: [
            { id: 'circle-1', name: 'Alpha Circle', status: 'active', amount_kobo: '100000', member_target: 3, period_days: 30 },
            { id: 'circle-2', name: 'Beta Circle', status: 'draft', amount_kobo: '50000', member_target: 2, period_days: 14 },
          ],
          error: null,
        }),
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      circles: [
        { id: 'circle-1', name: 'Alpha Circle', status: 'active' },
        { id: 'circle-2', name: 'Beta Circle', status: 'draft' },
      ],
    });
  });

  it('requires a signed-in user', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Authentication required.' });
  });
});
