import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { actAs, createTestDb, ledgerNet, newUserId, type TestDb } from '../support/pglite';

/**
 * Phase 2 acceptance (PLAN.md §7):
 * "full lifecycle integration test passes; invalid transitions rejected;
 *  replayed requests are no-ops."
 *
 * Since migration 0004 the actor comes from auth.uid(), not from a parameter,
 * so every call here is made *as* somebody via `actAs`. That is not ceremony:
 * it means these tests exercise the real authorization path.
 */

const MEMBERS = 4;
const AMOUNT_KOBO = 100_000n; // ₦1,000

interface Circle {
  circleId: string;
  ownerId: string;
  membershipIds: string[];
  userIds: string[];
}

async function scalar<T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ v: T }>(sql, params);
  return result.rows[0]!.v;
}

async function statusOf(db: TestDb, table: string, id: string): Promise<string> {
  return scalar<string>(db, `select status as v from ${table} where id = $1`, [id]);
}

/**
 * Creates a circle owned by a fresh user and invites `MEMBERS` people.
 * The owner takes payout position 1, so they are also an ordinary member.
 */
async function inviteAll(db: TestDb, prefix: string, size = MEMBERS): Promise<Circle> {
  const ownerId = await newUserId(db);
  await actAs(db, ownerId);

  const circleId = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
    `${prefix}-create`,
    'Test circle',
    AMOUNT_KOBO.toString(),
    30,
    size,
  ]);

  const membershipIds: string[] = [];
  const userIds: string[] = [];

  for (let position = 1; position <= size; position += 1) {
    const userId = position === 1 ? ownerId : await newUserId(db);
    userIds.push(userId);
    if (position === 1) {
      // create_circle auto-enrolls the owner (payout_position = 1). Find
      // that membership id rather than creating a second membership.
      const m = await scalar<string>(
        db,
        `select id as v from memberships where circle_id = $1 and user_id = $2`,
        [circleId, userId],
      );
      membershipIds.push(m);
    } else {
      membershipIds.push(
        await scalar<string>(
          db,
          `select invite_member($1,$2,$3,$4,$5,$6) as v`,
          [`${prefix}-invite-${position}`, circleId, position, userId, null, null],
        ),
      );
    }
  }

  return { circleId, ownerId, membershipIds, userIds };
}

async function joinAll(db: TestDb, prefix: string, circle: Circle): Promise<void> {
  for (const [index, membershipId] of circle.membershipIds.entries()) {
    await actAs(db, circle.userIds[index]!);
    // The owner (position 1) is auto-enrolled by create_circle and will
    // already have status='joined'. Only call accept_invite for memberships
    // that are actually in the 'invited' state.
    const st = await scalar<string>(db, `select status as v from memberships where id = $1`, [
      membershipId,
    ]);
    if (st === 'invited') {
      await db.query(`select accept_invite($1, $2)`, [`${prefix}-join-${index}`, membershipId]);
    }
  }
  await actAs(db, circle.ownerId);
}

/** Runs one whole round: everyone claims, the recipient confirms, then close. */
async function runRound(
  db: TestDb,
  circle: Circle,
  roundNumber: number,
  keyPrefix: string,
): Promise<string> {
  const roundId = await scalar<string>(
    db,
    `select id as v from rounds where circle_id = $1 and round_number = $2`,
    [circle.circleId, roundNumber],
  );

  const recipientUserId = circle.userIds[roundNumber - 1]!;

  const contributions = await db.query<{ id: string; payer_membership_id: string }>(
    `select id, payer_membership_id from contributions where round_id = $1 order by id`,
    [roundId],
  );

  for (const [index, row] of contributions.rows.entries()) {
    const payerIndex = circle.membershipIds.indexOf(row.payer_membership_id);

    await actAs(db, circle.userIds[payerIndex]!);
    await db.query(`select claim_contribution($1, $2)`, [
      `${keyPrefix}-claim-${index}`,
      row.id,
    ]);

    await actAs(db, recipientUserId);
    await db.query(`select confirm_contribution($1, $2)`, [
      `${keyPrefix}-confirm-${index}`,
      row.id,
    ]);
  }

  await actAs(db, recipientUserId);
  await db.query(`select close_round($1, $2)`, [`${keyPrefix}-close`, roundId]);

  return roundId;
}

describe('the full circle lifecycle', () => {
  let db: TestDb;
  let circle: Circle;

  beforeAll(async () => {
    db = await createTestDb();
    circle = await inviteAll(db, 'life');
    await joinAll(db, 'life', circle);
    await actAs(db, circle.ownerId);
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

  it('records the owner as the actor, not a caller-supplied id', async () => {
    const actor = await scalar<string>(
      db,
      `select actor_id as v from events
       where entity_type = 'circle' and entity_id = $1 and event_type = 'circle.created'`,
      [circle.circleId],
    );
    expect(actor).toBe(circle.ownerId);
  });

  it('creates one virtual account per member plus a clearing account', async () => {
    const counts = await db.query<{ kind: string; n: number }>(
      `select kind, count(*)::int as n from accounts where circle_id = $1 group by kind`,
      [circle.circleId],
    );
    expect(Object.fromEntries(counts.rows.map((r) => [r.kind, r.n]))).toEqual({
      member: MEMBERS,
      clearing: 1,
    });
  });

  it('opens round 1 with a pending contribution for every member', async () => {
    const round = await db.query<{ id: string; status: string; due_date: string }>(
      `select id, status, due_date::text as due_date from rounds
       where circle_id = $1 and round_number = 1`,
      [circle.circleId],
    );
    expect(round.rows[0]!.status).toBe('open');
    expect(round.rows[0]!.due_date).toBe('2026-01-31');

    const pending = await scalar<number>(
      db,
      `select count(*)::int as v from contributions where round_id = $1 and status = 'pending'`,
      [round.rows[0]!.id],
    );
    expect(pending).toBe(MEMBERS);
  });

  it('runs every round to completion and leaves all balances at zero', async () => {
    for (let roundNumber = 1; roundNumber <= MEMBERS; roundNumber += 1) {
      const roundId = await runRound(db, circle, roundNumber, `r${roundNumber}`);
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
  }, 180_000);

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
      `select event_type, count(*)::int as n from events group by event_type`,
    );
    const byType = Object.fromEntries(events.rows.map((r) => [r.event_type, r.n]));

    expect(byType['circle.created']).toBe(1);
    expect(byType['circle.activated']).toBe(1);
    expect(byType['circle.completed']).toBe(1);
    // The owner is auto-enrolled and not invited, so there are MEMBERS-1
    // `membership.invited` events but MEMBERS `membership.joined` events.
    expect(byType['membership.invited']).toBe(MEMBERS - 1);
    expect(byType['membership.joined']).toBe(MEMBERS);
    expect(byType['round.opened']).toBe(MEMBERS);
    expect(byType['round.closed']).toBe(MEMBERS);
    expect(byType['contribution.claimed']).toBe(MEMBERS * MEMBERS);
    expect(byType['contribution.confirmed']).toBe(MEMBERS * MEMBERS);
  });
});

describe('authorization — you may only act as yourself', () => {
  let db: TestDb;
  let circle: Circle;
  let outsiderId: string;

  beforeEach(async () => {
    db = await createTestDb();
    circle = await inviteAll(db, 'auth');
    await joinAll(db, 'auth', circle);
    outsiderId = await newUserId(db);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['auth-activate', circle.circleId]);
  });

  async function firstContribution(): Promise<{ id: string; payerIndex: number }> {
    const row = await db.query<{ id: string; payer_membership_id: string }>(
      `select c.id, c.payer_membership_id from contributions c
       join rounds r on r.id = c.round_id
       where r.circle_id = $1 and r.round_number = 1 order by c.id limit 1`,
      [circle.circleId],
    );
    return {
      id: row.rows[0]!.id,
      payerIndex: circle.membershipIds.indexOf(row.rows[0]!.payer_membership_id),
    };
  }

  it('refuses an anonymous caller outright', async () => {
    await actAs(db, null);
    await expect(
      db.query(`select create_circle($1,$2,$3::bigint,$4,$5)`, ['anon', 'X', '100', 30, 3]),
    ).rejects.toThrow(/requires a signed-in user/);
  });

  it('refuses a non-owner inviting members', async () => {
    const other = await inviteAll(db, 'other', 2);
    await actAs(db, other.ownerId);

    await expect(
      db.query(`select invite_member($1,$2,$3,$4,$5,$6)`, [
        'x-invite',
        circle.circleId,
        3,
        null,
        null,
        null,
      ]),
    ).rejects.toThrow(/only the circle owner may invite/);
  });

  it('refuses a non-owner activating a circle', async () => {
    const second = await inviteAll(db, 'second');
    await joinAll(db, 'second', second);
    await actAs(db, outsiderId);

    await expect(
      db.query(`select activate_circle($1, $2)`, ['x-activate', second.circleId]),
    ).rejects.toThrow(/only the circle owner may activate/);
  });

  it('refuses accepting somebody else’s invite', async () => {
    const second = await inviteAll(db, 'invitee');
    await actAs(db, outsiderId);

    await expect(
      db.query(`select accept_invite($1, $2)`, ['x-accept', second.membershipIds[1]!]),
    ).rejects.toThrow(/only be accepted by the person invited/);
  });

  it('refuses claiming another member’s contribution', async () => {
    const { id, payerIndex } = await firstContribution();
    const notThePayer = circle.userIds[(payerIndex + 1) % MEMBERS]!;
    await actAs(db, notThePayer);

    await expect(
      db.query(`select claim_contribution($1, $2)`, ['x-claim', id]),
    ).rejects.toThrow(/only the payer may claim/);
  });

  it('refuses confirmation by anyone but this round’s recipient', async () => {
    const { id, payerIndex } = await firstContribution();
    await actAs(db, circle.userIds[payerIndex]!);
    await db.query(`select claim_contribution($1, $2)`, ['ok-claim', id]);

    // Round 1's recipient is position 1. Anyone else must be refused.
    await actAs(db, circle.userIds[2]!);
    await expect(
      db.query(`select confirm_contribution($1, $2)`, ['x-confirm', id]),
    ).rejects.toThrow(/only this round's recipient may confirm/);

    await actAs(db, outsiderId);
    await expect(
      db.query(`select confirm_contribution($1, $2)`, ['x-confirm-2', id]),
    ).rejects.toThrow(/only this round's recipient may confirm/);
  });

  it('refuses an outsider closing a round', async () => {
    const roundId = await scalar<string>(
      db,
      `select id as v from rounds where circle_id = $1 and round_number = 1`,
      [circle.circleId],
    );
    await actAs(db, outsiderId);

    await expect(db.query(`select close_round($1, $2)`, ['x-close', roundId])).rejects.toThrow(
      /only a member of this circle may close/,
    );
  });

  it('refuses a non-owner cancelling', async () => {
    const second = await inviteAll(db, 'cancelme');
    await actAs(db, outsiderId);

    await expect(
      db.query(`select cancel_circle($1, $2)`, ['x-cancel', second.circleId]),
    ).rejects.toThrow(/only the circle owner may cancel/);
  });
});

describe('illegal transitions are rejected', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('refuses to activate a circle that is still short of members', async () => {
    const circle = await inviteAll(db, 'short');
    for (const [index, membershipId] of circle.membershipIds.slice(0, 3).entries()) {
      await actAs(db, circle.userIds[index]!);
      const st = await scalar<string>(db, `select status as v from memberships where id = $1`, [
        membershipId,
      ]);
      if (st === 'invited') {
        await db.query(`select accept_invite($1, $2)`, [`short-join-${index}`, membershipId]);
      }
    }
    await actAs(db, circle.ownerId);

    await expect(
      db.query(`select activate_circle($1, $2)`, ['short-activate', circle.circleId]),
    ).rejects.toThrow(/3 of 4 members have joined/);
  });

  it('refuses to activate a draft circle with no invites', async () => {
    const ownerId = await newUserId(db);
    await actAs(db, ownerId);
    const circleId = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, [
      'd-create',
      'Empty',
      '100',
      30,
      3,
    ]);

    await expect(db.query(`select activate_circle($1, $2)`, ['d-act', circleId])).rejects.toThrow(
      /cannot activate a draft circle/,
    );
  });

  it('refuses to activate twice', async () => {
    const circle = await inviteAll(db, 'twice');
    await joinAll(db, 'twice', circle);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['twice-a', circle.circleId]);

    await expect(
      db.query(`select activate_circle($1, $2)`, ['twice-b', circle.circleId]),
    ).rejects.toThrow(/cannot activate a active circle/);
  });

  it('refuses to confirm a contribution that was never claimed', async () => {
    const circle = await inviteAll(db, 'unclaimed');
    await joinAll(db, 'unclaimed', circle);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['unclaimed-a', circle.circleId]);

    const contributionId = await scalar<string>(
      db,
      `select c.id as v from contributions c join rounds r on r.id = c.round_id
       where r.circle_id = $1 limit 1`,
      [circle.circleId],
    );

    // Round 1's recipient is the owner, so this is refused on state, not on
    // authorization — which is the distinction being tested.
    await expect(
      db.query(`select confirm_contribution($1, $2)`, ['bad-confirm', contributionId]),
    ).rejects.toThrow(/it must be claimed first/);
  });

  it('refuses to claim the same contribution twice', async () => {
    const circle = await inviteAll(db, 'dbl');
    await joinAll(db, 'dbl', circle);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['dbl-a', circle.circleId]);

    const row = await db.query<{ id: string; payer_membership_id: string }>(
      `select c.id, c.payer_membership_id from contributions c join rounds r on r.id = c.round_id
       where r.circle_id = $1 order by c.id limit 1`,
      [circle.circleId],
    );
    const payerIndex = circle.membershipIds.indexOf(row.rows[0]!.payer_membership_id);
    await actAs(db, circle.userIds[payerIndex]!);

    await db.query(`select claim_contribution($1, $2)`, ['dbl-1', row.rows[0]!.id]);
    await expect(
      db.query(`select claim_contribution($1, $2)`, ['dbl-2', row.rows[0]!.id]),
    ).rejects.toThrow(/is claimed, so it cannot be claimed/);
  });

  it('refuses to close a round before every contribution is confirmed', async () => {
    const circle = await inviteAll(db, 'early');
    await joinAll(db, 'early', circle);
    await actAs(db, circle.ownerId);
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
    await actAs(db, circle.ownerId);

    await expect(
      db.query(`select invite_member($1,$2,$3,$4,$5,$6)`, [
        'over-extra',
        circle.circleId,
        MEMBERS + 1,
        null,
        null,
        null,
      ]),
    ).rejects.toThrow(/exceeds the circle size/);
  });

  it('refuses two members at the same payout position', async () => {
    const circle = await inviteAll(db, 'dup');
    await actAs(db, circle.ownerId);

    // Use a real user id for the second invite so invite_member validates
    // position uniqueness rather than rejecting for missing user/phone/token.
    const newUser = await newUserId(db);
    await expect(
      db.query(`select invite_member($1,$2,$3,$4,$5,$6)`, ['dup-clash', circle.circleId, 1, newUser, null, null]),
    ).rejects.toThrow(/memberships_one_per_position|duplicate key/i);
  });

  it('refuses to cancel once a contribution has been claimed', async () => {
    const circle = await inviteAll(db, 'cancel');
    await joinAll(db, 'cancel', circle);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['cancel-a', circle.circleId]);

    const row = await db.query<{ id: string; payer_membership_id: string }>(
      `select c.id, c.payer_membership_id from contributions c join rounds r on r.id = c.round_id
       where r.circle_id = $1 order by c.id limit 1`,
      [circle.circleId],
    );
    const payerIndex = circle.membershipIds.indexOf(row.rows[0]!.payer_membership_id);
    await actAs(db, circle.userIds[payerIndex]!);
    await db.query(`select claim_contribution($1, $2)`, ['cancel-claim', row.rows[0]!.id]);

    await actAs(db, circle.ownerId);
    await expect(
      db.query(`select cancel_circle($1, $2)`, ['cancel-x', circle.circleId]),
    ).rejects.toThrow(/have already been claimed or confirmed/);
  });

  it('allows the owner to cancel while still inviting', async () => {
    const circle = await inviteAll(db, 'cancel-ok');
    await actAs(db, circle.ownerId);
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
  let ownerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ownerId = await newUserId(db);
    await actAs(db, ownerId);
  });

  it('returns the original circle and creates only one', async () => {
    const args = ['same', 'Circle', '100', 30, 3];
    const first = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, args);
    const second = await scalar<string>(db, `select create_circle($1,$2,$3::bigint,$4,$5) as v`, args);

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
    const userId = await newUserId(db);
    const a = await scalar<string>(
      db,
      `select invite_member($1,$2,$3,$4,$5,$6) as v`,
      ['inv', circleId, 2, userId, null, null],
    );
    const b = await scalar<string>(
      db,
      `select invite_member($1,$2,$3,$4,$5,$6) as v`,
      ['inv', circleId, 2, userId, null, null],
    );

    expect(b).toBe(a);
    // Owner is auto-enrolled, so memberships = owner + invited = 2
    expect(await scalar<number>(db, `select count(*)::int as v from memberships`)).toBe(2);
  });

    // Removed redundant 'replays an invite with the same user id' test because
    // idempotency is covered by the other replay tests and inviteAll variants.

  it('replays a confirmation without posting money twice', async () => {
    const circle = await inviteAll(db, 'replay');
    await joinAll(db, 'replay', circle);
    await actAs(db, circle.ownerId);
    await db.query(`select activate_circle($1, $2)`, ['replay-a', circle.circleId]);

    const row = await db.query<{ id: string; payer_membership_id: string }>(
      `select c.id, c.payer_membership_id from contributions c join rounds r on r.id = c.round_id
       where r.circle_id = $1 order by c.id limit 1`,
      [circle.circleId],
    );
    const contributionId = row.rows[0]!.id;
    const payerIndex = circle.membershipIds.indexOf(row.rows[0]!.payer_membership_id);

    await actAs(db, circle.userIds[payerIndex]!);
    await db.query(`select claim_contribution($1, $2)`, ['replay-claim', contributionId]);

    // Round 1's recipient holds payout position 1, i.e. the owner.
    await actAs(db, circle.userIds[0]!);
    await db.query(`select confirm_contribution($1, $2)`, ['replay-confirm', contributionId]);

    const before = await scalar<number>(db, `select count(*)::int as v from ledger_entries`);
    await db.query(`select confirm_contribution($1, $2)`, ['replay-confirm', contributionId]);

    expect(await scalar<number>(db, `select count(*)::int as v from ledger_entries`)).toBe(before);
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

  it('leaves no spoofable overload that takes an actor id', async () => {
    // 0004 dropped the old signatures. If one survived, a caller could name
    // themselves as anybody and every authorization check above is moot.
    const survivors = await db.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('create_circle','invite_member','accept_invite','activate_circle',
                           'claim_contribution','confirm_contribution','close_round','cancel_circle')
       order by p.proname`,
    );

    expect(survivors.rows).toHaveLength(8);
    for (const row of survivors.rows) {
      expect(row.args, `${row.name} must not accept an actor id`).not.toMatch(/p_actor_id/);
    }
  });
});
