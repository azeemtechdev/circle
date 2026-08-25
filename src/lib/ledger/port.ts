/**
 * The narrow seam between the ledger service and a database.
 *
 * Why a port at all: the money rules live in SQL (`post_double_entry`,
 * `post_reversal`, `reconcile_ledger`) so that a pair of entries is written by
 * one statement and cannot be half-posted. Two very different clients need to
 * call that SQL — supabase-js in production, which can only issue RPC and
 * SELECT, and PGlite in tests, which runs raw SQL. This interface is the
 * smallest surface both can implement, and it deals only in strings, so no
 * implementation gets to decide how money is represented.
 */

export interface PostDoubleEntryArgs {
  idempotencyKey: string;
  debitAccountId: string;
  creditAccountId: string;
  /** Exact integer kobo as text. Never a number. */
  amountKoboText: string;
  memo?: string | null;
  contributionId?: string | null;
  actorId?: string | null;
}

export interface PostReversalArgs {
  idempotencyKey: string;
  transferId: string;
  memo?: string | null;
  actorId?: string | null;
}

export interface ReconciliationRow {
  check_name: string;
  ok: boolean;
  detail: string;
}

export interface LedgerPort {
  postDoubleEntry(args: PostDoubleEntryArgs): Promise<string>;
  postReversal(args: PostReversalArgs): Promise<string>;
  /** Exact integer kobo as text, or null when the account does not exist. */
  accountBalanceKoboText(accountId: string): Promise<string | null>;
  reconcile(): Promise<ReconciliationRow[]>;
}
