import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  LedgerPort,
  PostDoubleEntryArgs,
  PostReversalArgs,
  ReconciliationRow,
} from './port.ts';

/**
 * Production port: calls the SQL functions over PostgREST.
 *
 * Amounts travel as text on purpose. PostgREST serialises bigint as a JSON
 * number, and a JS number is a double — a balance above 2^53 would arrive
 * silently wrong. Postgres casts the text back to bigint on the way in, and
 * `account_balance_kobo` returns text on the way out.
 */
export class SupabaseLedgerPort implements LedgerPort {
  // Explicit field, not a parameter property: this module is executed by
  // `scripts/reconcile.ts` under Node's strip-only TypeScript support.
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async postDoubleEntry(args: PostDoubleEntryArgs): Promise<string> {
    const { data, error } = await this.client.rpc('post_double_entry', {
      p_idempotency_key: args.idempotencyKey,
      p_debit_account_id: args.debitAccountId,
      p_credit_account_id: args.creditAccountId,
      p_amount_kobo: args.amountKoboText,
      p_memo: args.memo ?? null,
      p_contribution_id: args.contributionId ?? null,
      p_actor_id: args.actorId ?? null,
    });

    if (error) throw new Error(`post_double_entry failed: ${error.message}`);
    if (typeof data !== 'string') {
      throw new Error(`post_double_entry returned no transfer id (got ${JSON.stringify(data)})`);
    }
    return data;
  }

  async postReversal(args: PostReversalArgs): Promise<string> {
    const { data, error } = await this.client.rpc('post_reversal', {
      p_idempotency_key: args.idempotencyKey,
      p_transfer_id: args.transferId,
      p_memo: args.memo ?? null,
      p_actor_id: args.actorId ?? null,
    });

    if (error) throw new Error(`post_reversal failed: ${error.message}`);
    if (typeof data !== 'string') {
      throw new Error(`post_reversal returned no transfer id (got ${JSON.stringify(data)})`);
    }
    return data;
  }

  async accountBalanceKoboText(accountId: string): Promise<string | null> {
    const { data, error } = await this.client.rpc('account_balance_kobo', {
      p_account_id: accountId,
    });

    if (error) throw new Error(`account_balance_kobo failed: ${error.message}`);
    if (data === null) return null;
    if (typeof data !== 'string') {
      throw new Error(
        `account_balance_kobo must return text so precision survives; got ${typeof data}`,
      );
    }
    return data;
  }

  async reconcile(): Promise<ReconciliationRow[]> {
    const { data, error } = await this.client.rpc('reconcile_ledger');

    if (error) throw new Error(`reconcile_ledger failed: ${error.message}`);
    if (!Array.isArray(data)) {
      throw new Error(`reconcile_ledger returned ${typeof data}, expected an array of checks`);
    }
    return data as ReconciliationRow[];
  }
}
