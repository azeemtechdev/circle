import { beforeAll, describe, expect, it } from 'vitest';

import { CircleError, CircleService } from '@/lib/circles/circles';
import { Ledger } from '@/lib/ledger/ledger';
import { nairaToKobo } from '@/lib/money';

import { createTestDb, ledgerNet, type TestDb } from '../support/pglite';
import { PgliteCirclePort } from '../support/pglite-circles-port';
import { PgliteLedgerPort } from '../support/pglite-port';

describe('CircleService input guards', () => {
  let db: TestDb;
  let circles: CircleService;

  beforeAll(async () => {
    db = await createTestDb();
    circles = new CircleService(new PgliteCirclePort(db));
  }, 60_000);

  const valid = {
    idempotencyKey: 'k',
    name: 'Family circle',
    amountKobo: nairaToKobo(1_000n),
    periodDays: 30,
    memberTarget: 5,
  };

  it('rejects a blank idempotency key', async () => {
    await expect(circles.createCircle({ ...valid, idempotencyKey: ' ' })).rejects.toThrow(
      CircleError,
    );
  });

  it('rejects a blank name', async () => {
    await expect(circles.createCircle({ ...valid, name: '   ' })).rejects.toThrow(/needs a name/);
  });

  it('rejects a non-positive contribution', async () => {
    await expect(circles.createCircle({ ...valid, amountKobo: 0n })).rejects.toThrow(
      /must be positive kobo/,
    );
  });

  it('rejects a fractional period', async () => {
    await expect(circles.createCircle({ ...valid, periodDays: 1.5 })).rejects.toThrow(
      /positive whole number/,
    );
  });

  it('rejects an out-of-range circle size', async () => {
    await expect(circles.createCircle({ ...valid, memberTarget: 1 })).rejects.toThrow(
      /between 2 and 50/,
    );
    await expect(circles.createCircle({ ...valid, memberTarget: 51 })).rejects.toThrow(
      /between 2 and 50/,
    );
  });

  it('rejects a malformed start date', async () => {
    await expect(
      circles.activateCircle({ idempotencyKey: 'a', id: 'x', startDate: '01/01/2026' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('CircleService drives a whole circle through the ledger', () => {
  let db: TestDb;
  let circles: CircleService;
  let ledger: Ledger;

  beforeAll(async () => {
    db = await createTestDb();
    circles = new CircleService(new PgliteCirclePort(db));
    ledger = new Ledger(new PgliteLedgerPort(db));
  }, 60_000);

  it('completes a 3-member circle with every balance back to zero', async () => {
    const MEMBERS = 3;
    const amountKobo = nairaToKobo(2_000n);

    const circleId = await circles.createCircle({
      idempotencyKey: 'svc-create',
      name: 'Service circle',
      amountKobo,
      periodDays: 7,
      memberTarget: MEMBERS,
    });

    for (let position = 1; position <= MEMBERS; position += 1) {
      const userId = (await db.query<{ v: string }>(`select gen_random_uuid() as v`)).rows[0]!.v;
      const membershipId = await circles.inviteMember({
        idempotencyKey: `svc-invite-${position}`,
        circleId,
        userId,
        payoutPosition: position,
      });
      await circles.acceptInvite({ idempotencyKey: `svc-join-${position}`, id: membershipId });
    }

    await circles.activateCircle({
      idempotencyKey: 'svc-activate',
      id: circleId,
      startDate: '2026-03-01',
    });

    for (let roundNumber = 1; roundNumber <= MEMBERS; roundNumber += 1) {
      const roundId = (
        await db.query<{ v: string }>(
          `select id as v from rounds where circle_id = $1 and round_number = $2`,
          [circleId, roundNumber],
        )
      ).rows[0]!.v;

      const contributions = await db.query<{ id: string }>(
        `select id from contributions where round_id = $1 order by id`,
        [roundId],
      );

      for (const [index, row] of contributions.rows.entries()) {
        await circles.claimContribution({
          idempotencyKey: `svc-${roundNumber}-claim-${index}`,
          id: row.id,
        });
        await circles.confirmContribution({
          idempotencyKey: `svc-${roundNumber}-confirm-${index}`,
          id: row.id,
        });
      }

      await circles.closeRound({ idempotencyKey: `svc-${roundNumber}-close`, id: roundId });
      expect(await ledgerNet(db)).toBe(0n);
    }

    const status = (
      await db.query<{ v: string }>(`select status as v from circles where id = $1`, [circleId])
    ).rows[0]!.v;
    expect(status).toBe('completed');

    const accounts = await db.query<{ id: string }>(
      `select id from accounts where circle_id = $1`,
      [circleId],
    );
    for (const account of accounts.rows) {
      expect(await ledger.balance(account.id)).toBe(0n);
    }

    const report = await ledger.reconcile();
    expect(report.failures, JSON.stringify(report.failures)).toEqual([]);
  }, 120_000);
});
