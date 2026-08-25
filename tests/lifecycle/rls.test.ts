import { beforeAll, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newUserId, type TestDb } from '../support/pglite';

/**
 * Row Level Security (migration 0004) — the Phase 1/2 deferral, paid off.
 *
 * Grants decide which TABLES a role may read; RLS decides which ROWS. Without
 * policies, any signed-in user could read every circle in the database, which
 * for a money app means every other family's finances.
 *
 * These tests `set role authenticated` so the policies actually apply — the
 * superuser that runs migrations bypasses RLS, so a test that forgets this
 * would pass while proving nothing.
 */

async function asAuthenticated<T>(
  db: TestDb,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  await actAs(db, userId);
  await db.query(`set role authenticated`);
  try {
    return await run();
  } finally {
    await db.query(`reset role`);
  }
}

async function countVisible(db: TestDb, userId: string, relation: string): Promise<number> {
  return asAuthenticated(db, userId, async () => {
    const result = await db.query<{ n: number }>(`select count(*)::int as n from ${relation}`);
    return result.rows[0]!.n;
  });
}

describe('RLS scopes every read to your own circles', () => {
  let db: TestDb;
  let aliceId: string;
  let bobId: string;
  let strangerId: string;

  beforeAll(async () => {
    db = await createTestDb();

    aliceId = await newUserId(db);
    bobId = await newUserId(db);
    strangerId = await newUserId(db);

    // Alice's circle: Alice and Bob.
    await actAs(db, aliceId);
    const aliceCircle = (
      await db.query<{ v: string }>(`select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
        'a-create',
        "Alice's circle",
        '100000',
        30,
        2,
      ])
    ).rows[0]!.v;

    const aliceMembership = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        'a-inv-1',
        aliceCircle,
        aliceId,
        1,
      ])
    ).rows[0]!.v;
    const bobMembership = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        'a-inv-2',
        aliceCircle,
        bobId,
        2,
      ])
    ).rows[0]!.v;

    await actAs(db, aliceId);
    await db.query(`select accept_invite($1,$2)`, ['a-join-1', aliceMembership]);
    await actAs(db, bobId);
    await db.query(`select accept_invite($1,$2)`, ['a-join-2', bobMembership]);

    await actAs(db, aliceId);
    await db.query(`select activate_circle($1,$2)`, ['a-activate', aliceCircle]);

    // A completely separate circle the stranger owns alone with someone else.
    const otherUser = await newUserId(db);
    await actAs(db, strangerId);
    const strangerCircle = (
      await db.query<{ v: string }>(`select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
        's-create',
        "Stranger's circle",
        '50000',
        30,
        2,
      ])
    ).rows[0]!.v;
    const sm1 = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        's-inv-1',
        strangerCircle,
        strangerId,
        1,
      ])
    ).rows[0]!.v;
    const sm2 = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        's-inv-2',
        strangerCircle,
        otherUser,
        2,
      ])
    ).rows[0]!.v;
    await actAs(db, strangerId);
    await db.query(`select accept_invite($1,$2)`, ['s-join-1', sm1]);
    await actAs(db, otherUser);
    await db.query(`select accept_invite($1,$2)`, ['s-join-2', sm2]);
    await actAs(db, strangerId);
    await db.query(`select activate_circle($1,$2)`, ['s-activate', strangerCircle]);

    await actAs(db, null);
  }, 120_000);

  it('shows a superuser both circles — proving the fixtures really exist', async () => {
    const total = await db.query<{ n: number }>(`select count(*)::int as n from circles`);
    expect(total.rows[0]!.n).toBe(2);
  });

  it('shows each member only their own circle', async () => {
    expect(await countVisible(db, aliceId, 'circles')).toBe(1);
    expect(await countVisible(db, bobId, 'circles')).toBe(1);
    expect(await countVisible(db, strangerId, 'circles')).toBe(1);
  });

  it('hides another circle’s rounds and contributions', async () => {
    // Two circles × 1 open round each, but each member sees only theirs.
    expect(await countVisible(db, aliceId, 'rounds')).toBe(1);
    expect(await countVisible(db, aliceId, 'contributions')).toBe(2);
    expect(await countVisible(db, strangerId, 'rounds')).toBe(1);
  });

  it('hides another circle’s accounts and ledger', async () => {
    // 2 members + 1 clearing per circle.
    expect(await countVisible(db, aliceId, 'accounts')).toBe(3);
    expect(await countVisible(db, strangerId, 'accounts')).toBe(3);
  });

  it('hides another circle’s memberships', async () => {
    expect(await countVisible(db, aliceId, 'memberships')).toBe(2);
    expect(await countVisible(db, strangerId, 'memberships')).toBe(2);
  });

  it('shows a user with no circles nothing at all', async () => {
    const nobody = await newUserId(db);
    expect(await countVisible(db, nobody, 'circles')).toBe(0);
    expect(await countVisible(db, nobody, 'memberships')).toBe(0);
    expect(await countVisible(db, nobody, 'rounds')).toBe(0);
    expect(await countVisible(db, nobody, 'contributions')).toBe(0);
    expect(await countVisible(db, nobody, 'accounts')).toBe(0);
    expect(await countVisible(db, nobody, 'events')).toBe(0);
  });

  it('scopes the audit log to your own circles', async () => {
    const alice = await countVisible(db, aliceId, 'events');
    const stranger = await countVisible(db, strangerId, 'events');
    const total = (await db.query<{ n: number }>(`select count(*)::int as n from events`)).rows[0]!
      .n;

    expect(alice).toBeGreaterThan(0);
    expect(stranger).toBeGreaterThan(0);
    // Neither member sees the whole log.
    expect(alice).toBeLessThan(total);
    expect(stranger).toBeLessThan(total);
  });

  it('has RLS enabled on every table holding circle data', async () => {
    const result = await db.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public'
         and tablename in ('profiles','circles','memberships','rounds','contributions',
                           'accounts','transfers','ledger_entries','events')
       order by tablename`,
    );

    expect(result.rows).toHaveLength(9);
    for (const row of result.rows) {
      expect(row.rowsecurity, `${row.tablename} must have RLS enabled`).toBe(true);
    }
  });
});
