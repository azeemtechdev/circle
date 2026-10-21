import type { Tone } from '@/components/ui/status';
import {
  type CircleEvent,
  type CircleSummary,
  listContributionsById,
  listMembershipsById,
  listNames,
  listRecentEvents,
  listRoundsById,
} from '@/lib/circles/queries';
import { nairaClean } from '@/lib/format';

/**
 * The activity feed: the audit log, read back as sentences.
 *
 * `events` is the debugging backbone (ARCHITECTURE.md §7), so it already
 * records every transition with its actor. This turns those rows into what a
 * member would say out loud. It only reads; it never decides anything.
 */

export interface ActivityItem {
  id: string;
  text: string;
  circleName: string;
  circleId: string | null;
  /** ISO timestamp. Formatted in the browser, so "9:12am" is the reader's clock, not the server's. */
  at: string;
  tone: Tone;
}

export async function loadActivity(
  viewerId: string,
  circles: CircleSummary[],
  limit = 40,
): Promise<ActivityItem[]> {
  const events = await listRecentEvents(limit);
  if (events.length === 0) return [];

  const idsOf = (type: string) =>
    [...new Set(events.filter((e) => e.entity_type === type).map((e) => e.entity_id))];

  const [contributions, rounds, memberships] = await Promise.all([
    listContributionsById(idsOf('contribution')),
    listRoundsById(idsOf('round')),
    listMembershipsById(idsOf('membership')),
  ]);

  const names = await listNames([
    ...new Set(events.map((e) => e.actor_id).filter((id): id is string => Boolean(id))),
  ]);

  const circleById = new Map(circles.map((c) => [c.id, c]));
  const contributionById = new Map(contributions.map((c) => [c.contribution_id, c]));
  const roundById = new Map(rounds.map((r) => [r.round_id, r]));
  const membershipById = new Map(memberships.map((m) => [m.membership_id, m]));

  const who = (userId: string | null, name: string | null | undefined) =>
    userId === viewerId ? 'You' : name?.trim() || 'A member';
  const whose = (userId: string | null, name: string | null | undefined) =>
    userId === viewerId ? 'Your' : `${name?.trim() || 'A member'}’s`;

  const items: ActivityItem[] = [];

  for (const event of events) {
    const actor = who(event.actor_id, event.actor_id ? names.get(event.actor_id) : null);
    let circleId: string | null = null;
    let text: string | null = null;
    let tone: Tone = 'neutral';

    switch (event.entity_type) {
      case 'circle': {
        circleId = event.entity_id;
        const name = circleById.get(circleId)?.name ?? 'A circle';
        if (event.event_type === 'circle.created') text = `${actor} started ${name}`;
        else if (event.event_type === 'circle.activated') {
          text = `${name} began. Round 1 is open`;
          tone = 'ok';
        } else if (event.event_type === 'circle.completed') {
          text = `${name} is finished. Everyone has received once`;
          tone = 'ok';
        } else if (event.event_type === 'circle.cancelled') {
          text = `${name} was cancelled`;
          tone = 'bad';
        }
        break;
      }
      case 'membership': {
        const m = membershipById.get(event.entity_id);
        if (!m) break;
        circleId = m.circle_id;
        if (event.event_type === 'membership.invited') {
          text = `${actor} invited ${who(m.user_id, m.display_name)}`;
        } else if (event.event_type === 'membership.joined') {
          text = `${who(m.user_id, m.display_name)} joined`;
          tone = 'ok';
        }
        break;
      }
      case 'round': {
        const r = roundById.get(event.entity_id);
        if (!r) break;
        circleId = r.circle_id;
        const recipient = who(r.recipient_user_id, r.recipient_name);
        if (event.event_type === 'round.opened') {
          text = `Round ${r.round_number} opened. ${recipient} ${recipient === 'You' ? 'receive' : 'receives'} this time`;
          tone = 'bad';
        } else if (event.event_type === 'round.settled') {
          text = `Everyone has paid in round ${r.round_number}`;
          tone = 'ok';
        } else if (event.event_type === 'round.closed') {
          const pot = typeof event.metadata['pot_kobo'] === 'string' ? event.metadata['pot_kobo'] : null;
          text = pot
            ? `${recipient} received ${nairaClean(pot)}`
            : `Round ${r.round_number} closed`;
          tone = 'ok';
        }
        break;
      }
      case 'contribution': {
        const c = contributionById.get(event.entity_id);
        if (!c) break;
        circleId = c.circle_id;
        const payer = who(c.payer_user_id, c.payer_name);
        if (event.event_type === 'contribution.claimed') {
          text = `${payer} marked ${nairaClean(c.amount_kobo_text)} as paid`;
          tone = 'wait';
        } else if (event.event_type === 'contribution.confirmed') {
          text = `${whose(c.payer_user_id, c.payer_name)} payment was confirmed`;
          tone = 'ok';
        } else if (event.event_type.endsWith('.disputed')) {
          text = `${whose(c.payer_user_id, c.payer_name)} payment is disputed`;
          tone = 'bad';
        }
        break;
      }
    }

    // Unknown or noisy event types (e.g. round.collecting) are left out
    // rather than shown as jargon.
    if (!text) continue;

    items.push({
      id: event.id,
      text,
      circleId,
      circleName: (circleId && circleById.get(circleId)?.name) || 'Circle',
      at: event.created_at,
      tone,
    });
  }

  return items;
}

export type { CircleEvent };
