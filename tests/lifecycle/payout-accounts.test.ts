import { beforeAll, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newAuthUser, type TestDb } from '../support/pglite';

/**
 * Payout accounts (migration 0010): where a member wants to be paid.
 *
 * The rules under test are the ones that make showing bank details safe:
 * only people who have JOINED a circle with you can read them, only you can
 * write your own, a malformed account number never gets stored, and every
 * change lands in the audit log — the trail a dispute would follow if a
 * hijacked account swapped the details before payout day.
 *
 * Reads run under `set role authenticated`; the superuser bypasses RLS and
 * would prove nothing.
 */

async function asAuthenticated<T>(db: TestDb, userId: string, run: () => Promise<T>): Promise<T> {
  await actAs(db, userId);
  await db.query(`set role authenticated`);
  try {
    return await run();
  } finally {
    await db.query(`reset role`);
  }
}

async function visibleOwners(db: TestDb, viewer: string): Promise<string[]> {
  return asAuthenticated(db, viewer, async () => {
    const result = await db.query<{ user_id: string }>(
      `select user_id from payout_accounts order by user_id`,
    );
    return result.rows.map((r) => r.user_id);
  });
}

async function setDetails(
  db: TestDb,
  userId: string,
  bank: string,
  number: string,
  name: string,
): Promise<void> {
  await actAs(db, userId);
  await db.query(`select set_my_payout_account($1, $2, $3)`, [bank, number, name]);
}

async function eventsFor(db: TestDb, userId: string) {
  const result = await db.query<{ event_type: string; metadata: Record<string, string> }>(
    `select event_type, metadata from events
      where entity_type = 'payout_account' and entity_id = $1
      order by created_at`,
    [userId],
  );
  return result.rows;
}

describe('who can see payout accounts', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;
  let carol: string;
  let stranger: string;
  let carolMembership: string;

  beforeAll(async () => {
    db = await createTestDb();
    alice = await newAuthUser(db, { email: 'alice@example.com', displayName: 'Alice' });
    bob = await newAuthUser(db, { email: 'bob@example.com', displayName: 'Bob' });
    carol = await newAuthUser(db, { email: 'carol@example.com', displayName: 'Carol' });
    stranger = await newAuthUser(db, { email: 'stranger@example.com', displayName: 'Stranger' });

    // Alice owns a three-person circle. Bob joins; Carol is invited but has
    // not accepted yet.
    await actAs(db, alice);
    const circle = (
      await db.query<{ v: string }>(`select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
        'pa-create',
        'Family',
        '500000',
        30,
        3,
      ])
    ).rows[0]!.v;
    const bobMembership = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        'pa-inv-bob',
        circle,
        bob,
        2,
      ])
    ).rows[0]!.v;
    carolMembership = (
      await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
        'pa-inv-carol',
        circle,
        carol,
        3,
      ])
    ).rows[0]!.v;

    await actAs(db, bob);
    await db.query(`select accept_invite($1,$2)`, ['pa-join-bob', bobMembership]);

    await setDetails(db, alice, 'GTBank', '0123456789', 'Alice Adeyemi');
    await setDetails(db, bob, 'Access Bank', '1111111111', 'Bob Bello');
    await setDetails(db, carol, 'Opay', '2222222222', 'Carol Chukwu');
    await setDetails(db, stranger, 'Kuda', '3333333333', 'Stranger Danger');
  });

  it('shows joined circle-mates each other, and themselves', async () => {
    expect(await visibleOwners(db, alice)).toEqual([alice, bob].sort());
    expect(await visibleOwners(db, bob)).toEqual([alice, bob].sort());
  });

  it('shows an invitee who has not joined only their own row', async () => {
    expect(await visibleOwners(db, carol)).toEqual([carol]);
  });

  it('does not show an invitee’s details to the circle before they join', async () => {
    expect(await visibleOwners(db, alice)).not.toContain(carol);
  });

  it('shows a stranger only their own row', async () => {
    expect(await visibleOwners(db, stranger)).toEqual([stranger]);
  });

  it('opens up once the invitee joins', async () => {
    await actAs(db, carol);
    await db.query(`select accept_invite($1,$2)`, ['pa-join-carol', carolMembership]);
    expect(await visibleOwners(db, carol)).toEqual([alice, bob, carol].sort());
    expect(await visibleOwners(db, alice)).toContain(carol);
  });

  it('gives anon no read access at all', async () => {
    const result = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.payout_accounts', 'select') as ok`,
    );
    expect(result.rows[0]!.ok).toBe(false);
  });

  it('gives no role a direct write path', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['insert', 'update', 'delete']) {
        const result = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.payout_accounts', $2) as ok`,
          [role, privilege],
        );
        expect(result.rows[0]!.ok, `${role} can ${privilege}`).toBe(false);
      }
    }
  });

  it('refuses a direct update even of your own row', async () => {
    await expect(
      asAuthenticated(db, bob, () =>
        db.query(`update payout_accounts set account_number = '9999999999' where user_id = $1`, [
          bob,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('set_my_payout_account', () => {
  let db: TestDb;
  let user: string;

  beforeAll(async () => {
    db = await createTestDb();
    user = await newAuthUser(db, { email: 'payee@example.com', displayName: 'Payee' });
  });

  it('refuses a caller who is not signed in', async () => {
    await actAs(db, null);
    await expect(
      db.query(`select set_my_payout_account($1,$2,$3)`, ['GTBank', '0123456789', 'Nobody']),
    ).rejects.toThrow();
  });

  it.each([
    ['nine digits', '012345678'],
    ['eleven digits', '01234567890'],
    ['letters', '01234567ab'],
    ['dashes', '0123-456-789'],
  ])('rejects an account number with %s', async (_label, number) => {
    await actAs(db, user);
    await expect(
      db.query(`select set_my_payout_account($1,$2,$3)`, ['GTBank', number, 'Payee Person']),
    ).rejects.toThrow(/exactly 10 digits/);
  });

  it('rejects a blank bank or account name', async () => {
    await actAs(db, user);
    await expect(
      db.query(`select set_my_payout_account($1,$2,$3)`, ['  ', '0123456789', 'Payee']),
    ).rejects.toThrow(/choose your bank/);
    await expect(
      db.query(`select set_my_payout_account($1,$2,$3)`, ['GTBank', '0123456789', ' ']),
    ).rejects.toThrow(/name on the account/);
  });

  it('stores nothing after a rejected save', async () => {
    const result = await db.query(`select 1 from payout_accounts where user_id = $1`, [user]);
    expect(result.rows).toHaveLength(0);
  });

  it('accepts spaces the way people read a number aloud, and keeps a leading zero', async () => {
    await setDetails(db, user, 'GTBank', '0123 456 789', 'Payee Person');
    const result = await db.query<{ account_number: string }>(
      `select account_number from payout_accounts where user_id = $1`,
      [user],
    );
    expect(result.rows[0]!.account_number).toBe('0123456789');
  });

  it('records the first save as added, with only the last four digits', async () => {
    const events = await eventsFor(db, user);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('payout_account.added');
    expect(events[0]!.metadata['account_number_last4']).toBe('6789');
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('0123456789');
  });

  it('treats an identical save as a no-op: no event, no updated_at bump', async () => {
    const before = await db.query<{ updated_at: string }>(
      `select updated_at::text from payout_accounts where user_id = $1`,
      [user],
    );
    await setDetails(db, user, 'GTBank', '0123456789', 'Payee Person');
    const after = await db.query<{ updated_at: string }>(
      `select updated_at::text from payout_accounts where user_id = $1`,
      [user],
    );
    expect(after.rows[0]!.updated_at).toBe(before.rows[0]!.updated_at);
    expect(await eventsFor(db, user)).toHaveLength(1);
  });

  it('records a change, and marks the row as edited since it was first entered', async () => {
    await setDetails(db, user, 'GTBank', '9876543210', 'Payee Person');

    const events = await eventsFor(db, user);
    expect(events.map((e) => e.event_type)).toEqual([
      'payout_account.added',
      'payout_account.changed',
    ]);
    expect(events[1]!.metadata['account_number_last4']).toBe('3210');

    const row = await db.query<{ edited: boolean }>(
      `select updated_at > created_at as edited from payout_accounts where user_id = $1`,
      [user],
    );
    expect(row.rows[0]!.edited).toBe(true);
  });

  it('only ever writes the caller’s own row', async () => {
    const other = await newAuthUser(db, { email: 'other@example.com', displayName: 'Other' });
    await setDetails(db, other, 'Kuda', '5555555555', 'Other Person');

    const mine = await db.query<{ account_number: string }>(
      `select account_number from payout_accounts where user_id = $1`,
      [user],
    );
    expect(mine.rows[0]!.account_number).toBe('9876543210');
  });
});

describe('grants on set_my_payout_account', () => {
  it('is not executable by public or anon', async () => {
    const db = await createTestDb();
    for (const role of ['public', 'anon']) {
      const result = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.set_my_payout_account(text, text, text)', 'EXECUTE') as ok`,
        [role],
      );
      expect(result.rows[0]!.ok, `${role} can execute`).toBe(false);
    }
  });
});
