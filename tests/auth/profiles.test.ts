import { describe, expect, it } from 'vitest';

import { createTestDb } from '../support/pglite';

describe('profile bootstrap on signup', () => {
  it('creates a public profile when a new auth user is inserted', async () => {
    const db = await createTestDb();
    const userId = '11111111-1111-4111-8111-111111111111';

    await db.query(
      `insert into auth.users (id, email, phone, raw_user_meta_data)
       values ($1, $2, $3, $4)`,
      [userId, 'alice@example.com', '+2348000000000', { full_name: 'Alice Smith' }],
    );

    const result = await db.query<{ display_name: string; phone: string | null }>(
      `select display_name, phone from public.profiles where id = $1`,
      [userId],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      display_name: 'Alice Smith',
      phone: '+2348000000000',
    });
  });

  it('enforces the memberships.user_id foreign key against auth.users', async () => {
    const db = await createTestDb();
    const userId = '22222222-2222-4222-8222-222222222222';
    const circleId = '33333333-3333-4333-8333-333333333333';

    await db.query(
      `insert into auth.users (id, email, phone, raw_user_meta_data)
       values ($1, $2, $3, $4)`,
      [userId, 'bob@example.com', '+2348000000001', { full_name: 'Bob Jones' }],
    );

    await db.query(
      `insert into circles (id, name, amount_kobo, period_days, member_target, created_by)
       values ($1, 'Project Circle', 1000, 30, 3, $2)`,
      [circleId, userId],
    );

    await expect(
      db.query(
        `insert into memberships (circle_id, user_id, payout_position, status)
         values ($1, $2, 1, 'joined')`,
        [circleId, userId],
      ),
    ).resolves.toBeDefined();

    await expect(
      db.query(
        `insert into memberships (circle_id, user_id, payout_position, status)
         values ($1, gen_random_uuid(), 2, 'joined')`,
        [circleId],
      ),
    ).rejects.toThrow(/foreign key|violates foreign key/);
  });
});
