import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ActivateCircleArgs,
  CancelCircleArgs,
  CirclePort,
  CreateCircleArgs,
  InviteMemberArgs,
  KeyedEntityArgs,
} from './port.ts';

/**
 * Production port: each method is one RPC to the matching SQL transition
 * function. Amounts travel as text because PostgREST serialises bigint as a
 * JSON number, which is a double.
 */
export class SupabaseCirclePort implements CirclePort {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.client.rpc(fn, args);

    if (error) throw new Error(`${fn} failed: ${error.message}`);
    if (typeof data !== 'string') {
      throw new Error(`${fn} returned no id (got ${JSON.stringify(data)})`);
    }
    return data;
  }

  createCircle(args: CreateCircleArgs): Promise<string> {
    return this.rpc('create_circle', {
      p_idempotency_key: args.idempotencyKey,
      p_name: args.name,
      p_amount_kobo: args.amountKoboText,
      p_period_days: args.periodDays,
      p_member_target: args.memberTarget,
    });
  }

  inviteMember(args: InviteMemberArgs): Promise<string> {
    return this.rpc('invite_member', {
      p_idempotency_key: args.idempotencyKey,
      p_circle_id: args.circleId,
      p_payout_position: args.payoutPosition,
      p_user_id: args.userId ?? null,
      p_phone: args.phone ?? null,
      p_invite_token: args.inviteToken ?? null,
    });
  }

  acceptInvite(args: KeyedEntityArgs): Promise<string> {
    return this.rpc('accept_invite', {
      p_idempotency_key: args.idempotencyKey,
      p_membership_id: args.id ?? null,
      p_invite_token: args.inviteToken ?? null,
      p_phone: args.phone ?? null,
    });
  }

  activateCircle(args: ActivateCircleArgs): Promise<string> {
    return this.rpc('activate_circle', {
      p_idempotency_key: args.idempotencyKey,
      p_circle_id: args.id,
      p_start_date: args.startDate ?? null,
    });
  }

  claimContribution(args: KeyedEntityArgs): Promise<string> {
    return this.rpc('claim_contribution', {
      p_idempotency_key: args.idempotencyKey,
      p_contribution_id: args.id,
    });
  }

  confirmContribution(args: KeyedEntityArgs): Promise<string> {
    return this.rpc('confirm_contribution', {
      p_idempotency_key: args.idempotencyKey,
      p_contribution_id: args.id,
    });
  }

  closeRound(args: KeyedEntityArgs): Promise<string> {
    return this.rpc('close_round', {
      p_idempotency_key: args.idempotencyKey,
      p_round_id: args.id,
    });
  }

  cancelCircle(args: CancelCircleArgs): Promise<string> {
    return this.rpc('cancel_circle', {
      p_idempotency_key: args.idempotencyKey,
      p_circle_id: args.id,
      p_reason: args.reason ?? null,
    });
  }
}
