import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ActionButton } from '@/components/action-button';
import {
  currentRound,
  getCircle,
  listContributions,
  listMembers,
  listRounds,
} from '@/lib/circles/queries';
import { countdown, isOverdue, naira, shortDate } from '@/lib/format';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { InviteForm } from './invite-form';

/**
 * One circle: who is in it, whose turn it is, who has paid.
 *
 * This is the screen the Phase 3 acceptance criterion is really about — a
 * non-technical tester completing a round without help. So every action is
 * phrased as the thing the person did in real life ("I have paid", "Yes, I got
 * it"), not as the transition it triggers, and only the buttons this person is
 * actually allowed to press are rendered. The database refuses the rest
 * anyway; hiding them is so nobody has to discover that by being told no.
 */
export default async function CirclePage({ params }: PageProps<'/circles/[circleId]'>) {
  const { circleId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const circle = await getCircle(circleId);
  // RLS returns nothing for a circle you are not in, so "not found" and "not
  // yours" are deliberately the same answer: anything else confirms the circle
  // exists to someone who should not know.
  if (!circle) notFound();

  const [members, rounds] = await Promise.all([listMembers(circleId), listRounds(circleId)]);

  const me = members.find((m) => m.user_id === user.id) ?? null;
  const isOwner = circle.created_by === user.id;
  const round = currentRound(rounds);
  const contributions = round ? await listContributions(round.round_id) : [];

  const myInvite = me?.status === 'invited' ? me : null;
  const myContribution = contributions.find((c) => c.payer_user_id === user.id) ?? null;
  const iAmRecipient = round?.recipient_user_id === user.id;
  const takenPositions = new Set(members.map((m) => m.payout_position));
  const nextPosition = firstFreePosition(takenPositions, circle.member_target);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header>
        <Link href="/dashboard" className="text-sm underline underline-offset-4 opacity-70">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{circle.name}</h1>
        <p className="mt-1 text-sm opacity-70">
          {naira(circle.amount_kobo_text)} each, every {circle.period_days} days ·{' '}
          <span className="uppercase tracking-wide">{circle.status}</span>
        </p>
      </header>

      {myInvite ? (
        <section className="rounded-lg border border-black/15 p-4 dark:border-white/20">
          <p className="text-sm">
            You have been invited to this circle as person {myInvite.payout_position} in the
            rotation.
          </p>
          <div className="mt-3">
            <ActionButton
              path="/api/circles/accept-invite"
              body={{ membershipId: myInvite.membership_id }}
              label="Join this circle"
              pendingLabel="Joining…"
            />
          </div>
        </section>
      ) : null}

      {/* Whose turn, and the countdown. */}
      {round ? (
        <section className="rounded-lg border border-black/15 p-4 dark:border-white/20">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Round {round.round_number}</h2>
            <span
              className={`text-sm ${
                isOverdue(round.due_date) ? 'text-red-700 dark:text-red-400' : 'opacity-70'
              }`}
            >
              {countdown(round.due_date)}
            </span>
          </div>
          <p className="mt-1 text-sm opacity-70">
            {iAmRecipient ? 'Your turn to collect' : `${round.recipient_name ?? 'Someone'} collects`}{' '}
            · due {shortDate(round.due_date)}
          </p>
          <p className="mt-2 text-sm">
            <span className="font-medium">{naira(round.pot_kobo_text)}</span> confirmed so far ·{' '}
            {round.confirmed_count} of {round.contribution_count} paid
          </p>
        </section>
      ) : circle.status === 'completed' ? (
        <p className="rounded-lg border border-black/15 p-4 text-sm dark:border-white/20">
          Every round is finished. Everyone has collected once.
        </p>
      ) : null}

      {/* The thing this person can do right now. */}
      {myContribution ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Your payment this round</h2>
          {myContribution.status === 'pending' ? (
            <>
              <p className="text-sm opacity-70">
                Send {naira(myContribution.amount_kobo_text)} to{' '}
                {round?.recipient_name ?? 'the recipient'} in your bank app, then tell us here.
              </p>
              <ActionButton
                path="/api/circles/claim-contribution"
                body={{ contributionId: myContribution.contribution_id }}
                label="I have paid"
                pendingLabel="Recording…"
                confirm={`Confirm you have already sent ${naira(
                  myContribution.amount_kobo_text,
                )} to ${round?.recipient_name ?? 'the recipient'}.`}
              />
            </>
          ) : myContribution.status === 'claimed' ? (
            <p className="text-sm opacity-70">
              Waiting for {round?.recipient_name ?? 'the recipient'} to confirm they received it.
            </p>
          ) : (
            <p className="text-sm opacity-70">Confirmed received. Nothing more to do this round.</p>
          )}
        </section>
      ) : null}

      {/* Who has paid — and, if it is your turn, the confirm buttons. */}
      {round ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Who has paid</h2>
          <ul className="flex flex-col gap-2">
            {contributions.map((c) => (
              <li
                key={c.contribution_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/15 p-3 dark:border-white/20"
              >
                <div>
                  <p className="text-sm font-medium">
                    {c.payer_user_id === user.id ? 'You' : (c.payer_name ?? 'A member')}
                  </p>
                  <p className="text-xs opacity-70">
                    {naira(c.amount_kobo_text)} · {PAID_LABEL[c.status]}
                  </p>
                </div>

                {iAmRecipient && c.status === 'claimed' ? (
                  <ActionButton
                    path="/api/circles/confirm-contribution"
                    body={{ contributionId: c.contribution_id }}
                    label="Yes, I got it"
                    pendingLabel="Confirming…"
                    variant="secondary"
                    confirm={`Confirm ${
                      c.payer_name ?? 'this member'
                    } really sent you ${naira(c.amount_kobo_text)}. This records the money in the books and cannot be undone.`}
                  />
                ) : null}
              </li>
            ))}
          </ul>

          {round.status === 'settled' ? (
            <div className="mt-2">
              <p className="mb-2 text-sm opacity-70">
                Everyone has paid. Closing the round pays {naira(round.pot_kobo_text)} to{' '}
                {round.recipient_name ?? 'the recipient'} and starts the next one.
              </p>
              <ActionButton
                path="/api/circles/close-round"
                body={{ roundId: round.round_id }}
                label="Close this round"
                pendingLabel="Closing…"
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Members, and the owner's setup actions. */}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          Members ({circle.joined_count} of {circle.member_target} joined)
        </h2>
        <ol className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.membership_id} className="flex justify-between gap-3 text-sm">
              <span>
                {m.payout_position}. {m.user_id === user.id ? 'You' : (m.display_name ?? 'Member')}
              </span>
              <span className="opacity-60">{m.status}</span>
            </li>
          ))}
        </ol>
      </section>

      {isOwner && (circle.status === 'draft' || circle.status === 'inviting') ? (
        <section className="flex flex-col gap-4 border-t border-black/10 pt-4 dark:border-white/15">
          {nextPosition ? (
            <InviteForm circleId={circle.id} nextPosition={nextPosition} />
          ) : (
            <p className="text-sm opacity-70">Every position is filled.</p>
          )}

          {circle.joined_count === circle.member_target ? (
            <ActionButton
              path="/api/circles/activate-circle"
              body={{ circleId: circle.id }}
              label="Start the circle"
              pendingLabel="Starting…"
              confirm="Once the circle starts, the rotation order is locked and round 1 opens. Continue?"
            />
          ) : (
            <p className="text-sm opacity-70">
              Everyone must join before the circle can start. {circle.joined_count} of{' '}
              {circle.member_target} so far.
            </p>
          )}

          <ActionButton
            path="/api/circles/cancel-circle"
            body={{ circleId: circle.id }}
            label="Cancel this circle"
            pendingLabel="Cancelling…"
            variant="danger"
            confirm="Cancel this circle for everyone? This cannot be undone."
          />
        </section>
      ) : null}
    </main>
  );
}

const PAID_LABEL: Record<string, string> = {
  pending: 'not paid yet',
  claimed: 'says they paid',
  confirmed: 'confirmed received',
  disputed: 'disputed',
};

/** The lowest rotation slot nobody holds, or null when the circle is full. */
function firstFreePosition(taken: Set<number>, memberTarget: number): number | null {
  for (let position = 1; position <= memberTarget; position += 1) {
    if (!taken.has(position)) return position;
  }
  return null;
}
