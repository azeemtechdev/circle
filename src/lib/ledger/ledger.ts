// Relative, not the `@/` alias: `scripts/reconcile.ts` runs this module
// directly under Node, which does not resolve tsconfig path aliases.
import { assertPostableAmount, koboFromText, koboToText, type Kobo } from '../money.ts';

import type { LedgerPort, ReconciliationRow } from './port.ts';

/**
 * The ledger service.
 *
 * Deliberately thin. The invariants are enforced in SQL, where they cannot be
 * bypassed by a second caller or a crashed process; this class exists to give
 * the rest of the application a typed, `bigint`-based surface and to convert
 * money at exactly one boundary.
 *
 * It adds no money logic of its own — if a rule appears here that is not also
 * in the migration, the rule is only as strong as this process.
 */

export interface PostContributionInput {
  idempotencyKey: string;
  /** Account debited: the paying member. */
  fromAccountId: string;
  /** Account credited: usually the circle's clearing account. */
  toAccountId: string;
  amountKobo: Kobo;
  memo?: string | null;
  contributionId?: string | null;
  actorId?: string | null;
}

export interface ReverseInput {
  idempotencyKey: string;
  transferId: string;
  memo?: string | null;
  actorId?: string | null;
}

export interface ReconciliationReport {
  ok: boolean;
  checks: ReconciliationRow[];
  /** Only the checks that failed — what a reconciliation alert should say. */
  failures: ReconciliationRow[];
}

export class LedgerError extends Error {}

export class Ledger {
  // Declared explicitly rather than as a constructor parameter property:
  // `scripts/reconcile.ts` runs under Node's strip-only TypeScript support,
  // which does not implement parameter properties.
  private readonly port: LedgerPort;

  constructor(port: LedgerPort) {
    this.port = port;
  }

  /**
   * Moves value from one account to another as a single atomic double entry.
   * Replaying the same idempotency key returns the original transfer id and
   * writes nothing.
   */
  async post(input: PostContributionInput): Promise<string> {
    assertPostableAmount(input.amountKobo);

    if (input.fromAccountId === input.toAccountId) {
      throw new LedgerError('A transfer must move value between two different accounts.');
    }
    if (input.idempotencyKey.trim().length === 0) {
      throw new LedgerError('An idempotency key is required for every posting.');
    }

    return this.port.postDoubleEntry({
      idempotencyKey: input.idempotencyKey,
      debitAccountId: input.fromAccountId,
      creditAccountId: input.toAccountId,
      amountKoboText: koboToText(input.amountKobo),
      memo: input.memo ?? null,
      contributionId: input.contributionId ?? null,
      actorId: input.actorId ?? null,
    });
  }

  /**
   * Corrects an earlier posting by writing its mirror image. The original rows
   * are never touched — that is the whole point of an append-only ledger.
   */
  async reverse(input: ReverseInput): Promise<string> {
    if (input.idempotencyKey.trim().length === 0) {
      throw new LedgerError('An idempotency key is required for every reversal.');
    }

    return this.port.postReversal({
      idempotencyKey: input.idempotencyKey,
      transferId: input.transferId,
      memo: input.memo ?? null,
      actorId: input.actorId ?? null,
    });
  }

  /** Computed from the entries, never read from a stored total. */
  async balance(accountId: string): Promise<Kobo> {
    const text = await this.port.accountBalanceKoboText(accountId);
    if (text === null) {
      throw new LedgerError(`No such account: ${accountId}`);
    }
    return koboFromText(text);
  }

  /**
   * Runs every ledger invariant check. `ok` is false if any single check fails;
   * `failures` is what the alert should name.
   */
  async reconcile(): Promise<ReconciliationReport> {
    const checks = await this.port.reconcile();

    if (checks.length === 0) {
      // An empty report is not a pass — it means the checks did not run.
      throw new LedgerError('Reconciliation returned no checks; the query did not run.');
    }

    const failures = checks.filter((check) => !check.ok);
    return { ok: failures.length === 0, checks, failures };
  }
}
