import {
  type CircleRound,
  listContributionsForRounds,
  listMembersOfCircles,
  listMyCircles,
  listUnclosedRounds,
} from '@/lib/circles/queries';
import type { CircleView } from '@/lib/circles/view-model';

/**
 * Every circle you can see, each with its members, current round and that
 * round's contributions — four queries in total, however many circles.
 */
export async function loadMyCircleViews(): Promise<CircleView[]> {
  const circles = await listMyCircles();
  if (circles.length === 0) return [];

  const [members, rounds] = await Promise.all([
    listMembersOfCircles(circles.map((c) => c.id)),
    listUnclosedRounds(),
  ]);

  // Rounds arrive ordered by number, so the first unclosed one per circle is
  // the current one — the same rule as currentRound().
  const current = new Map<string, CircleRound>();
  for (const round of rounds) {
    if (!current.has(round.circle_id)) current.set(round.circle_id, round);
  }

  const contributions = await listContributionsForRounds(
    [...current.values()].map((r) => r.round_id),
  );

  return circles.map((circle) => {
    const round = current.get(circle.id) ?? null;
    return {
      circle,
      members: members.filter((m) => m.circle_id === circle.id),
      round,
      contributions: round ? contributions.filter((c) => c.round_id === round.round_id) : [],
    };
  });
}
