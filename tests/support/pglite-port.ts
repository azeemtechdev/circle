import type {
  LedgerPort,
  PostDoubleEntryArgs,
  PostReversalArgs,
  ReconciliationRow,
} from '@/lib/ledger/port';

import type { TestDb } from './pglite';

/**
 * Test port: calls the same SQL functions as production, over PGlite.
 *
 * This is the reason the money rules live in SQL — the tests exercise the
 * deployed logic, not a TypeScript re-implementation of it that could drift.
 */
export class PgliteLedgerPort implements LedgerPort {
  private readonly db: TestDb;

  constructor(db: TestDb) {
    this.db = db;
  }

  async postDoubleEntry(args: PostDoubleEntryArgs): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `select post_double_entry($1, $2, $3, $4::bigint, $5, $6, $7) as id`,
      [
        args.idempotencyKey,
        args.debitAccountId,
        args.creditAccountId,
        args.amountKoboText,
        args.memo ?? null,
        args.contributionId ?? null,
        args.actorId ?? null,
      ],
    );
    return result.rows[0]!.id;
  }

  async postReversal(args: PostReversalArgs): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `select post_reversal($1, $2, $3, $4) as id`,
      [args.idempotencyKey, args.transferId, args.memo ?? null, args.actorId ?? null],
    );
    return result.rows[0]!.id;
  }

  async accountBalanceKoboText(accountId: string): Promise<string | null> {
    const result = await this.db.query<{ balance: string | null }>(
      `select account_balance_kobo($1) as balance`,
      [accountId],
    );
    return result.rows[0]?.balance ?? null;
  }

  async reconcile(): Promise<ReconciliationRow[]> {
    const result = await this.db.query<ReconciliationRow>(
      `select check_name, ok, detail from reconcile_ledger()`,
    );
    return result.rows;
  }
}
