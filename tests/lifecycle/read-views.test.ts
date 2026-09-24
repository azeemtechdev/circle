import { beforeAll, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newAuthUser, type TestDb } from '../support/pglite';

/**
 * The read views (migration 0008).
 *
 * Two things must hold, and the second is the dangerous one:
 *
 *   1. Money leaves as text. A BIGINT selected through PostgREST arrives as a
 *      JSON double and is silently wrong above 2^53.
 *   2. RLS still applies. A view without `security_invoker = true` runs as its
 *      owner and bypasses the policies on the tables underneath — which would
 *      make every circle in the database readable by anyone signed in, through
 *      the very views the dashboard uses.
 *
 * These run with `set role authenticated`, because the superuser that applies
 * migrations bypasses RLS and a test that forgets this proves nothing.
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

let db: TestDb;
let alice: string;
let bob: string;
let stranger: string;
let aliceCircle: string;

beforeAll(async () => {
  db = await createTestDb();

  alice = await newAuthUser(db, { email: 'alice@example.com', displayName: 'Alice' });
  bob = await newAuthUser(db, { email: 'bob@example.com', displayName: 'Bob' });
  stranger = await newAuthUser(db, { email: 'stranger@example.com', displayName: 'Stranger' });

  // Alice's circle, with an amount that a double cannot hold exactly.
  await actAs(db, alice);
  const created = await db.query<{ v: string }>(
    `select create_circle($1,$2,$3::bigint,$4,$5) as v`,
    ['rv-create', 'Family', '9007199254740993', 30, 2],
  );
  aliceCircle = created.rows[0]!.v;

  const m1 = await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
    'rv-i1',
    aliceCircle,
    alice,
    1,
  ]);
  const m2 = await db.query<{ v: string }>(`select invite_member($1,$2,$3,$4) as v`, [
    'rv-i2',
    aliceCircle,
    bob,
    2,
  ]);

  await actAs(db, alice);
  await db.query(`select accept_invite($1,$2)`, ['rv-a1', m1.rows[0]!.v]);
  await actAs(db, bob);
  await db.query(`select accept_invite($1,$2)`, ['rv-a2', m2.rows[0]!.v]);

  await actAs(db, alice);
  await db.query(`select activate_circle($1,$2,$3::date)`, ['rv-act', aliceCircle, '2026-03-01']);

  // A circle the stranger owns, to prove the views do not leak across circles.
  await actAs(db, stranger);
  await db.query(`select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
    'rv-other',
    'Not yours',
    '5000',
    7,
    2,
  ]);
});

describe('money leaves the database as text', () => {
  it('keeps an amount above 2^53 exact in my_circles', async () => {
    const rows = await asAuthenticated(db, alice, async () => {
      const result = await db.query<{ amount_kobo_text: string }>(
        `select amount_kobo_text from my_circles where id = $1`,
        [aliceCircle],
      );
      return result.rows;
    });

    expect(rows[0]!.amount_kobo_text).toBe('9007199254740993');
    expect(typeof rows[0]!.amount_kobo_text).toBe('string');
    // The value a double would have produced.
    expect(rows[0]!.amount_kobo_text).not.toBe('9007199254740992');
    expect(BigInt(rows[0]!.amount_kobo_text)).toBe(9007199254740993n);
  });

  it('exposes no bare bigint money column on any view', async () => {
    // A column added later without ::text would reintroduce the double.
    const result = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('my_circles','circle_members','circle_rounds','round_contributions')
          and data_type = 'bigint'`,
    );
    expect(result.rows).toEqual([]);
  });

  it('returns the pot and each contribution as text', async () => {
    const rows = await asAuthenticated(db, alice, async () => {
      const result = await db.query<{ pot_kobo_text: string }>(
        `select pot_kobo_text from circle_rounds where circle_id = $1 and round_number = 1`,
        [aliceCircle],
      );
      return result.rows;
    });
    // Nothing confirmed yet.
    expect(rows[0]!.pot_kobo_text).toBe('0');

    const contributions = await asAuthenticated(db, alice, async () => {
      const result = await db.query<{ amount_kobo_text: string }>(
        `select amount_kobo_text from round_contributions where circle_id = $1`,
        [aliceCircle],
      );
      return result.rows;
    });
    expect(contributions.length).toBe(2);
    for (const row of contributions) {
      expect(row.amount_kobo_text).toBe('9007199254740993');
    }
  });
});

describe('the views do not bypass RLS', () => {
  it.each([
    ['my_circles'],
    ['circle_members'],
    ['circle_rounds'],
    ['round_contributions'],
  ])('%s is declared security_invoker', async (view) => {
    // The structural guarantee. Without this flag a view runs as its owner and
    // every policy from 0004 stops applying to it.
    const result = await db.query<{ ok: boolean }>(
      `select coalesce(
                (select 'true' = any(
                   select split_part(opt, '=', 2)
                     from unnest(c.reloptions) as opt
                    where opt like 'security_invoker=%')
                ), false) as ok
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1`,
      [view],
    );
    expect(result.rows[0]!.ok, `${view} must be security_invoker`).toBe(true);
  });

  it('shows a member their own circle', async () => {
    const rows = await asAuthenticated(db, bob, async () => {
      const result = await db.query<{ id: string }>(`select id from my_circles`);
      return result.rows;
    });
    expect(rows.map((r) => r.id)).toContain(aliceCircle);
  });

  it('hides a circle from someone who is not in it', async () => {
    const rows = await asAuthenticated(db, stranger, async () => {
      const result = await db.query<{ id: string }>(`select id from my_circles`);
      return result.rows;
    });
    expect(rows.map((r) => r.id)).not.toContain(aliceCircle);
  });

  it.each([
    ['circle_members'],
    ['circle_rounds'],
    ['round_contributions'],
  ])('hides another circle’s rows in %s', async (view) => {
    const rows = await asAuthenticated(db, stranger, async () => {
      const result = await db.query<{ n: number }>(
        `select count(*)::int as n from ${view} where circle_id = $1`,
        [aliceCircle],
      );
      return result.rows;
    });
    expect(rows[0]!.n).toBe(0);
  });

  it('gives anon no access to the views at all', async () => {
    for (const view of ['my_circles', 'circle_members', 'circle_rounds', 'round_contributions']) {
      const result = await db.query<{ ok: boolean }>(
        `select has_table_privilege('anon', $1, 'select') as ok`,
        [`public.${view}`],
      );
      expect(result.rows[0]!.ok, `anon can read ${view}`).toBe(false);
    }
  });
});

describe('the dashboard can answer its questions', () => {
  it('names whose turn it is and when it is due', async () => {
    const rows = await asAuthenticated(db, bob, async () => {
      const result = await db.query<{
        recipient_name: string;
        due_date: string;
        status: string;
        contribution_count: number;
      }>(
        `select recipient_name, due_date::text as due_date, status, contribution_count
           from circle_rounds where circle_id = $1 and round_number = 1`,
        [aliceCircle],
      );
      return result.rows;
    });

    expect(rows[0]!.recipient_name).toBe('Alice');
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.contribution_count).toBe(2);
    // activated 2026-03-01, period 30 days, round 1.
    expect(rows[0]!.due_date).toBe('2026-03-31');
  });

  it('lists who has paid, by name', async () => {
    const rows = await asAuthenticated(db, alice, async () => {
      const result = await db.query<{ payer_name: string; status: string }>(
        `select payer_name, status from round_contributions
          where circle_id = $1 order by payer_name`,
        [aliceCircle],
      );
      return result.rows;
    });

    expect(rows.map((r) => r.payer_name)).toEqual(['Alice', 'Bob']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('counts members and joiners for the invite screen', async () => {
    const rows = await asAuthenticated(db, alice, async () => {
      const result = await db.query<{ member_count: number; joined_count: number }>(
        `select member_count, joined_count from my_circles where id = $1`,
        [aliceCircle],
      );
      return result.rows;
    });

    expect(rows[0]).toEqual({ member_count: 2, joined_count: 2 });
  });
});
