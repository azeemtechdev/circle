import type {
  ActionInput,
  ActivateCircleInput,
  CancelCircleInput,
  CreateCircleInput,
  InviteMemberInput,
} from '@/lib/circles/circles';
import {
  optionalString,
  requiredInteger,
  requiredKobo,
  requiredString,
} from '@/lib/http/transition-route';

/**
 * Request body -> service input, one function per route.
 *
 * These live here rather than inline in the route files so the tests can call
 * exactly what production calls. A route file imports `next/headers` through
 * its service factory, which a node test cannot load; parsers in their own
 * module keep the real mapping under test instead of a copy of it that drifts.
 */

type Body = Record<string, unknown>;

export function parseCreateCircle(body: Body, idempotencyKey: string): CreateCircleInput {
  return {
    idempotencyKey,
    name: requiredString(body, 'name'),
    // Kobo as a string or a safe integer — never a decimal naira amount.
    amountKobo: requiredKobo(body, 'amountKobo'),
    periodDays: requiredInteger(body, 'periodDays'),
    memberTarget: requiredInteger(body, 'memberTarget'),
  };
}

export function parseInviteMember(body: Body, idempotencyKey: string): InviteMemberInput {
  return {
    idempotencyKey,
    circleId: requiredString(body, 'circleId'),
    userId: requiredString(body, 'userId'),
    payoutPosition: requiredInteger(body, 'payoutPosition'),
  };
}

export function parseAcceptInvite(body: Body, idempotencyKey: string): ActionInput {
  return { idempotencyKey, id: requiredString(body, 'membershipId') };
}

export function parseActivateCircle(body: Body, idempotencyKey: string): ActivateCircleInput {
  return {
    idempotencyKey,
    id: requiredString(body, 'circleId'),
    startDate: optionalString(body, 'startDate'),
  };
}

export function parseClaimContribution(body: Body, idempotencyKey: string): ActionInput {
  return { idempotencyKey, id: requiredString(body, 'contributionId') };
}

export function parseConfirmContribution(body: Body, idempotencyKey: string): ActionInput {
  return { idempotencyKey, id: requiredString(body, 'contributionId') };
}

export function parseCloseRound(body: Body, idempotencyKey: string): ActionInput {
  return { idempotencyKey, id: requiredString(body, 'roundId') };
}

export function parseCancelCircle(body: Body, idempotencyKey: string): CancelCircleInput {
  return {
    idempotencyKey,
    id: requiredString(body, 'circleId'),
    reason: optionalString(body, 'reason'),
  };
}
