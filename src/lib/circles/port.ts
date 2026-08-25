/**
 * The seam between the circle service and a database, mirroring
 * `src/lib/ledger/port.ts`.
 *
 * Every method maps to one SQL transition function. The state machine itself
 * lives in SQL so that a status change and the events row and any ledger
 * posting all commit together, and so no route handler can set a status
 * column directly.
 */

export type CircleStatus = 'draft' | 'inviting' | 'active' | 'completed' | 'cancelled';
export type MembershipStatus = 'invited' | 'joined' | 'left';
export type RoundStatus = 'open' | 'collecting' | 'settled' | 'disputed' | 'closed';
export type ContributionStatus = 'pending' | 'claimed' | 'confirmed' | 'disputed';

export interface CreateCircleArgs {
  idempotencyKey: string;
  name: string;
  /** Exact integer kobo as text. Never a number. */
  amountKoboText: string;
  periodDays: number;
  memberTarget: number;
  createdBy?: string | null;
}

export interface InviteMemberArgs {
  idempotencyKey: string;
  circleId: string;
  userId: string;
  payoutPosition: number;
  actorId?: string | null;
}

export interface KeyedEntityArgs {
  idempotencyKey: string;
  id: string;
  actorId?: string | null;
}

export interface ActivateCircleArgs extends KeyedEntityArgs {
  /** ISO date (YYYY-MM-DD). Defaults to the database's current_date. */
  startDate?: string | null;
}

export interface CancelCircleArgs extends KeyedEntityArgs {
  reason?: string | null;
}

export interface CirclePort {
  createCircle(args: CreateCircleArgs): Promise<string>;
  inviteMember(args: InviteMemberArgs): Promise<string>;
  acceptInvite(args: KeyedEntityArgs): Promise<string>;
  activateCircle(args: ActivateCircleArgs): Promise<string>;
  claimContribution(args: KeyedEntityArgs): Promise<string>;
  confirmContribution(args: KeyedEntityArgs): Promise<string>;
  closeRound(args: KeyedEntityArgs): Promise<string>;
  cancelCircle(args: CancelCircleArgs): Promise<string>;
}
