import { notFound, redirect } from 'next/navigation';

import { ActionButton } from '@/components/action-button';
import { Avatar } from '@/components/ui/avatar';
import { BackLink } from '@/components/ui/back-link';
import { Icon } from '@/components/ui/icon';
import { CONTRIBUTION_CHIP, CONTRIBUTION_TONE } from '@/components/ui/status';
import { StatusChip } from '@/components/ui/status-chip';
import { TimeAgo } from '@/components/ui/time-ago';
import {
  currentRound,
  getCircle,
  getPayoutAccount,
  listContributions,
  listMembers,
  listRounds,
  type CircleMember,
  type CircleRound,
  type CircleSummary,
  type RoundContribution,
} from '@/lib/circles/queries';
import { awaitingMyConfirmation, firstName, standing } from '@/lib/circles/view-model';
import { cadence, countdown, dayMonth, isOverdue, nairaClean, potNaira } from '@/lib/format';
import { changedRecently, daysSinceChange } from '@/lib/payout';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { ConfirmCard } from './confirm-card';
import { DetailTabs } from './detail-tabs';
import { InviteForm } from './invite-form';
import { OwnShareSection, PaySection } from './pay-section';

/**
 * One circle: whose turn it is, who has paid, and the one thing you can do.
 *
 * This is the screen the Phase 3 acceptance criterion is really about — a
 * non-technical tester completing a round without help. So every action is
 * phrased as the thing the person did in real life ("I've paid", "Received"),
 * not as the transition it triggers, and only the buttons this person is
 * actually allowed to press are rendered. The database refuses the rest
 * anyway; hiding them is so nobody has to discover that by being told no.
 */
export default async function CirclePage({
  params,
  searchParams,
}: PageProps<'/circles/[circleId]'>) {
  const { circleId } = await params;
  const query = await searchParams;

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
  const round = currentRound(rounds);
  const contributions = round ? await listContributions(round.round_id) : [];

  const view = { circle, members, round, contributions };
  const s = standing(view, user.id);
  const isOwner = circle.created_by === user.id;
  const recipientName = firstName(round?.recipient_name ?? null);

  // The recipient's account, only when this person has a transfer to make.
  // RLS hides it from anyone who has not joined this circle (migration 0010).
  const account =
    s.kind === 'owe' && !s.toSelf && round ? await getPayoutAccount(round.recipient_user_id) : null;

  const pot = potNaira(circle.amount_kobo_text, round?.contribution_count ?? circle.member_target);
  const takenPositions = new Set(members.map((m) => m.payout_position));
  const nextPosition = firstFreePosition(takenPositions, circle.member_target);

  return (
    <>
      <div className="hero hero--tall">
        <div className="hero__bar">
          <BackLink href="/dashboard" onHero />
          <b style={{ textAlign: 'center', minWidth: 0 }}>{circle.name}</b>
          <span style={{ width: 42 }} aria-hidden="true" />
        </div>
        {round ? (
          <>
            <div className="hero__label">
              {round.recipient_user_id === user.id ? 'You receive' : `${recipientName} receives`} ·
              Round {round.round_number} of {circle.member_target}
            </div>
            <div className="amount">{pot}</div>
            <div
              className="progress"
              role="progressbar"
              aria-label="Payments confirmed"
              aria-valuemin={0}
              aria-valuemax={round.contribution_count}
              aria-valuenow={round.confirmed_count}
            >
              <i
                style={{
                  width: `${round.contribution_count ? Math.round((round.confirmed_count / round.contribution_count) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="hero__meta">
              <span>
                {round.confirmed_count} of {round.contribution_count} confirmed
              </span>
              <span style={isOverdue(round.due_date) ? { color: 'var(--lime)', fontWeight: 700 } : undefined}>
                Due {dayMonth(round.due_date)} · {countdown(round.due_date)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="hero__label">
              {circle.status === 'completed'
                ? 'Finished'
                : circle.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Not started yet'}
            </div>
            <div className="amount">{nairaClean(circle.amount_kobo_text)}</div>
            <div className="hero__meta">
              <span>Each person, {cadence(circle.period_days)}</span>
              <span>
                {circle.joined_count} of {circle.member_target} joined
              </span>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: -22, position: 'relative' }}>
        {s.kind === 'invited' ? (
          <div className="card">
            <b className="title">You’re invited to {circle.name}</b>
            <p className="mute" style={{ marginBottom: 14 }}>
              Everyone pays {nairaClean(circle.amount_kobo_text)} {cadence(circle.period_days)}. You
              would receive the pot of {pot} in round {s.membership.payout_position}.
            </p>
            <ActionButton
              path="/api/circles/accept-invite"
              body={{ membershipId: s.membership.membership_id }}
              label="Join this circle"
              pendingLabel="Joining…"
              successMessage={`You joined ${circle.name}.`}
            />
          </div>
        ) : null}

        {s.kind === 'setup' && isOwner ? (
          <div className="card">
            {nextPosition ? (
              <InviteForm
                circleId={circle.id}
                nextPosition={nextPosition}
                currentUserId={user.id}
                memberUserIds={members.map((m) => m.user_id)}
              />
            ) : (
              <p className="mute" style={{ margin: 0 }}>
                Every place is filled.
              </p>
            )}
          </div>
        ) : null}

        {s.kind === 'setup' && !isOwner ? (
          <div className="card">
            <b className="title">Waiting for everyone to join</b>
            <p className="mute">
              {circle.joined_count} of {circle.member_target} so far. The circle starts once
              everyone is in.
            </p>
          </div>
        ) : null}

        {s.kind === 'owe' && !s.toSelf ? (
          <PaySection
            contributionId={s.contribution.contribution_id}
            amount={nairaClean(s.contribution.amount_kobo_text)}
            recipientName={recipientName}
            account={account}
            changedDaysAgo={account && changedRecently(account) ? daysSinceChange(account) : null}
            openInitially={query['pay'] === '1'}
          />
        ) : null}

        {s.kind === 'owe' && s.toSelf ? (
          <OwnShareSection
            contributionId={s.contribution.contribution_id}
            amount={nairaClean(s.contribution.amount_kobo_text)}
          />
        ) : null}

        {s.kind === 'waiting' ? (
          <div className="card card--wait">
            <b className="title">Waiting for {recipientName} to confirm</b>
            <p>
              You marked {nairaClean(s.contribution.amount_kobo_text)} as paid
              {s.contribution.claimed_at ? (
                <>
                  {' '}
                  (<TimeAgo iso={s.contribution.claimed_at} />)
                </>
              ) : null}
              .
            </p>
          </div>
        ) : null}

        {s.kind === 'disputed' ? (
          <div className="card card--bad">
            <b className="title">Your payment is disputed</b>
            <p>
              {recipientName} says the money has not arrived. Check your bank app for the transfer
              and talk to {recipientName} directly.
            </p>
          </div>
        ) : null}

        {s.kind === 'paid' && round ? (
          <div className="card card--ok">
            <b className="title">You’re paid up for round {round.round_number}</b>
          </div>
        ) : null}

        <RecipientCards view={{ circle, members, round, contributions }} userId={user.id} />

        {round?.status === 'settled' ? (
          <div className="card">
            <b className="title">Everyone has paid</b>
            <p className="mute" style={{ marginBottom: 14 }}>
              Closing the round records {pot} as received by{' '}
              {round.recipient_user_id === user.id ? 'you' : recipientName} and opens the next one.
            </p>
            <ActionButton
              path="/api/circles/close-round"
              body={{ roundId: round.round_id }}
              label="Close this round"
              pendingLabel="Closing…"
              successMessage="Round closed."
            />
          </div>
        ) : null}

        {round?.status === 'disputed' ? (
          <div className="card card--bad">
            <b className="title">This round has a disputed payment</b>
            <p>It stays open until the dispute is settled.</p>
          </div>
        ) : null}

        {s.kind === 'completed' ? (
          <div className="card card--ok">
            <b className="title">Every round is finished</b>
            <p>Everyone has received the pot once.</p>
          </div>
        ) : null}

        {s.kind === 'cancelled' ? (
          <div className="card">
            <b className="title">This circle was cancelled</b>
            <p className="mute">No payments were recorded.</p>
          </div>
        ) : null}
      </div>

      <DetailTabs
        panels={{
          members: (
            <MembersPanel
              circle={circle}
              members={members}
              round={round}
              contributions={contributions}
              userId={user.id}
            />
          ),
          order: <OrderPanel members={members} round={round} circle={circle} userId={user.id} />,
          rules: <RulesPanel circle={circle} />,
        }}
      />

      {s.kind === 'setup' && isOwner ? (
        <div className="pad stack-12" style={{ marginTop: 20 }}>
          {circle.joined_count === circle.member_target ? (
            <ActionButton
              path="/api/circles/activate-circle"
              body={{ circleId: circle.id }}
              label="Start the circle"
              pendingLabel="Starting…"
              successMessage="Round 1 is open."
              confirm="Once the circle starts, the order is locked and round 1 opens. Continue?"
            />
          ) : (
            <p className="mute small" style={{ margin: 0 }}>
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
        </div>
      ) : null}
    </>
  );
}

/** The recipient's side of the round: payments to confirm, or a calm "nothing yet". */
function RecipientCards({
  view,
  userId,
}: {
  view: {
    circle: CircleSummary;
    members: CircleMember[];
    round: CircleRound | null;
    contributions: RoundContribution[];
  };
  userId: string;
}) {
  const { round } = view;
  if (!round || round.recipient_user_id !== userId) return null;

  const toConfirm = awaitingMyConfirmation(view, userId);
  const allIn = round.confirmed_count === round.contribution_count;

  if (toConfirm.length === 0) {
    if (allIn || round.status === 'settled') return null;
    return (
      <div className="card">
        <b className="title">Nothing to confirm right now</b>
        <p className="mute">Payments show up here as people mark them.</p>
      </div>
    );
  }

  return (
    <>
      {toConfirm.map((c) => (
        <ConfirmCard
          key={c.contribution_id}
          contributionId={c.contribution_id}
          payerName={firstName(c.payer_name)}
          amount={nairaClean(c.amount_kobo_text)}
          claimedAt={c.claimed_at}
          isOwnShare={c.payer_user_id === userId}
        />
      ))}
    </>
  );
}

function MembersPanel({
  circle,
  members,
  round,
  contributions,
  userId,
}: {
  circle: CircleSummary;
  members: CircleMember[];
  round: CircleRound | null;
  contributions: RoundContribution[];
  userId: string;
}) {
  if (round) {
    return (
      <div className="card card--list">
        {contributions.map((c) => (
          <div className="row" key={c.contribution_id}>
            <Avatar name={c.payer_name} />
            <span className="row__main">
              {c.payer_name ?? 'A member'}
              {c.payer_user_id === userId ? ' (you)' : ''}
              {c.payer_user_id === round.recipient_user_id ? ' · receives' : ''}
              <small>
                {c.status === 'confirmed' && c.confirmed_at ? (
                  <>
                    Confirmed <TimeAgo iso={c.confirmed_at} />
                  </>
                ) : c.status === 'claimed' && c.claimed_at ? (
                  <>
                    Marked paid <TimeAgo iso={c.claimed_at} />
                  </>
                ) : c.status === 'disputed' ? (
                  'Payment disputed'
                ) : (
                  'No payment yet'
                )}
              </small>
            </span>
            <StatusChip tone={CONTRIBUTION_TONE[c.status]}>{CONTRIBUTION_CHIP[c.status]}</StatusChip>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card card--list">
      {members.map((m) => (
        <div className="row" key={m.membership_id}>
          <Avatar name={m.display_name} />
          <span className="row__main">
            {m.display_name ?? 'A member'}
            {m.user_id === userId ? ' (you)' : ''}
            <small>
              {m.user_id === circle.created_by ? 'Started this circle' : `Receives in round ${m.payout_position}`}
            </small>
          </span>
          <StatusChip tone={m.status === 'joined' ? 'ok' : m.status === 'invited' ? 'wait' : 'neutral'}>
            {m.status === 'joined' ? 'Joined' : m.status === 'invited' ? 'Invited' : 'Left'}
          </StatusChip>
        </div>
      ))}
      {members.length < circle.member_target ? (
        <div className="row">
          <span className="dot" aria-hidden="true">
            <Icon name="plus" size={18} />
          </span>
          <span className="row__main mute">
            {circle.member_target - members.length} more{' '}
            {circle.member_target - members.length === 1 ? 'place' : 'places'} to fill
          </span>
        </div>
      ) : null}
    </div>
  );
}

function OrderPanel({
  members,
  round,
  circle,
  userId,
}: {
  members: CircleMember[];
  round: CircleRound | null;
  circle: CircleSummary;
  userId: string;
}) {
  const current = round?.round_number ?? (circle.status === 'completed' ? circle.member_target + 1 : 0);
  const byPosition = new Map(members.map((m) => [m.payout_position, m]));

  return (
    <div className="card">
      <ol className="timeline" aria-label="Who receives in which round">
        {Array.from({ length: circle.member_target }, (_, i) => i + 1).map((position) => {
          const m = byPosition.get(position);
          const done = position < current;
          const now = position === current;
          return (
            <li key={position}>
              <span className={`num${done ? ' num--done' : now ? ' num--now' : ''}`}>
                {done ? <Icon name="check" size={14} /> : position}
              </span>
              <span>
                {m ? (m.display_name ?? 'A member') : <span className="mute">Not filled yet</span>}
                {m?.user_id === userId ? ' (you)' : ''}
              </span>
              <em>
                {done ? 'Received' : now && round ? `Due ${dayMonth(round.due_date)}` : `Round ${position}`}
              </em>
            </li>
          );
        })}
      </ol>
      {circle.status === 'draft' || circle.status === 'inviting' ? (
        <p className="mute small" style={{ marginTop: 8 }}>
          The order is the order people were invited in. It locks when the circle starts.
        </p>
      ) : null}
    </div>
  );
}

function RulesPanel({ circle }: { circle: CircleSummary }) {
  const amount = nairaClean(circle.amount_kobo_text);
  return (
    <div className="card">
      <p style={{ margin: '0 0 12px' }}>
        <b>
          Everyone pays {amount} {cadence(circle.period_days)} — including the person receiving.
        </b>
      </p>
      <p className="mute" style={{ margin: '0 0 12px' }}>
        Each round one member receives the whole pot: {amount} × {circle.member_target} people ={' '}
        {potNaira(circle.amount_kobo_text, circle.member_target)}. Everyone receives once, in the
        order shown.
      </p>
      <p className="mute" style={{ margin: '0 0 12px' }}>
        You pay each other directly in your bank apps. Circle never holds the money. It only keeps
        the record.
      </p>
      <p className="mute" style={{ margin: '0 0 12px' }}>
        A payment counts once the person receiving taps Received. When every payment is confirmed,
        any member can close the round and the next one opens.
      </p>
      <p className="mute" style={{ margin: 0 }}>
        If a payment is late or doesn’t arrive, talk to each other for now. Reminders and help with
        disputes come in a later update.
      </p>
    </div>
  );
}

/** The lowest rotation slot nobody holds, or null when the circle is full. */
function firstFreePosition(taken: Set<number>, memberTarget: number): number | null {
  for (let position = 1; position <= memberTarget; position += 1) {
    if (!taken.has(position)) return position;
  }
  return null;
}
