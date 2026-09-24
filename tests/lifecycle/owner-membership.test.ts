import { beforeEach, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newUserId, type TestDb } from '../support/pglite';

/**
 * The owner is a member of their own circle (migration 0009).
 *
 * Before this, create_circle inserted the circle and nothing else, so a new
 * three-person circle read "0 of 3 joined" and the owner had to look their own
 * phone number up to invite themselves. Every fixture in the suite wrote that
 * step out by hand, which is exactly how an unnatural flow survives: the tests
 * made it look normal.
 */

let db: TestDb;
let owner: string;

beforeEach(async () => {
  db = await createTestDb();
  owner = await newUserId(db);
  await actAs(db, owner);
});

async function createCircle(key = 'own-1', memberTarget = 3): Promise<string> {
  const result = await db.query<{ v: string }>(
    `select create_circle($1,$2,$3::bigint,$4,$5) as v`,
    [key, 'Family', '100000', 30, memberTarget],
  );
  return result.rows[0]!.v;
}

describe('create_circle enrols whoever created it', () => {
  it('joins the owner at position 1, already joined', async () => {
    const circleId = await createCircle();

    const rows = await db.query<{
      user_id: string;
      payout_position: number;
      status: string;
      joined_at: string | null;
    }>(`select user_id, payout_position, status, joined_at from memberships where circle_id = $1`, [
      circleId,
    ]);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.user_id).toBe(owner);
    expect(rows.rows[0]!.payout_position).toBe(1);
    expect(rows.rows[0]!.status).toBe('joined');
    expect(rows.rows[0]!.joined_at).not.toBeNull();
  });

  it('leaves the circle in draft, because no invite has been sent', async () => {
    const circleId = await createCircle();
    const status = await db.query<{ status: string }>(`select status from circles where id = $1`, [
      circleId,
    ]);
    expect(status.rows[0]!.status).toBe('draft');
  });

  it('records one membership.joined and no invite', async () => {
    // Not an invite the owner instantly accepts: there is nobody to accept
    // from, and two events would describe something that never happened.
    const circleId = await createCircle();

    const events = await db.query<{ event_type: string; from_state: string | null }>(
      `select e.event_type, e.from_state
         from events e
         join memberships m on m.id = e.entity_id
        where e.entity_type = 'membership' and m.circle_id = $1`,
      [circleId],
    );

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.event_type).toBe('membership.joined');
    expect(events.rows[0]!.from_state).toBeNull();
  });

  it('does not enrol the owner twice when the request is replayed', async () => {
    await createCircle('replayed');
    await createCircle('replayed');

    const count = await db.query<{ n: number }>(`select count(*)::int as n from memberships`);
    expect(count.rows[0]!.n).toBe(1);
  });

  it('counts the owner towards the circle being full', async () => {
    // A two-person circle now needs exactly one invite, not two.
    const circleId = await createCircle('two', 2);
    const other = await newUserId(db);

    const membership = await db.query<{ v: string }>(
      `select invite_member($1,$2,$3,$4) as v`,
      ['two-inv', circleId, other, 2],
    );
    await actAs(db, other);
    await db.query(`select accept_invite($1,$2)`, ['two-join', membership.rows[0]!.v]);

    await actAs(db, owner);
    await expect(
      db.query(`select activate_circle($1,$2)`, ['two-act', circleId]),
    ).resolves.toBeDefined();

    const status = await db.query<{ status: string }>(`select status from circles where id = $1`, [
      circleId,
    ]);
    expect(status.rows[0]!.status).toBe('active');
  });

  it('gives the owner the first payout, and a contribution of their own', async () => {
    const circleId = await createCircle('rot', 2);
    const other = await newUserId(db);
    const membership = await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
      'rot-inv',
      circleId,
      other,
      2,
    ]);
    await actAs(db, other);
    await db.query(`select accept_invite($1,$2)`, ['rot-join', membership.rows[0]!.v]);
    await actAs(db, owner);
    await db.query(`select activate_circle($1,$2)`, ['rot-act', circleId]);

    const round = await db.query<{ recipient: string }>(
      `select m.user_id as recipient
         from rounds r join memberships m on m.id = r.recipient_membership_id
        where r.circle_id = $1 and r.round_number = 1`,
      [circleId],
    );
    expect(round.rows[0]!.recipient).toBe(owner);

    // The owner pays in as well as collecting — they are an ordinary member.
    const payers = await db.query<{ n: number }>(
      `select count(*)::int as n
         from contributions c
         join rounds r on r.id = c.round_id
         join memberships m on m.id = c.payer_membership_id
        where r.circle_id = $1 and m.user_id = $2`,
      [circleId, owner],
    );
    expect(payers.rows[0]!.n).toBe(1);
  });
});

describe('the owner cannot be added a second time', () => {
  it('refuses an invite to the owner themselves', async () => {
    const circleId = await createCircle();

    await expect(
      db.query(`select invite_member($1,$2,$3,$4)`, ['dup-owner', circleId, owner, 2]),
    ).rejects.toThrow(/memberships_one_per_user_per_circle|duplicate key/i);
  });

  it('refuses an invite to position 1', async () => {
    const circleId = await createCircle();
    const other = await newUserId(db);

    await expect(
      db.query(`select invite_member($1,$2,$3,$4)`, ['dup-pos', circleId, other, 1]),
    ).rejects.toThrow(/memberships_one_per_position|duplicate key/i);
  });
});
