import { beforeAll, describe, expect, it } from 'vitest';

import { Ledger, LedgerError } from '@/lib/ledger/ledger';
import type { LedgerPort } from '@/lib/ledger/port';

import { createTestDb, seedCircleAccounts, type TestDb } from '../support/pglite';
import { PgliteLedgerPort } from '../support/pglite-port';

describe('Ledger service', () => {
  let db: TestDb;
  let ledger: Ledger;

  beforeAll(async () => {
    db = await createTestDb();
    ledger = new Ledger(new PgliteLedgerPort(db));
  }, 60_000);

  it('converts money across the boundary without loss', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 1);
    const beyondDouble = 9_007_199_254_740_993n;

    await ledger.post({
      idempotencyKey: 'big',
      fromAccountId: memberAccountIds[0]!,
      toAccountId: clearingAccountId,
      amountKobo: beyondDouble,
    });

    expect(await ledger.balance(clearingAccountId)).toBe(beyondDouble);
    expect(await ledger.balance(memberAccountIds[0]!)).toBe(-beyondDouble);
  });

  it('rejects a non-positive amount before it reaches the database', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 1);

    await expect(
      ledger.post({
        idempotencyKey: 'zero',
        fromAccountId: memberAccountIds[0]!,
        toAccountId: clearingAccountId,
        amountKobo: 0n,
      }),
    ).rejects.toThrow(/must be positive kobo/);
  });

  it('rejects a transfer from an account to itself', async () => {
    const { clearingAccountId } = await seedCircleAccounts(db, 1);

    await expect(
      ledger.post({
        idempotencyKey: 'self',
        fromAccountId: clearingAccountId,
        toAccountId: clearingAccountId,
        amountKobo: 100n,
      }),
    ).rejects.toThrow(LedgerError);
  });

  it('rejects a blank idempotency key', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 1);

    await expect(
      ledger.post({
        idempotencyKey: '  ',
        fromAccountId: memberAccountIds[0]!,
        toAccountId: clearingAccountId,
        amountKobo: 100n,
      }),
    ).rejects.toThrow(/idempotency key is required/i);
  });

  it('throws for an unknown account rather than reporting a zero balance', async () => {
    const unknown = await db.query<{ id: string }>('select gen_random_uuid() as id');

    await expect(ledger.balance(unknown.rows[0]!.id)).rejects.toThrow(/No such account/);
  });

  it('reverses a posting through the service', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 1);

    const transferId = await ledger.post({
      idempotencyKey: 'to-reverse',
      fromAccountId: memberAccountIds[0]!,
      toAccountId: clearingAccountId,
      amountKobo: 12_345n,
    });

    await ledger.reverse({ idempotencyKey: 'the-reversal', transferId, memo: 'wrong member' });

    expect(await ledger.balance(memberAccountIds[0]!)).toBe(0n);
  });

  it('treats an empty reconciliation result as a failure, not a pass', async () => {
    const emptyPort: LedgerPort = {
      postDoubleEntry: async () => 'unused',
      postReversal: async () => 'unused',
      accountBalanceKoboText: async () => null,
      reconcile: async () => [],
    };

    await expect(new Ledger(emptyPort).reconcile()).rejects.toThrow(/did not run/);
  });
});

describe('reconciliation actually detects drift', () => {
  // A reconciliation job that only ever returns "ok" is worthless. These tests
  // corrupt the ledger on purpose and prove each check fires. They write to
  // ledger_entries directly as the database owner — the application roles
  // cannot do this, which is the point of the revoked grants.
  let db: TestDb;
  let ledger: Ledger;

  beforeAll(async () => {
    db = await createTestDb();
    ledger = new Ledger(new PgliteLedgerPort(db));
  }, 60_000);

  it('passes on an empty but valid ledger', async () => {
    const report = await ledger.reconcile();
    expect(report.ok).toBe(true);
  });

  it('catches an unbalanced transfer and a non-zero ledger sum', async () => {
    const { memberAccountIds, clearingAccountId } = await seedCircleAccounts(db, 1);

    const transferId = await ledger.post({
      idempotencyKey: 'good',
      fromAccountId: memberAccountIds[0]!,
      toAccountId: clearingAccountId,
      amountKobo: 1_000n,
    });

    expect(transferId).toBeTruthy();

    // Smuggle in a lone credit with no matching debit. It needs its own
    // transfer: the unique index on (transfer_id, direction) already makes a
    // second credit against an existing transfer impossible, so the schema
    // blocks the cruder form of this corruption outright.
    const smuggled = await db.query<{ id: string }>(
      `insert into transfers (idempotency_key, amount_kobo, debit_account_id, credit_account_id)
       values ('smuggled', 999, $1, $2) returning id`,
      [memberAccountIds[0]!, clearingAccountId],
    );
    await db.query(
      `insert into ledger_entries (transfer_id, account_id, direction, amount_kobo)
       values ($1, $2, 'credit', 999)`,
      [smuggled.rows[0]!.id, clearingAccountId],
    );

    const report = await ledger.reconcile();

    expect(report.ok).toBe(false);
    const failed = report.failures.map((f) => f.check_name);
    expect(failed).toContain('ledger_sums_to_zero');
    expect(failed).toContain('every_transfer_balanced');
    expect(failed).toContain('each_circle_nets_to_zero');

    // The report must say where the drift is, not merely that there is some.
    const sum = report.failures.find((f) => f.check_name === 'ledger_sums_to_zero');
    expect(sum?.detail).toMatch(/999/);
  });
});
