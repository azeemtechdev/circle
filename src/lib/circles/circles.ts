import { koboToText, type Kobo } from '../money.ts';

import type { CirclePort } from './port.ts';

/**
 * Circle lifecycle service.
 *
 * Thin, like the ledger service, and for the same reason: the state machine is
 * enforced in SQL, where an illegal transition cannot be talked around by a
 * second caller or a crashed process. This layer gives the app a typed surface,
 * converts money at one boundary, and rejects obviously bad input early so the
 * caller gets a clear message instead of a Postgres error code.
 *
 * It must never contain a rule that the migration does not also enforce.
 */

export class CircleError extends Error {}

export interface CreateCircleInput {
  idempotencyKey: string;
  name: string;
  amountKobo: Kobo;
  periodDays: number;
  memberTarget: number;
}

export interface InviteMemberInput {
  idempotencyKey: string;
  circleId: string;
  userId: string;
  payoutPosition: number;
}

export interface ActionInput {
  idempotencyKey: string;
  id: string;
}

export interface ActivateCircleInput extends ActionInput {
  startDate?: string | null;
}

export interface CancelCircleInput extends ActionInput {
  reason?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CircleService {
  private readonly port: CirclePort;

  constructor(port: CirclePort) {
    this.port = port;
  }

  async createCircle(input: CreateCircleInput): Promise<string> {
    requireKey(input.idempotencyKey);

    if (input.name.trim().length === 0) {
      throw new CircleError('A circle needs a name.');
    }
    if (input.amountKobo <= 0n) {
      throw new CircleError(
        `The contribution must be positive kobo, got ${input.amountKobo.toString()}.`,
      );
    }
    if (!Number.isInteger(input.periodDays) || input.periodDays <= 0) {
      throw new CircleError(`period_days must be a positive whole number, got ${input.periodDays}.`);
    }
    if (!Number.isInteger(input.memberTarget) || input.memberTarget < 2 || input.memberTarget > 50) {
      throw new CircleError(
        `A circle needs between 2 and 50 members, got ${input.memberTarget}.`,
      );
    }

    return this.port.createCircle({
      idempotencyKey: input.idempotencyKey,
      name: input.name.trim(),
      amountKoboText: koboToText(input.amountKobo),
      periodDays: input.periodDays,
      memberTarget: input.memberTarget,
    });
  }

  async inviteMember(input: InviteMemberInput): Promise<string> {
    requireKey(input.idempotencyKey);

    if (!Number.isInteger(input.payoutPosition) || input.payoutPosition < 1) {
      throw new CircleError(
        `Payout position must be a whole number of at least 1, got ${input.payoutPosition}.`,
      );
    }

    return this.port.inviteMember({
      idempotencyKey: input.idempotencyKey,
      circleId: input.circleId,
      userId: input.userId,
      payoutPosition: input.payoutPosition,
    });
  }

  async acceptInvite(input: ActionInput): Promise<string> {
    requireKey(input.idempotencyKey);
    return this.port.acceptInvite(normalise(input));
  }

  /** Locks the rotation, creates the virtual accounts, opens round 1. */
  async activateCircle(input: ActivateCircleInput): Promise<string> {
    requireKey(input.idempotencyKey);

    if (input.startDate != null && !ISO_DATE.test(input.startDate)) {
      throw new CircleError(`startDate must be YYYY-MM-DD, got ${JSON.stringify(input.startDate)}.`);
    }

    return this.port.activateCircle({ ...normalise(input), startDate: input.startDate ?? null });
  }

  /** The payer says "I've paid". No money moves yet. */
  async claimContribution(input: ActionInput): Promise<string> {
    requireKey(input.idempotencyKey);
    return this.port.claimContribution(normalise(input));
  }

  /**
   * The recipient says "received". This is where value moves in the ledger,
   * in the same transaction as the state change.
   */
  async confirmContribution(input: ActionInput): Promise<string> {
    requireKey(input.idempotencyKey);
    return this.port.confirmContribution(normalise(input));
  }

  /** Pays the pot to this round's recipient, then opens the next round. */
  async closeRound(input: ActionInput): Promise<string> {
    requireKey(input.idempotencyKey);
    return this.port.closeRound(normalise(input));
  }

  async cancelCircle(input: CancelCircleInput): Promise<string> {
    requireKey(input.idempotencyKey);
    return this.port.cancelCircle({ ...normalise(input), reason: input.reason ?? null });
  }
}

function requireKey(key: string): void {
  if (key.trim().length === 0) {
    throw new CircleError('An idempotency key is required for every mutating request.');
  }
}

function normalise(input: ActionInput): { idempotencyKey: string; id: string } {
  return { idempotencyKey: input.idempotencyKey, id: input.id };
}
