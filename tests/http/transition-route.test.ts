import { beforeEach, describe, expect, it } from 'vitest';

import { CircleService } from '@/lib/circles/circles';
import {
  parseAcceptInvite,
  parseActivateCircle,
  parseCancelCircle,
  parseClaimContribution,
  parseCloseRound,
  parseConfirmContribution,
  parseCreateCircle,
  parseInviteMember,
} from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

import { actAs, createTestDb, newUserId, type TestDb } from '../support/pglite';
import { PgliteCirclePort } from '../support/pglite-circles-port';

/**
 * The HTTP layer for the eight transitions.
 *
 * These are not mocked. Each request runs the production parser and the
 * production handler against the real SQL functions in PGlite, so a replay
 * test here proves what CLAUDE.md actually asks for — that replaying the
 * request is a no-op end to end — rather than proving that a stub was called
 * twice.
 *
 * The route files themselves are three lines each (build the service, hand
 * the parser and the service method to handleTransition) and cannot be
 * imported here: they pull in next/headers through the service factory. Both
 * halves they are made of are exercised below.
 */

let db: TestDb;
let service: CircleService;

beforeEach(async () => {
  db = await createTestDb();
  service = new CircleService(new PgliteCirclePort(db));
});

/** Builds a request the way fetch would, so header handling is the real thing. */
function post(body: unknown, key?: string | null): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (key !== null && key !== undefined) headers.set('Idempotency-Key', key);

  return new Request('http://localhost/api/circles/create-circle', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function createCircle(key: string, body: Record<string, unknown> = {}): Promise<Response> {
  return handleTransition(post({ name: 'Family', amountKobo: '100000', periodDays: 30, memberTarget: 3, ...body }, key), {
    parse: parseCreateCircle,
    run: (input) => service.createCircle(input),
  });
}

async function idOf(response: Response): Promise<string> {
  const json = (await response.json()) as { id: string };
  return json.id;
}

async function errorOf(response: Response): Promise<string> {
  const json = (await response.json()) as { error: string };
  return json.error;
}

async function countCircles(): Promise<number> {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from circles`);
  return result.rows[0]!.n;
}

describe('every mutating route requires an idempotency key', () => {
  it('rejects a request with no Idempotency-Key header', async () => {
    const response = await createCircle(null as unknown as string);

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/Idempotency-Key header is required/);
  });

  it('rejects a blank key rather than treating it as absent', async () => {
    const response = await createCircle('   ');
    expect(response.status).toBe(400);
  });

  it('writes nothing when it rejects', async () => {
    await createCircle(null as unknown as string);
    expect(await countCircles()).toBe(0);
  });
});

describe('replaying a request is a no-op', () => {
  // One case per mutating route, walking a real circle through its lifecycle.
  // Each step is sent twice with the same key and the same body; the second
  // send must return the original id and change nothing.
  it('holds for all eight transitions across a full lifecycle', async () => {
    const owner = await newUserId(db);
    const bob = await newUserId(db);
    const carol = await newUserId(db);

    const run = async <T>(
      parse: (b: Record<string, unknown>, k: string) => T,
      method: (input: T) => Promise<string>,
      key: string,
      body: Record<string, unknown>,
    ): Promise<string> => {
      const call = () => handleTransition(post(body, key), { parse, run: method });

      const first = await call();
      expect(first.status, await first.clone().text()).toBe(200);

      const replay = await call();
      expect(replay.status, await replay.clone().text()).toBe(200);

      const id = await idOf(first);
      expect(await idOf(replay), 'replay returned a different id').toBe(id);
      return id;
    };

    // create_circle
    await actAs(db, owner);
    const circleId = await run(parseCreateCircle, (i) => service.createCircle(i), 'k-create', {
      name: 'Family',
      amountKobo: '100000',
      periodDays: 30,
      memberTarget: 3,
    });
    expect(await countCircles()).toBe(1);

    // invite_member, three times
    const memberships: string[] = [];
    for (const [i, userId] of [owner, bob, carol].entries()) {
      memberships.push(
        await run(parseInviteMember, (x) => service.inviteMember(x), `k-invite-${i}`, {
          circleId,
          userId,
          payoutPosition: i + 1,
        }),
      );
    }
    const membershipCount = await db.query<{ n: number }>(
      `select count(*)::int as n from memberships`,
    );
    expect(membershipCount.rows[0]!.n, 'replays created extra memberships').toBe(3);

    // accept_invite — each member accepts their own
    for (const [i, userId] of [owner, bob, carol].entries()) {
      await actAs(db, userId);
      await run(parseAcceptInvite, (x) => service.acceptInvite(x), `k-accept-${i}`, {
        membershipId: memberships[i]!,
      });
    }

    // activate_circle
    await actAs(db, owner);
    await run(parseActivateCircle, (x) => service.activateCircle(x), 'k-activate', {
      circleId,
      startDate: '2026-01-05',
    });

    // Round 1 recipient is payout position 1, which is the owner.
    const contributions = await db.query<{ id: string; payer: string }>(
      `select c.id, m.user_id as payer
         from contributions c
         join memberships m on m.id = c.payer_membership_id
         join rounds r on r.id = c.round_id
        where r.round_number = 1
        order by m.payout_position`,
    );
    expect(contributions.rows.length).toBeGreaterThan(0);

    // claim_contribution and confirm_contribution
    for (const [i, row] of contributions.rows.entries()) {
      await actAs(db, row.payer);
      await run(parseClaimContribution, (x) => service.claimContribution(x), `k-claim-${i}`, {
        contributionId: row.id,
      });

      // Only the round's recipient may confirm.
      await actAs(db, owner);
      await run(parseConfirmContribution, (x) => service.confirmContribution(x), `k-confirm-${i}`, {
        contributionId: row.id,
      });
    }

    // The replayed confirmations must not have posted the money twice.
    const net = await db.query<{ net: string }>(
      `select coalesce(sum(signed_amount_kobo), 0)::text as net from ledger_entries`,
    );
    expect(BigInt(net.rows[0]!.net), 'ledger no longer sums to zero').toBe(0n);

    const transfers = await db.query<{ n: number }>(`select count(*)::int as n from transfers`);
    expect(transfers.rows[0]!.n, 'a replay posted a duplicate transfer').toBe(
      contributions.rows.length,
    );

    // close_round
    const round1 = await db.query<{ id: string }>(
      `select id from rounds where round_number = 1 and circle_id = $1`,
      [circleId],
    );
    await run(parseCloseRound, (x) => service.closeRound(x), 'k-close', {
      roundId: round1.rows[0]!.id,
    });

    // cancel_circle — on a separate circle, since this one now has money in it.
    const otherId = await run(parseCreateCircle, (x) => service.createCircle(x), 'k-create-2', {
      name: 'Doomed',
      amountKobo: '5000',
      periodDays: 7,
      memberTarget: 2,
    });
    await run(parseCancelCircle, (x) => service.cancelCircle(x), 'k-cancel', {
      circleId: otherId,
      reason: 'changed our minds',
    });

    const cancelled = await db.query<{ status: string }>(`select status from circles where id = $1`, [
      otherId,
    ]);
    expect(cancelled.rows[0]!.status).toBe('cancelled');
  });

  it('refuses the same key with a different body', async () => {
    await actAs(db, await newUserId(db));

    expect((await createCircle('reused', { name: 'First' })).status).toBe(200);

    // Migration 0006. Without it this returned the first circle's id and the
    // caller had no way to know they were looking at the wrong circle.
    const response = await createCircle('reused', { name: 'Second' });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/different arguments/);
    expect(await countCircles()).toBe(1);
  });
});

describe('Postgres errors become the right status', () => {
  it('403 when the caller is not allowed to do it', async () => {
    const owner = await newUserId(db);
    const stranger = await newUserId(db);

    await actAs(db, owner);
    const circleId = await idOf(await createCircle('k1'));

    await actAs(db, stranger);
    const response = await handleTransition(post({ circleId, userId: stranger, payoutPosition: 2 }, 'k2'), {
      parse: parseInviteMember,
      run: (i) => service.inviteMember(i),
    });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/only the circle owner may invite/);
  });

  it('403 when nobody is signed in', async () => {
    await actAs(db, null);
    const response = await createCircle('k-anon');

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/requires a signed-in user/);
  });

  it('404 for an entity that does not exist', async () => {
    await actAs(db, await newUserId(db));

    const response = await handleTransition(
      post({ membershipId: '11111111-1111-4111-8111-111111111111' }, 'k3'),
      { parse: parseAcceptInvite, run: (i) => service.acceptInvite(i) },
    );

    expect(response.status).toBe(404);
  });

  it('409 for a transition the state machine refuses', async () => {
    const owner = await newUserId(db);
    await actAs(db, owner);
    const circleId = await idOf(await createCircle('k4'));

    // Draft, with nobody invited: cannot be activated.
    const response = await handleTransition(post({ circleId }, 'k5'), {
      parse: parseActivateCircle,
      run: (i) => service.activateCircle(i),
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/cannot activate a draft circle/);
  });

  it('replaces a raw GRANT refusal with something a person can act on', async () => {
    // What a signed-out caller actually hits in production: anon holds no
    // EXECUTE on the transition functions (0004), so Postgres refuses at the
    // grant and current_actor() never runs. Verified against the dev server —
    // the raw message was "permission denied for function create_circle".
    const response = await handleTransition(post({ name: 'X' }, 'k-grant'), {
      parse: (_body, idempotencyKey) => ({ idempotencyKey }),
      run: async () => {
        const { DatabaseError } = await import('@/lib/db-error');
        throw new DatabaseError(
          'create_circle failed: permission denied for function create_circle',
          '42501',
        );
      },
    });

    expect(response.status).toBe(403);
    const message = await errorOf(response);
    expect(message).toBe('You need to be signed in to do that.');
    expect(message).not.toMatch(/permission denied|create_circle/);
  });

  it('still passes through an authorization message written for a person', async () => {
    const response = await handleTransition(post({ name: 'X' }, 'k-raise'), {
      parse: (_body, idempotencyKey) => ({ idempotencyKey }),
      run: async () => {
        const { DatabaseError } = await import('@/lib/db-error');
        throw new DatabaseError('only the circle owner may cancel it', '42501');
      },
    });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('only the circle owner may cancel it');
  });

  it('does not leak the internals of an error it did not plan for', async () => {
    const response = await handleTransition(post({ name: 'X' }, 'k6'), {
      parse: (_body, idempotencyKey) => ({ idempotencyKey }),
      run: async () => {
        // No SQLSTATE the mapping knows about.
        const { DatabaseError } = await import('@/lib/db-error');
        throw new DatabaseError('relation "secret_table" does not exist', 'XX999');
      },
    });

    expect(response.status).toBe(500);
    const message = await errorOf(response);
    expect(message).toBe('Something went wrong. Nothing was changed.');
    expect(message).not.toMatch(/secret_table/);
  });
});

describe('request body validation', () => {
  beforeEach(async () => {
    await actAs(db, await newUserId(db));
  });

  it('rejects a body that is not JSON', async () => {
    const response = await handleTransition(post('not json at all', 'k7'), {
      parse: parseCreateCircle,
      run: (i) => service.createCircle(i),
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/valid JSON/);
  });

  it('rejects a JSON array', async () => {
    const response = await handleTransition(post([1, 2, 3], 'k8'), {
      parse: parseCreateCircle,
      run: (i) => service.createCircle(i),
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/must be a JSON object/);
  });

  it.each([
    ['name', { name: '' }],
    ['amountKobo', { amountKobo: undefined }],
    ['periodDays', { periodDays: '30' }],
    ['memberTarget', { memberTarget: 3.5 }],
  ])('rejects a bad %s with 400', async (field, override) => {
    const response = await createCircle('k9', override);

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain(field);
    expect(await countCircles()).toBe(0);
  });

  it('rejects a decimal amount instead of rounding it', async () => {
    const response = await createCircle('k10', { amountKobo: 1000.5 });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/not a decimal/);
  });

  it('rejects an amount too large to be exact as a JSON number', async () => {
    // A JSON number is a double. Above 2^53 it has already lost precision by
    // the time it reaches here, so it must arrive as a string.
    const response = await createCircle('k11', { amountKobo: 9007199254740993 });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/send it as a string/);
  });

  it('accepts an exact amount above 2^53 sent as a string', async () => {
    const response = await createCircle('k12', { amountKobo: '9007199254740993' });
    expect(response.status).toBe(200);

    const stored = await db.query<{ amount: string }>(
      `select amount_kobo::text as amount from circles where id = $1`,
      [await idOf(response)],
    );
    expect(stored.rows[0]!.amount).toBe('9007199254740993');
  });

  it('treats an empty optional string as not given', async () => {
    const owner = await newUserId(db);
    await actAs(db, owner);
    const circleId = await idOf(await createCircle('k13'));

    // An empty reason must not become the literal string "".
    const response = await handleTransition(post({ circleId, reason: '  ' }, 'k14'), {
      parse: parseCancelCircle,
      run: (i) => service.cancelCircle(i),
    });
    expect(response.status).toBe(200);

    const event = await db.query<{ reason: string | null }>(
      `select metadata ->> 'reason' as reason from events
        where entity_id = $1 and event_type = 'circle.cancelled'`,
      [circleId],
    );
    expect(event.rows[0]!.reason).toBeNull();
  });
});
