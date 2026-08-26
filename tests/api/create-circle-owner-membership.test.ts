import { describe, expect, it } from 'vitest';

import { actAs, createTestDb, type TestDb } from '../support/pglite';

async function createCircleForUser(db: TestDb, userId: string) {
  await actAs(db, userId);

  const result = await db.query<{ v: string }>(
    `select create_circle($1, $2, $3::bigint, $4, $5) as v`,
    ['owner-create', 'Owner circle', '100000', 30, 3],
  );

  return result.rows[0]!.v;
}

describe('create_circle owner auto-enrollment', () => {
  it('creates a membership for the circle owner when the circle is created', async () => {
    const db = await createTestDb();
    const ownerId = '44444444-4444-4444-8444-444444444444';

    const circleId = await createCircleForUser(db, ownerId);

    const membership = await db.query<{ circle_id: string; user_id: string; payout_position: number; status: string }>(
      `select circle_id, user_id, payout_position, status
       from memberships
       where circle_id = $1 and user_id = $2`,
      [circleId, ownerId],
    );

    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0]).toMatchObject({
      circle_id: circleId,
      user_id: ownerId,
      payout_position: 1,
      status: 'joined',
    });
  });
});
