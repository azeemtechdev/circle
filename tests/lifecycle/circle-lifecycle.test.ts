import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, ledgerNet, type TestDb } from '../support/pglite';

/**
 * Phase 2 acceptance (PLAN.md §7):
 * "full lifecycle integration test passes; invalid transitions rejected;
 *  replayed requests are no-ops."
 *
 * The transitions live in SQL, so these tests drive the same functions the API
 * routes will call. Nothing here writes a status column directly — that is the
 * point.
 */

const MEMBERS = 4;
const AMOUNT_KOBO = 100_000n; // ₦1,000

interface Circle {
  circleId: string;
  membershipIds: string[];
  userIds: string[];
}

async function scalar<T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ v: T }>(sql, params);
  return result.rows[0]!.v;
}

/** Creates a circle and invites every member, leaving it in `inviting`. */
async function inviteAll(db: TestDb, prefix: string): Promise<Circle> {
  const circleId = await scalar<string>(
    db,
    `select create_circle($1, $2, $3::bigint, $4, $5) as v`,
    [`${prefix}-create`, 'Test circle', AMOUNT_KOBO.toString(), 30, MEMBERS],
  );

  const membershipIds: string[] = [];
  const userIds: string[] = [];
  for (let position = 1; position <= MEMBERS; position += 1) {
    const userId = await scalar<string>(db, `select gen_random_uuid() as v`);
    userIds.push(userId);
    membershipIds.push(
      await scalar<string>(db, `select invite_member($1, $2, $3, $4) as v`, [
        `${prefix}-invite-${position}`,
        circleId,
        userId,
        position,
      ]),
    );
  }

  return { circleId, membershipIds, userIds };
}

async function joinAll(db: TestDb, prefix: string, circle: Circle): Promise<void> {
  for (const [index, membershipId] of circle.membershipIds.entries()) {
    await db.query(`select accept_invite($1, $2)`, [`${prefix}-join-${index}`, membershipId]);
  }
}

async function statusOf(db: TestDb, table: string, id: string): Promise<string> {
  return scalar<string>(db, `select status as v from ${table} where id = $1`, [id]);
}

describe('the full circle lifecycle', () => {
  let db: TestDb;
  let circle: Circle;

  beforeAll(async () => {
    db = await createTestDb();
    circle = await inviteAll(db, 'life');
    await joinAll(db, 'life', circle);
    await db.query(`select activate_circle($1, $2, $3::date)`, [
      'life-activate',
      circle.circleId,
      '2026-01-01',
    ]);
  }, 120_000);

  it('walks draft → inviting → active', async () => {
    expect(await statusOf(db, 'circles', circle.circleId)).toBe('active');

    const history = await db.query<{ to_state: string }>(
      `select to_state from events
       where entity_type = 'circle' and entity_id = $1 order by created_at, id`,
      [circle.circleId],
    );
    expect(history.rows.map((r) => r.to_state)).toEqual(['draft', 'inviting', 'active']);
  });

  it('creates one virtual account per member plus a clearing account', async () => {
    const counts = await db.query<{ kind: string; n: number }>(
      `select kind, count(*)::int as n from accounts where circle_id = $1 group by kind`,
      [circle.circleId],
    );
    const byKind = Object.fromEntries(counts.rows.map((r) => [r.kind, r.n]));
    expect(byKind).toEqual({ member: MEMBERS, clearing: 1 });
  });

  it('opens round 1 with a pending contribution for every member', async () => {
    const round = await db.query<{ id: string; status: string; due_date: string }>(
      `select id, status, due_date::text as due_date from rounds
       where circle_id = $1 and round_number = 1`,
      [circle.circleId],
    );
    expect(round.rows[0]!.status).toBe('open');
    // activated 2026-01-01 + 30 days × round 1
    expect(round.rows[0]!.due_date).toBe('2026-01-31');

    const contributions = await db.query<{ n: number }>(
      `select count(*)::int as n from contributions where round_id = $1 and status = 'pending'`,
      [round.rows[0]!.id],
    );
    expect(contributions.rows[0]!.n).toBe(MEMBERS);
  });

  it('runs every round to completion and leaves all balances at zero', async () => {
    for (let roundNumber = 1; roundNumber <= MEMBERS; roundNumber += 1) {
      const roundId = await scalar<string>(
        db,
        `select id as v from rounds where circle_id = $1 and round_number = $2`,
        [circle.circleId, roundNumber],
      );

      const contributions = await db.query<{ id: string }>(
        `select id from contributions where round_id = $1 order by id`,
        [roundId],
      );

      for (const [index, row] of contributions.rows.entries()) {
        await db.query(`select claim_contribution($1, $2)`, [`r${roundNumber}-claim-${index}`, row.id]);

        // The first claim moves the round from open to collecting.
        if (index === 0) {
          expect(await statusOf(db, 'rounds', roundId)).toBe('collecting');
        }

        await db.query(`select confirm_contribution($1, $2)`, [
          `r${roundNumber}-confirm-${index}`,
          row.id,
        ]);
      }

      // Last confirmation settles the round.
      expect(await statusOf(db, 'rounds', roundId)).toBe('settled');

      await db.query(`select close_round($1, $2)`, [`r${roundNumber}-close`, roundId]);
      expect(await statusOf(db, 'rounds', roundId)).toBe('closed');
      expect(await ledgerNet(db)).toBe(0n);
    }

    expect(await statusOf(db, 'circles', circle.circleId)).toBe('completed');

    const balances = await db.query<{ balance: string }>(
      `select balance_kobo::text as balance from account_balances where circle_id = $1`,
      [circle.circleId],
    );
    expect(balances.rows).toHaveLength(MEMBERS + 1);
    for (const row of balances.rows) {
      expect(BigInt(row.balance)).toBe(0n);
    }
  }, 120_000);

  it('paid each member the full pot exactly once', async () => {
    const pot = AMOUNT_KOBO * BigInt(MEMBERS);
    const payouts = await db.query<{ amount: string; n: number }>(
      `select t.amount_kobo::text as amount, count(*)::int as n
       from transfers t
       join accounts a on a.id = t.debit_account_id
       where a.circle_id = $1 and a.kind = 'clearing'
       group by t.amount_kobo`,
      [circle.circleId],
    );
    expect(payouts.rows).toHaveLength(1);
    expect(BigInt(payouts.rows[0]!.amount)).toBe(pot);
    expect(payouts.rows[0]!.n).toBe(MEMBERS);
  });

  it('recorded an event for every transition', async () => {
    const events = await db.query<{ event_type: string; n: number }>(
      `select event_type, count(*)::int as n from events group by event_type order by event_type`,
    );
    const byType = Object.fromEntries(events.rows.map((r) => [r.event_type, r.n]));

    expect(byType['circle.created']).toBe(1);
    expect(byType['circle.activated']).toBe(1);
    expect(byType['circle.completed']).toBe(1);
    expect(byType['membership.invited']).toBe(MEMBERS);
    expect(byType['membership.joined']).toBe(MEMBERS);
    expect(byType['round.opened']).toBe(MEMBERS);
    expect(byType['round.closed']).toBe(MEMBERS);
    expect(byType['contribution.claimed']).toBe(MEMBERS * MEMBERS);
    expect(byType['contribution.confirmed']).toBe(MEMBERS * MEMBERS);
  });
});

describe('illegal transitions are rejected', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('refuses to activate a circle that is still short of members', async () => {
    const circle = await inviteAll(db, 'short');
    // Only three of four accept.
    for (const [index, membershipId] of circle.membershipIds.slice(0, 3).entries()) {
      await db.query(`select accept_invite($1, $2)`, [`short-join-${index}`, membershipId]);
    }

    await expect(
      db.query(`select activate_circle($1, $2)`, ['short-activate', circle.circleId]),
    ).rejects.toThrow(/3 of 4 members have joined/);
  });

  it('refuses to activate a draft circle with no invites', async () => {
    const circleId = await scalar<string>(
      db,
      `select create_circle($1, $2, $3::bigint, $4, $5) as v`,
      ['d-create', 'Empty', '100', 30, 3],
    );

    await expect(db.query(`select activate_circle($1, $2)`, ['d-act', circleId])).rejects.toThrow(
      /cannot activate a draft circle/,
    );
  });

  it('refuses to activate twice', async () => {
    const circle = await inviteAll(db, 'twice');
    await joinAll(db, 'twice', circle);
    await db.query(`select activate_circle($1, $2)`, ['twice-a', circle.circleId]);

    await expect(
      db.query(`select activate_circle($1, $2)`, ['twice-b', circle.circleId]),
    ).rejects.toThrow(/cannot activate a active circle/);
  });

  it('refuses to confirm a contribution that was never claimed', async () => {
    const circle = await inviteAll(db, 'unclaimed');
    await joinAll(db, 'unclaimed', circle);
    await db.query(`select activate_circle($1, $2)`, ['unclaimed-a', circle.circleId]);

    const contributionId = await scalar<string>(
      db,
      `select c.id as v from contributions c
       join rounds r on r.id = c.round_id where r.circle_id = $1 limit 1`,
      [circle.circleId],
    );

    await expect(
      db.query(`select confirm_contribution($1, $2)`, ['bad-confirm', contributionId]),
    ).rejects.toThrow(/it must be claimed first/);
  });

  it('refuses to claim the same contribution twice', async () => {
    const circle = await inviteAll(db, 'dbl');
    await joinAll(db, 'dbl', circle);
    await db.query(`select activate_circle($1, $2)`, ['dbl-a', circle.circleId]);

    const contributionId = await scalar<string>(
      db,
      `select c.id as v from contributions c
       join rounds r on r.id = c.round_id where r.circle_id = $1 limit 1`,
      [circle.circleId],
    );

    await db.query(`select claim_contribution($1, $2)`, ['dbl-1', contributionId]);
    // A different key, so this is a genuine second claim rather than a replay.
    await expect(
      db.query(`select claim_contribution($1, $2)`, ['dbl-2', contributionId]),
    ).rejects.toThrow(/is claimed, so it cannot be claimed/);
  });

  it('refuses to close a round before every contribution is confirmed', async () => {
    const circle = await inviteAll(db, 'early');
    await joinAll(db, 'early', circle);
    await db.query(`select activate_circle($1, $2)`, ['early-a', circle.circleId]);

    const roundId = await scalar<string>(
      db,
      `select id as v from rounds where circle_id = $1 and round_number = 1`,
      [circle.circleId],
    );

    await expect(db.query(`select close_round($1, $2)`, ['early-close', roundId])).rejects.toThrow(
      /every contribution must be confirmed first/,
    );
  });

  it('refuses to invite past the circle size', async () => {
    const circle = await inviteAll(db, 'over');

    await expect(
      db.query(`select invite_member($1, $2, gen_random_uuid(), $3)`, [
        'over-extra',
        circle.circleId,
        MEMBERS + 1,
      ]),
    ).rejects.toThrow(/exceeds the circle size/);
  });

  it('refuses two members at the same payout position', async () => {
    const circle = await inviteAll(db, 'dup');

    await expect(
      db.query(`select invite_member($1, $2, gen_random_uuid(), $3)`, [
        'dup-clash',
        circle.circleId,
        1,
      ]),
    ).rejects.toThrow(/memberships_one_per_position|duplicate key/i);
  });

  it('refuses to cancel once a contribution has been claimed', async () => {
    const circle = await inviteAll(db, 'cancel');
    await joinAll(db, 'cancel', circle);
    await db.query(`select activate_circle($1, $2)`, ['cancel-a', circle.circleId]);

    const contributionId = await scalar<string>(
      db,
      `select c.id as v from contributions c
       join rounds r on r.id = c.round_id where r.circle_id = $1 limit 1`,
      [circle.circleId],
    );
    await db.query(`select claim_contribution($1, $2)`, ['cancel-claim', contributionId]);

    await expect(
      db.query(`select cancel_circle($1, $2)`, ['cancel-x', circle.circleId]),
    ).rejects.toThrow(/have already been claimed or confirmed/);
  });

  it('allows cancelling while still inviting', async () => {
    const circle = await inviteAll(db, 'cancel-ok');
    await db.query(`select cancel_circle($1, $2, $3)`, [
      'cancel-ok-x',
      circle.circleId,
      'changed our minds',
    ]);
    expect(await statusOf(db, 'circles', circle.circleId)).toBe('cancelled');
  });
});

describe('replayed requests are no-ops', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('returns the original circle and creates only one', async () => {
    const first = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
      'same',
      'Circle',
      '100',
      30,
      3,
    ]);
    const second = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
      'same',
      'Circle',
      '100',
      30,
      3,
    ]);

    expect(second).toBe(first);
    expect(await scalar<number>(db, `select count(*)::int as v from circles`)).toBe(1);
  });

  it('replays an invite without adding a membership', async () => {
    const circleId = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
      'c',
      'Circle',
      '100',
      30,
      3,
    ]);
    const userId = await scalar<string>(db, `select gen_random_uuid() as v`);

    const a = await scalar<string>(db, `select invite_member($1,$2,$3,$4) as v`, [
      'inv',
      circleId,
      userId,
      1,
    ]);
    const b = await scalar<string>(db, `select invite_member($1,$2,$3,$4) as v`, [
      'inv',
      circleId,
      userId,
      1,
    ]);

    expect(b).toBe(a);
    expect(await scalar<number>(db, `select count(*)::int as v from memberships`)).toBe(1);
  });

  it('replays a confirmation without posting money twice', async () => {
    const circle = await inviteAll(db, 'replay');
    await joinAll(db, 'replay', circle);
    await db.query(`select activate_circle($1, $2)`, ['replay-a', circle.circleId]);

    const contributionId = await scalar<string>(
      db,
      `select c.id as v from contributions c
       join rounds r on r.id = c.round_id where r.circle_id = $1 limit 1`,
      [circle.circleId],
    );

    await db.query(`select claim_contribution($1, $2)`, ['replay-claim', contributionId]);
    await db.query(`select confirm_contribution($1, $2)`, ['replay-confirm', contributionId]);

    const entriesAfterFirst = await scalar<number>(
      db,
      `select count(*)::int as v from ledger_entries`,
    );

    await db.query(`select confirm_contribution($1, $2)`, ['replay-confirm', contributionId]);

    expect(await scalar<number>(db, `select count(*)::int as v from ledger_entries`)).toBe(
      entriesAfterFirst,
    );
    expect(await ledgerNet(db)).toBe(0n);
  }, 60_000);

  it('requires an idempotency key', async () => {
    await expect(
      db.query(`select create_circle($1,$2,$3::bigint,$4,$5)`, ['  ', 'Circle', '100', 30, 3]),
    ).rejects.toThrow(/idempotency key is required/);
  });
});

describe('status columns cannot be written directly', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  it.each(['circles', 'memberships', 'rounds', 'contributions'])(
    'grants no write on %s to any application role',
    async (table) => {
      const result = await db.query<{ role: string; writes: boolean }>(
        `select r as role,
                (has_table_privilege(r, $1, 'INSERT')
                 or has_table_privilege(r, $1, 'UPDATE')
                 or has_table_privilege(r, $1, 'DELETE')) as writes
         from unnest(array['anon','authenticated','service_role']) as r`,
        [`public.${table}`],
      );
      for (const row of result.rows) {
        expect(row.writes, `${row.role} must not write ${table} directly`).toBe(false);
      }
    },
  );

  it('denies anon everything, including reads', async () => {
    const result = await db.query<{ relation: string; readable: boolean }>(
      `select r as relation, has_table_privilege('anon', r, 'SELECT') as readable
       from unnest(array['public.circles','public.memberships','public.rounds','public.contributions']) as r`,
    );
    for (const row of result.rows) {
      expect(row.readable, `anon must not read ${row.relation}`).toBe(false);
    }
  });

  it('denies anon and authenticated the internal helpers', async () => {
    for (const signature of [
      'open_round(uuid, int, uuid)',
      'record_transition(text, uuid, text, text, text, uuid, jsonb)',
    ]) {
      for (const role of ['anon', 'authenticated']) {
        const allowed = await scalar<boolean>(
          db,
          `select has_function_privilege($1, $2, 'EXECUTE') as v`,
          [role, `public.${signature}`],
        );
        expect(allowed, `${role} must not execute ${signature}`).toBe(false);
      }
    }
  });
});
