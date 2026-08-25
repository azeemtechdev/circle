import { beforeEach, describe, expect, it } from 'vitest';

import {
  accountBalance,
  createTestDb,
  ledgerNet,
  seedCircleAccounts,
  type TestDb,
} from '../support/pglite';

/**
 * The money rules, tested against the real migration SQL.
 *
 * These are the invariants from PLAN.md §4. They are written first and they are
 * the ones that must never regress: if any test in this file fails, the ledger
 * cannot be trusted and nothing else matters.
 */

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

/** Calls post_double_entry and returns the transfer id. */
async function post(
  key: string,
  debitAccountId: string,
  creditAccountId: string,
  amountKobo: bigint,
): Promise<string> {
  const result = await db.query<{ transfer_id: string }>(
    `select post_double_entry($1, $2, $3, $4::bigint) as transfer_id`,
    [key, debitAccountId, creditAccountId, amountKobo.toString()],
  );
  return result.rows[0]!.transfer_id;
}

describe('invariant 1 — double-entry: every movement is exactly two rows', () => {
  it('writes one debit and one credit of equal size', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);

    const transferId = await post('t1', memberAccountIds[0]!, clearingAccountId, 100_000n);

    const rows = await db.query<{ direction: string; amount_kobo: string; account_id: string }>(
      `select direction, amount_kobo::text as amount_kobo, account_id
       from ledger_entries where transfer_id = $1 order by direction`,
      [transferId],
    );

    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.direction).toBe('credit');
    expect(rows.rows[1]!.direction).toBe('debit');
    expect(rows.rows[0]!.amount_kobo).toBe('100000');
    expect(rows.rows[1]!.amount_kobo).toBe('100000');
  });

  it('refuses a second debit for the same transfer', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const transferId = await post('t1', memberAccountIds[0]!, clearingAccountId, 100n);

    await expect(
      db.query(
        `insert into ledger_entries (transfer_id, account_id, direction, amount_kobo)
         values ($1, $2, 'debit', 100)`,
        [transferId, memberAccountIds[1]!],
      ),
    ).rejects.toThrow(/ledger_entries_one_per_direction|duplicate key/i);
  });
});

describe('invariant 2 — append-only', () => {
  it('refuses UPDATE on ledger_entries, for every role', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    await post('t1', memberAccountIds[0]!, clearingAccountId, 500n);

    await expect(db.query(`update ledger_entries set amount_kobo = 1`)).rejects.toThrow(
      /append-only/i,
    );
  });

  it('refuses DELETE on ledger_entries, for every role', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    await post('t1', memberAccountIds[0]!, clearingAccountId, 500n);

    await expect(db.query(`delete from ledger_entries`)).rejects.toThrow(/append-only/i);
  });

  it('refuses UPDATE and DELETE on events', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    await post('t1', memberAccountIds[0]!, clearingAccountId, 500n);

    await expect(db.query(`update events set event_type = 'x'`)).rejects.toThrow(/append-only/i);
    await expect(db.query(`delete from events`)).rejects.toThrow(/append-only/i);
  });

  // Regression: row-level triggers do not fire on TRUNCATE, so without a
  // statement-level guard "append-only" was one careless command from false.
  it('refuses TRUNCATE on ledger_entries and events', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    await post('t1', memberAccountIds[0]!, clearingAccountId, 500n);

    await expect(db.query(`truncate ledger_entries`)).rejects.toThrow(/append-only/i);
    await expect(db.query(`truncate events`)).rejects.toThrow(/append-only/i);
    await expect(db.query(`truncate ledger_entries, events`)).rejects.toThrow(/append-only/i);
  });

  // CLAUDE.md requires the grant itself to be absent, not just the trigger.
  it('grants no UPDATE or DELETE on ledger_entries to the application roles', async () => {
    const result = await db.query<{
      role: string;
      can_update: boolean;
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
    }>(
      `select r as role,
              has_table_privilege(r, 'public.ledger_entries', 'UPDATE') as can_update,
              has_table_privilege(r, 'public.ledger_entries', 'DELETE') as can_delete,
              has_table_privilege(r, 'public.ledger_entries', 'INSERT') as can_insert,
              has_table_privilege(r, 'public.ledger_entries', 'SELECT') as can_select
       from unnest(array['anon','authenticated','service_role']) as r`,
    );

    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.can_update, `${row.role} must not UPDATE`).toBe(false);
      expect(row.can_delete, `${row.role} must not DELETE`).toBe(false);
      // Writes go through post_double_entry, never direct INSERT.
      expect(row.can_insert, `${row.role} must not INSERT directly`).toBe(false);
      // Migration 0002 took SELECT away from anon: an anonymous request could
      // otherwise read every circle's full financial history. Row Level
      // Security will scope member reads once `memberships` exists (Phase 2).
      // See tests/ledger/grants.test.ts for the full read-grant matrix.
      expect(row.can_select, `${row.role} read access`).toBe(row.role !== 'anon');
    }
  });
});

describe('invariant 3 — balances are computed from entries', () => {
  it('derives balances from the ledger, with debits negative', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);

    await post('t1', memberAccountIds[0]!, clearingAccountId, 250_000n);

    expect(await accountBalance(db, memberAccountIds[0]!)).toBe(-250_000n);
    expect(await accountBalance(db, clearingAccountId)).toBe(250_000n);
    expect(await accountBalance(db, memberAccountIds[1]!)).toBe(0n);
  });
});

describe('invariant 4 — money is integer kobo, and exact', () => {
  it('stores an amount larger than Number.MAX_SAFE_INTEGER without loss', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    // 2^53 + 1 — the first integer a JS double cannot represent.
    const beyondDouble = 9_007_199_254_740_993n;

    await post('t1', memberAccountIds[0]!, clearingAccountId, beyondDouble);

    expect(await accountBalance(db, clearingAccountId)).toBe(beyondDouble);
    expect(await ledgerNet(db)).toBe(0n);
  });

  it('rejects a zero or negative amount', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);

    await expect(post('zero', memberAccountIds[0]!, clearingAccountId, 0n)).rejects.toThrow(
      /positive integer/i,
    );
    await expect(post('neg', memberAccountIds[0]!, clearingAccountId, -5n)).rejects.toThrow(
      /positive integer/i,
    );
  });
});

describe('invariant 5 — idempotency: replays are no-ops', () => {
  it('returns the original transfer and writes nothing on replay', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);

    const first = await post('same-key', memberAccountIds[0]!, clearingAccountId, 1_000n);
    const second = await post('same-key', memberAccountIds[0]!, clearingAccountId, 1_000n);

    expect(second).toBe(first);

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from ledger_entries`,
    );
    expect(count.rows[0]!.n).toBe(2);
    expect(await accountBalance(db, clearingAccountId)).toBe(1_000n);
  });

  it('requires an idempotency key', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);

    await expect(post('   ', memberAccountIds[0]!, clearingAccountId, 1_000n)).rejects.toThrow(
      /idempotency key is required/i,
    );
  });
});

describe('invariant — the ledger always sums to zero', () => {
  it('holds after an arbitrary sequence of valid postings', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 5);

    // A deterministic pseudo-random walk. Fixed seed, so a failure is
    // reproducible — Math.random() would make this test lie about itself.
    let seed = 42;
    const nextInt = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };

    for (let i = 0; i < 40; i += 1) {
      const from = memberAccountIds[nextInt(memberAccountIds.length)]!;
      const towardsClearing = nextInt(2) === 0;
      const amount = BigInt(nextInt(500_000) + 1);

      await post(
        `walk-${i}`,
        towardsClearing ? from : clearingAccountId,
        towardsClearing ? clearingAccountId : from,
        amount,
      );

      expect(await ledgerNet(db)).toBe(0n);
    }
  });
});

describe('reversing entries — corrections never edit history', () => {
  it('nets the original to zero while leaving both rows visible', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const original = await post('t1', memberAccountIds[0]!, clearingAccountId, 7_500n);

    const reversalResult = await db.query<{ id: string }>(
      `select post_reversal($1, $2, $3) as id`,
      ['t1-rev', original, 'paid twice by mistake'],
    );
    const reversalId = reversalResult.rows[0]!.id;

    expect(reversalId).not.toBe(original);
    expect(await accountBalance(db, memberAccountIds[0]!)).toBe(0n);
    expect(await accountBalance(db, clearingAccountId)).toBe(0n);
    expect(await ledgerNet(db)).toBe(0n);

    // Four rows, not two: the history of both the mistake and the correction.
    const count = await db.query<{ n: number }>(`select count(*)::int as n from ledger_entries`);
    expect(count.rows[0]!.n).toBe(4);
  });

  it('refuses to reverse the same transfer twice', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const original = await post('t1', memberAccountIds[0]!, clearingAccountId, 100n);

    await db.query(`select post_reversal($1, $2)`, ['rev-1', original]);

    await expect(db.query(`select post_reversal($1, $2)`, ['rev-2', original])).rejects.toThrow(
      /already been reversed/i,
    );
  });

  it('refuses to reverse a reversal', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const original = await post('t1', memberAccountIds[0]!, clearingAccountId, 100n);

    const rev = await db.query<{ id: string }>(`select post_reversal($1, $2) as id`, [
      'rev-1',
      original,
    ]);

    await expect(
      db.query(`select post_reversal($1, $2)`, ['rev-2', rev.rows[0]!.id]),
    ).rejects.toThrow(/itself a reversal/i);
  });

  it('is idempotent on the reversal key', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const original = await post('t1', memberAccountIds[0]!, clearingAccountId, 100n);

    const a = await db.query<{ id: string }>(`select post_reversal($1, $2) as id`, ['r', original]);
    const b = await db.query<{ id: string }>(`select post_reversal($1, $2) as id`, ['r', original]);

    expect(b.rows[0]!.id).toBe(a.rows[0]!.id);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from ledger_entries`);
    expect(count.rows[0]!.n).toBe(4);
  });
});

describe('events — every posting leaves an audit trail', () => {
  it('writes a transfer.posted event naming the accounts', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 2);
    const transferId = await post('t1', memberAccountIds[0]!, clearingAccountId, 4_200n);

    const events = await db.query<{
      event_type: string;
      entity_id: string;
      metadata: { amount_kobo: string; debit_account_id: string };
    }>(`select event_type, entity_id, metadata from events where entity_id = $1`, [transferId]);

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.event_type).toBe('transfer.posted');
    expect(events.rows[0]!.metadata.amount_kobo).toBe('4200');
    expect(events.rows[0]!.metadata.debit_account_id).toBe(memberAccountIds[0]!);
  });
});
