import { describe, expect, it } from 'vitest';

import { SupabaseCirclePort } from '../../src/lib/circles/supabase-port.ts';
import { SupabaseLedgerPort } from '../../src/lib/ledger/supabase-port.ts';

/**
 * The production ports (0% covered until now).
 *
 * Everything else in the suite runs against PGlite through the test ports, so
 * these two classes — the only code that talks to real Supabase — were never
 * executed by a test. They are thin, but "thin" is not "safe":
 *
 *   - Every RPC parameter name is a string. Misspell one and PostgREST reports
 *     that no such function exists, at runtime, in production only.
 *   - accountBalanceKoboText refuses a non-string balance. That guard is the
 *     last line of defence against a schema change reintroducing a JSON number
 *     into a money path, and nothing proved it fires.
 *
 * A stub client records the calls, so the assertions are about the contract
 * with Postgres rather than about Supabase's internals.
 */

type RpcCall = { fn: string; args: Record<string, unknown> };

function stubClient(reply: { data?: unknown; error?: { message: string } }) {
  const calls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    },
    // The ports only ever call rpc(); the cast keeps the stub honest about that.
  } as unknown as ConstructorParameters<typeof SupabaseLedgerPort>[0];

  return { client, calls };
}

const TRANSFER_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';

describe('SupabaseLedgerPort', () => {
  it('sends the amount as text, never as a number', async () => {
    const { client, calls } = stubClient({ data: TRANSFER_ID });

    await new SupabaseLedgerPort(client).postDoubleEntry({
      idempotencyKey: 'k',
      debitAccountId: 'a',
      creditAccountId: 'b',
      amountKoboText: '9007199254740993',
      memo: 'memo',
      contributionId: 'c',
      actorId: 'u',
    });

    const call = calls[0]!;
    expect(call.fn).toBe('post_double_entry');
    // A JS number cannot hold this value exactly. If anything ever converts it,
    // this assertion is what notices.
    expect(call.args['p_amount_kobo']).toBe('9007199254740993');
    expect(typeof call.args['p_amount_kobo']).toBe('string');
  });

  it('maps every post_double_entry parameter to the name Postgres expects', async () => {
    const { client, calls } = stubClient({ data: TRANSFER_ID });

    await new SupabaseLedgerPort(client).postDoubleEntry({
      idempotencyKey: 'k',
      debitAccountId: 'debit',
      creditAccountId: 'credit',
      amountKoboText: '100',
    });

    expect(calls[0]!.args).toEqual({
      p_idempotency_key: 'k',
      p_debit_account_id: 'debit',
      p_credit_account_id: 'credit',
      p_amount_kobo: '100',
      // Optionals become explicit nulls rather than being omitted: PostgREST
      // resolves the overload from the keys it is given.
      p_memo: null,
      p_contribution_id: null,
      p_actor_id: null,
    });
  });

  it('maps every post_reversal parameter', async () => {
    const { client, calls } = stubClient({ data: TRANSFER_ID });

    await new SupabaseLedgerPort(client).postReversal({
      idempotencyKey: 'k',
      transferId: TRANSFER_ID,
    });

    expect(calls[0]!.fn).toBe('post_reversal');
    expect(calls[0]!.args).toEqual({
      p_idempotency_key: 'k',
      p_transfer_id: TRANSFER_ID,
      p_memo: null,
      p_actor_id: null,
    });
  });

  it('surfaces a database error instead of returning a bad value', async () => {
    const { client } = stubClient({ error: { message: 'permission denied' } });

    await expect(
      new SupabaseLedgerPort(client).postDoubleEntry({
        idempotencyKey: 'k',
        debitAccountId: 'a',
        creditAccountId: 'b',
        amountKoboText: '100',
      }),
    ).rejects.toThrow(/post_double_entry failed: permission denied/);
  });

  it('treats a missing transfer id as a failure, not as success', async () => {
    const { client } = stubClient({ data: null });

    await expect(
      new SupabaseLedgerPort(client).postDoubleEntry({
        idempotencyKey: 'k',
        debitAccountId: 'a',
        creditAccountId: 'b',
        amountKoboText: '100',
      }),
    ).rejects.toThrow(/returned no transfer id/);
  });

  it('refuses a balance that arrives as a number', async () => {
    // The guard that matters: if account_balance_kobo ever stops returning
    // text, PostgREST hands back a double and the balance is silently wrong
    // above 2^53. Failing loudly is the only acceptable behaviour.
    const { client } = stubClient({ data: 9007199254740993 });

    await expect(new SupabaseLedgerPort(client).accountBalanceKoboText('acct')).rejects.toThrow(
      /must return text so precision survives/,
    );
  });

  it('passes a text balance through unchanged', async () => {
    const { client } = stubClient({ data: '9007199254740993' });
    await expect(new SupabaseLedgerPort(client).accountBalanceKoboText('acct')).resolves.toBe(
      '9007199254740993',
    );
  });

  it('distinguishes an account with no entries from an error', async () => {
    const { client } = stubClient({ data: null });
    await expect(new SupabaseLedgerPort(client).accountBalanceKoboText('acct')).resolves.toBeNull();
  });

  it('refuses a reconciliation result that is not a list of checks', async () => {
    const { client } = stubClient({ data: { ok: true } });
    await expect(new SupabaseLedgerPort(client).reconcile()).rejects.toThrow(
      /expected an array of checks/,
    );
  });

  it('returns the reconciliation rows', async () => {
    const rows = [{ check_name: 'ledger_sums_to_zero', passed: true, detail: null }];
    const { client } = stubClient({ data: rows });
    await expect(new SupabaseLedgerPort(client).reconcile()).resolves.toEqual(rows);
  });
});

describe('SupabaseCirclePort', () => {
  it('sends the circle amount as text', async () => {
    const { client, calls } = stubClient({ data: ENTITY_ID });

    await new SupabaseCirclePort(client).createCircle({
      idempotencyKey: 'k',
      name: 'Family',
      amountKoboText: '100000',
      periodDays: 30,
      memberTarget: 5,
    });

    expect(calls[0]!.fn).toBe('create_circle');
    expect(calls[0]!.args).toEqual({
      p_idempotency_key: 'k',
      p_name: 'Family',
      p_amount_kobo: '100000',
      p_period_days: 30,
      p_member_target: 5,
    });
    expect(typeof calls[0]!.args['p_amount_kobo']).toBe('string');
  });

  // Every transition, so a renamed SQL parameter is caught here rather than in
  // production. The names must match the signatures in migration 0006.
  it.each([
    [
      'inviteMember',
      { idempotencyKey: 'k', circleId: 'c', userId: 'u', payoutPosition: 2 },
      'invite_member',
      { p_idempotency_key: 'k', p_circle_id: 'c', p_user_id: 'u', p_payout_position: 2 },
    ],
    [
      'acceptInvite',
      { idempotencyKey: 'k', id: 'm' },
      'accept_invite',
      { p_idempotency_key: 'k', p_membership_id: 'm' },
    ],
    [
      'activateCircle',
      { idempotencyKey: 'k', id: 'c' },
      'activate_circle',
      { p_idempotency_key: 'k', p_circle_id: 'c', p_start_date: null },
    ],
    [
      'activateCircle',
      { idempotencyKey: 'k', id: 'c', startDate: '2026-01-31' },
      'activate_circle',
      { p_idempotency_key: 'k', p_circle_id: 'c', p_start_date: '2026-01-31' },
    ],
    [
      'claimContribution',
      { idempotencyKey: 'k', id: 'x' },
      'claim_contribution',
      { p_idempotency_key: 'k', p_contribution_id: 'x' },
    ],
    [
      'confirmContribution',
      { idempotencyKey: 'k', id: 'x' },
      'confirm_contribution',
      { p_idempotency_key: 'k', p_contribution_id: 'x' },
    ],
    [
      'closeRound',
      { idempotencyKey: 'k', id: 'r' },
      'close_round',
      { p_idempotency_key: 'k', p_round_id: 'r' },
    ],
    [
      'cancelCircle',
      { idempotencyKey: 'k', id: 'c' },
      'cancel_circle',
      { p_idempotency_key: 'k', p_circle_id: 'c', p_reason: null },
    ],
    [
      'cancelCircle',
      { idempotencyKey: 'k', id: 'c', reason: 'moved away' },
      'cancel_circle',
      { p_idempotency_key: 'k', p_circle_id: 'c', p_reason: 'moved away' },
    ],
  ] as const)('%s calls %s with the right parameters', async (method, args, fn, expected) => {
    const { client, calls } = stubClient({ data: ENTITY_ID });
    const port = new SupabaseCirclePort(client) as unknown as Record<
      string,
      (a: unknown) => Promise<string>
    >;

    await expect(port[method]!(args)).resolves.toBe(ENTITY_ID);
    expect(calls[0]!.fn).toBe(fn);
    expect(calls[0]!.args).toEqual(expected);
  });

  it('surfaces a database error with the function name', async () => {
    const { client } = stubClient({ error: { message: 'insufficient_privilege' } });

    await expect(
      new SupabaseCirclePort(client).acceptInvite({ idempotencyKey: 'k', id: 'm' }),
    ).rejects.toThrow(/accept_invite failed: insufficient_privilege/);
  });

  it('treats a missing id as a failure', async () => {
    const { client } = stubClient({ data: null });

    await expect(
      new SupabaseCirclePort(client).closeRound({ idempotencyKey: 'k', id: 'r' }),
    ).rejects.toThrow(/close_round returned no id/);
  });
});
