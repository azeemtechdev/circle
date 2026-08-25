import { beforeAll, describe, expect, it } from 'vitest';

import { Ledger } from '@/lib/ledger/ledger';
import { nairaToKobo } from '@/lib/money';

import { createTestDb, ledgerNet, type TestDb } from '../support/pglite';
import { PgliteLedgerPort } from '../support/pglite-port';

/**
 * Phase 1 acceptance criterion (PLAN.md §7):
 * "simulate a full 5-member circle rotation in a test with fake entries;
 *  all invariants hold; reconciliation passes."
 *
 * The circle: 5 members, ₦1,000 a round, 5 rounds, each member receives the
 * pot exactly once. Every member contributes every round, including the round
 * in which they are the recipient — so after a full rotation every member has
 * paid ₦5,000 and received ₦5,000, and every balance in the circle is exactly
 * zero. That closing state is the strongest single assertion in this phase: if
 * a kobo had gone astray anywhere across 60 ledger rows, it would not hold.
 */

const MEMBER_COUNT = 5;
const CONTRIBUTION = nairaToKobo(1_000n); // ₦1,000 = 100,000 kobo

describe('a full 5-member circle rotation', () => {
  let db: TestDb;
  let ledger: Ledger;
  let circleId: string;
  let memberAccountIds: string[];
  let clearingAccountId: string;
  let netAfterEveryPosting: bigint[];

  beforeAll(async () => {
    db = await createTestDb();
    ledger = new Ledger(new PgliteLedgerPort(db));
    netAfterEveryPosting = [];

    const circle = await db.query<{ id: string }>('select gen_random_uuid() as id');
    circleId = circle.rows[0]!.id;

    memberAccountIds = [];
    for (let position = 0; position < MEMBER_COUNT; position += 1) {
      const inserted = await db.query<{ id: string }>(
        `insert into accounts (circle_id, membership_id, kind)
         values ($1, gen_random_uuid(), 'member') returning id`,
        [circleId],
      );
      memberAccountIds.push(inserted.rows[0]!.id);
    }

    const clearing = await db.query<{ id: string }>(
      `insert into accounts (circle_id, membership_id, kind)
       values ($1, null, 'clearing') returning id`,
      [circleId],
    );
    clearingAccountId = clearing.rows[0]!.id;

    // Run the rotation. Round N pays out to the member at position N.
    for (let round = 0; round < MEMBER_COUNT; round += 1) {
      for (let payer = 0; payer < MEMBER_COUNT; payer += 1) {
        await ledger.post({
          idempotencyKey: `round-${round}-contribution-${payer}`,
          fromAccountId: memberAccountIds[payer]!,
          toAccountId: clearingAccountId,
          amountKobo: CONTRIBUTION,
          memo: `round ${round + 1} contribution`,
        });
        netAfterEveryPosting.push(await ledgerNet(db));
      }

      await ledger.post({
        idempotencyKey: `round-${round}-payout`,
        fromAccountId: clearingAccountId,
        toAccountId: memberAccountIds[round]!,
        amountKobo: CONTRIBUTION * BigInt(MEMBER_COUNT),
        memo: `round ${round + 1} payout`,
      });
      netAfterEveryPosting.push(await ledgerNet(db));
    }
  }, 120_000);

  it('keeps the ledger summed to zero after every single posting', () => {
    expect(netAfterEveryPosting).toHaveLength(MEMBER_COUNT * (MEMBER_COUNT + 1));
    for (const net of netAfterEveryPosting) {
      expect(net).toBe(0n);
    }
  });

  it('leaves every member with a zero balance once the rotation completes', async () => {
    for (const [position, accountId] of memberAccountIds.entries()) {
      const balance = await ledger.balance(accountId);
      expect(balance, `member at position ${position}`).toBe(0n);
    }
  });

  it('leaves the clearing account empty', async () => {
    expect(await ledger.balance(clearingAccountId)).toBe(0n);
  });

  it('pays each member exactly once', async () => {
    const payouts = await db.query<{ account_id: string; n: number }>(
      `select le.account_id, count(*)::int as n
       from ledger_entries le
       join transfers t on t.id = le.transfer_id
       where le.direction = 'credit' and t.debit_account_id = $1
       group by le.account_id`,
      [clearingAccountId],
    );

    expect(payouts.rows).toHaveLength(MEMBER_COUNT);
    for (const row of payouts.rows) {
      expect(row.n, `account ${row.account_id}`).toBe(1);
    }
  });

  it('writes two ledger rows per movement and nothing more', async () => {
    const movements = MEMBER_COUNT * (MEMBER_COUNT + 1); // 25 contributions + 5 payouts
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from ledger_entries`);
    expect(rows.rows[0]!.n).toBe(movements * 2);
  });

  it('leaves an audit event for every movement', async () => {
    const movements = MEMBER_COUNT * (MEMBER_COUNT + 1);
    const events = await db.query<{ n: number }>(
      `select count(*)::int as n from events where event_type = 'transfer.posted'`,
    );
    expect(events.rows[0]!.n).toBe(movements);
  });

  it('passes reconciliation', async () => {
    const report = await ledger.reconcile();

    expect(report.failures, JSON.stringify(report.failures)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
  });

  it('is fully replayable: re-running the whole rotation changes nothing', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from ledger_entries`);

    for (let round = 0; round < MEMBER_COUNT; round += 1) {
      for (let payer = 0; payer < MEMBER_COUNT; payer += 1) {
        await ledger.post({
          idempotencyKey: `round-${round}-contribution-${payer}`,
          fromAccountId: memberAccountIds[payer]!,
          toAccountId: clearingAccountId,
          amountKobo: CONTRIBUTION,
        });
      }
      await ledger.post({
        idempotencyKey: `round-${round}-payout`,
        fromAccountId: clearingAccountId,
        toAccountId: memberAccountIds[round]!,
        amountKobo: CONTRIBUTION * BigInt(MEMBER_COUNT),
      });
    }

    const after = await db.query<{ n: number }>(`select count(*)::int as n from ledger_entries`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(await ledgerNet(db)).toBe(0n);
  }, 120_000);
});
