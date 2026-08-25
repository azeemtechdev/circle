import type {
  ActivateCircleArgs,
  CancelCircleArgs,
  CirclePort,
  CreateCircleArgs,
  InviteMemberArgs,
  KeyedEntityArgs,
} from '@/lib/circles/port';

import type { TestDb } from './pglite';

/** Test port: calls the same SQL transition functions as production. */
export class PgliteCirclePort implements CirclePort {
  private readonly db: TestDb;

  constructor(db: TestDb) {
    this.db = db;
  }

  private async call(sql: string, params: unknown[]): Promise<string> {
    const result = await this.db.query<{ id: string }>(sql, params);
    return result.rows[0]!.id;
  }

  createCircle(args: CreateCircleArgs): Promise<string> {
    return this.call(`select create_circle($1, $2, $3::bigint, $4, $5) as id`, [
      args.idempotencyKey,
      args.name,
      args.amountKoboText,
      args.periodDays,
      args.memberTarget,
    ]);
  }

  inviteMember(args: InviteMemberArgs): Promise<string> {
    return this.call(`select invite_member($1, $2, $3, $4) as id`, [
      args.idempotencyKey,
      args.circleId,
      args.userId,
      args.payoutPosition,
    ]);
  }

  acceptInvite(args: KeyedEntityArgs): Promise<string> {
    return this.call(`select accept_invite($1, $2) as id`, [args.idempotencyKey, args.id]);
  }

  activateCircle(args: ActivateCircleArgs): Promise<string> {
    return this.call(`select activate_circle($1, $2, $3::date) as id`, [
      args.idempotencyKey,
      args.id,
      args.startDate ?? null,
    ]);
  }

  claimContribution(args: KeyedEntityArgs): Promise<string> {
    return this.call(`select claim_contribution($1, $2) as id`, [args.idempotencyKey, args.id]);
  }

  confirmContribution(args: KeyedEntityArgs): Promise<string> {
    return this.call(`select confirm_contribution($1, $2) as id`, [args.idempotencyKey, args.id]);
  }

  closeRound(args: KeyedEntityArgs): Promise<string> {
    return this.call(`select close_round($1, $2) as id`, [args.idempotencyKey, args.id]);
  }

  cancelCircle(args: CancelCircleArgs): Promise<string> {
    return this.call(`select cancel_circle($1, $2, $3) as id`, [
      args.idempotencyKey,
      args.id,
      args.reason ?? null,
    ]);
  }
}
