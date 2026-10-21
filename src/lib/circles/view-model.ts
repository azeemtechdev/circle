import type {
  CircleMember,
  CircleRound,
  CircleSummary,
  RoundContribution,
} from '@/lib/circles/queries';

/**
 * What a circle means to the person looking at it.
 *
 * Pure: everything here is derived from rows the database already returned,
 * so it can be tested without one, and nothing here decides anything the
 * database has not. In particular it never infers a state — it reads the
 * status columns the state machines set, and only picks which one matters
 * most to this viewer right now.
 */

export interface CircleView {
  circle: CircleSummary;
  members: CircleMember[];
  /** The earliest round not yet closed, or null before activation / after the last. */
  round: CircleRound | null;
  contributions: RoundContribution[];
}

export type MyStanding =
  | { kind: 'invited'; membership: CircleMember }
  | { kind: 'setup' }
  /** My share is unpaid. `toSelf` when I am also this round's recipient. */
  | { kind: 'owe'; contribution: RoundContribution; toSelf: boolean }
  | { kind: 'disputed'; contribution: RoundContribution }
  | { kind: 'waiting'; contribution: RoundContribution }
  /** I receive this round and my own share is in. */
  | { kind: 'receiving' }
  | { kind: 'paid' }
  | { kind: 'completed' }
  | { kind: 'cancelled' }
  /** Visible to me but I hold no seat — e.g. an owner after leaving. */
  | { kind: 'observer' };

export function standing(view: CircleView, userId: string): MyStanding {
  const { circle, members, round, contributions } = view;
  const me = members.find((m) => m.user_id === userId) ?? null;

  if (circle.status === 'cancelled') return { kind: 'cancelled' };
  if (circle.status === 'completed') return { kind: 'completed' };
  if (me?.status === 'invited') return { kind: 'invited', membership: me };
  if (circle.status === 'draft' || circle.status === 'inviting') return { kind: 'setup' };
  if (!me || !round) return { kind: 'observer' };

  const mine = contributions.find((c) => c.payer_user_id === userId) ?? null;
  const iReceive = round.recipient_user_id === userId;

  if (mine?.status === 'pending') return { kind: 'owe', contribution: mine, toSelf: iReceive };
  if (mine?.status === 'disputed') return { kind: 'disputed', contribution: mine };
  if (iReceive) return { kind: 'receiving' };
  if (mine?.status === 'claimed') return { kind: 'waiting', contribution: mine };
  return { kind: 'paid' };
}

/**
 * Which circle the home screen leads with: the one asking something of you.
 * Money you owe first, then an invitation, then payments waiting on you to
 * confirm, then anything in question.
 */
const URGENCY: Record<MyStanding['kind'], number> = {
  owe: 0,
  invited: 1,
  receiving: 2,
  disputed: 3,
  waiting: 4,
  setup: 5,
  paid: 6,
  observer: 7,
  completed: 8,
  cancelled: 9,
};

export function mostUrgent(
  views: CircleView[],
  userId: string,
): { view: CircleView; standing: MyStanding } | null {
  let best: { view: CircleView; standing: MyStanding } | null = null;
  for (const view of views) {
    const s = standing(view, userId);
    if (
      !best ||
      URGENCY[s.kind] < URGENCY[best.standing.kind] ||
      (URGENCY[s.kind] === URGENCY[best.standing.kind] && earlierDue(view, best.view))
    ) {
      best = { view, standing: s };
    }
  }
  return best;
}

function earlierDue(a: CircleView, b: CircleView): boolean {
  if (!a.round || !b.round) return false;
  return a.round.due_date < b.round.due_date;
}

/** Payments the recipient can act on: claimed, waiting for "Received". */
export function awaitingMyConfirmation(view: CircleView, userId: string): RoundContribution[] {
  if (view.round?.recipient_user_id !== userId) return [];
  return view.contributions.filter((c) => c.status === 'claimed');
}

/** The member whose turn it is in round `n`: the one holding payout position n. */
export function recipientForRound(members: CircleMember[], n: number): CircleMember | null {
  return members.find((m) => m.payout_position === n) ?? null;
}

/** "You" for yourself, the display name otherwise — never a guessed pronoun. */
export function nameFor(userId: string | null, name: string | null, viewerId: string): string {
  if (userId === viewerId) return 'You';
  return name?.trim() || 'A member';
}

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'them';
}
