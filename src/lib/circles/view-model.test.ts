import { describe, expect, it } from 'vitest';

import type {
  CircleMember,
  CircleRound,
  CircleSummary,
  RoundContribution,
} from '@/lib/circles/queries';

import { awaitingMyConfirmation, mostUrgent, standing, type CircleView } from './view-model';

const ME = 'me';
const ADA = 'ada';

function circle(over: Partial<CircleSummary> = {}): CircleSummary {
  return {
    id: 'c1',
    name: 'Family',
    amount_kobo_text: '5000000',
    period_days: 30,
    member_target: 2,
    status: 'active',
    created_by: ADA,
    activated_on: '2026-10-01',
    member_count: 2,
    joined_count: 2,
    ...over,
  };
}

function member(userId: string, position: number, status: CircleMember['status'] = 'joined') {
  return {
    membership_id: `m-${userId}`,
    circle_id: 'c1',
    user_id: userId,
    payout_position: position,
    status,
    display_name: userId,
    phone: null,
  } satisfies CircleMember;
}

function round(recipient: string, due = '2026-10-31'): CircleRound {
  return {
    round_id: 'r1',
    circle_id: 'c1',
    round_number: 1,
    due_date: due,
    status: 'open',
    recipient_membership_id: `m-${recipient}`,
    recipient_user_id: recipient,
    recipient_name: recipient,
    pot_kobo_text: '0',
    contribution_count: 2,
    confirmed_count: 0,
  };
}

function contribution(payer: string, status: RoundContribution['status']): RoundContribution {
  return {
    contribution_id: `k-${payer}`,
    round_id: 'r1',
    circle_id: 'c1',
    round_number: 1,
    due_date: '2026-10-31',
    payer_membership_id: `m-${payer}`,
    payer_user_id: payer,
    payer_name: payer,
    amount_kobo_text: '5000000',
    status,
    claimed_at: null,
    confirmed_at: null,
  };
}

function active(recipient: string, mine: RoundContribution['status'], ada = 'pending' as RoundContribution['status']): CircleView {
  return {
    circle: circle(),
    members: [member(ADA, 1), member(ME, 2)],
    round: round(recipient),
    contributions: [contribution(ADA, ada), contribution(ME, mine)],
  };
}

describe('standing', () => {
  it('says I owe when my share is pending', () => {
    expect(standing(active(ADA, 'pending'), ME)).toMatchObject({ kind: 'owe', toSelf: false });
  });

  it('says I owe my own pot when I am the recipient and have not put my share in', () => {
    // open_round makes the recipient pay too; the screen must not skip it.
    expect(standing(active(ME, 'pending'), ME)).toMatchObject({ kind: 'owe', toSelf: true });
  });

  it('says waiting once I have claimed', () => {
    expect(standing(active(ADA, 'claimed'), ME).kind).toBe('waiting');
  });

  it('says disputed for a disputed contribution, not paid or waiting', () => {
    expect(standing(active(ADA, 'disputed'), ME).kind).toBe('disputed');
  });

  it('says paid once confirmed', () => {
    expect(standing(active(ADA, 'confirmed'), ME).kind).toBe('paid');
  });

  it('says receiving when it is my turn and my share is in', () => {
    expect(standing(active(ME, 'confirmed'), ME).kind).toBe('receiving');
  });

  it('puts an unaccepted invite ahead of the circle being in setup', () => {
    const view: CircleView = {
      circle: circle({ status: 'inviting' }),
      members: [member(ADA, 1), member(ME, 2, 'invited')],
      round: null,
      contributions: [],
    };
    expect(standing(view, ME).kind).toBe('invited');
  });

  it('reports a cancelled circle as cancelled whatever else is true', () => {
    const view = { ...active(ADA, 'pending'), circle: circle({ status: 'cancelled' }) };
    expect(standing(view, ME).kind).toBe('cancelled');
  });
});

describe('mostUrgent', () => {
  it('leads with money owed over a payment waiting on someone else', () => {
    const waiting = { ...active(ADA, 'claimed'), circle: circle({ id: 'waiting' }) };
    const owe = { ...active(ADA, 'pending'), circle: circle({ id: 'owe' }) };
    expect(mostUrgent([waiting, owe], ME)?.view.circle.id).toBe('owe');
  });

  it('returns null for no circles', () => {
    expect(mostUrgent([], ME)).toBeNull();
  });
});

describe('awaitingMyConfirmation', () => {
  it('lists claimed payments only for the recipient', () => {
    const view = active(ME, 'confirmed', 'claimed');
    expect(awaitingMyConfirmation(view, ME).map((c) => c.payer_user_id)).toEqual([ADA]);
    expect(awaitingMyConfirmation(view, ADA)).toEqual([]);
  });
});
