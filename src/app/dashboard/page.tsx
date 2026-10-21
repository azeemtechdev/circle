import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ActivityRow } from '@/components/ui/activity-row';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { Greeting } from '@/components/ui/greeting';
import { Icon } from '@/components/ui/icon';
import { StatusChip } from '@/components/ui/status-chip';
import type { Tone } from '@/components/ui/status';
import { loadActivity } from '@/lib/circles/activity';
import { loadMyCircleViews } from '@/lib/circles/load';
import {
  type CircleView,
  firstName,
  type MyStanding,
  mostUrgent,
  standing,
} from '@/lib/circles/view-model';
import { cadence, dayMonth, nairaClean, potNaira } from '@/lib/format';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Home: the one thing you need to do, then all your circles.
 *
 * proxy.ts already redirects a signed-out visitor, but this page reads user
 * data, so it re-checks with getUser(). Proxy is an optimistic check; a page
 * that trusts it is one config change away from leaking.
 *
 * Everything shown is derived from the signed-in user's own rows. There is no
 * "preview as" switch: what you see is what your seat in each circle means.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  const views = await loadMyCircleViews();
  const activity = await loadActivity(
    user.id,
    views.map((v) => v.circle),
    12,
  );

  const name = profile?.display_name ?? null;
  const focus = mostUrgent(views, user.id);
  const live = views.filter(
    (v) => v.circle.status !== 'completed' && v.circle.status !== 'cancelled',
  ).length;

  return (
    <>
      <div className="hero">
        <div className="hero__bar">
          <div className="hero__who">
            <Avatar name={name} />
            <Greeting name={firstName(name)} />
          </div>
          <Link href="/activity" className="round-button" aria-label="Activity">
            <Icon name="bell" />
          </Link>
        </div>
        <Hero focus={focus} userId={user.id} />
      </div>

      {profile && !profile.phone ? (
        <Link href="/profile" className="card card--wait" style={{ marginTop: 16 }}>
          <b className="title">Add your phone number</b>
          <p>Nobody can invite you to a circle until you do.</p>
        </Link>
      ) : null}

      <div className="section-head">
        <b>Your circles</b>
        <span>{live === 1 ? '1 active' : `${live} active`}</span>
      </div>

      {views.length === 0 ? (
        <p className="pad mute small" style={{ marginBottom: 12 }}>
          You are not in a circle yet. Start one, or ask a friend to invite you with your phone
          number.
        </p>
      ) : (
        views.map((view) => <CircleCard key={view.circle.id} view={view} userId={user.id} />)
      )}

      <Link href="/circles/new" className="dashed">
        <span className="dot dot--ok" aria-hidden="true">
          <Icon name="plus" />
        </span>
        Start a new circle
      </Link>

      <div className="section-head">
        <b>Recent</b>
        {activity.length > 0 ? <Link href="/activity">See all</Link> : null}
      </div>
      {activity.length === 0 ? (
        <div className="card">
          <p className="mute" style={{ margin: 0 }}>
            Payments and confirmations will show up here.
          </p>
        </div>
      ) : (
        <div className="card card--list">
          {activity.slice(0, 3).map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

function Hero({
  focus,
  userId,
}: {
  focus: { view: CircleView; standing: MyStanding } | null;
  userId: string;
}) {
  if (!focus) {
    return (
      <>
        <div className="hero__label">Welcome to Circle</div>
        <div className="amount amount--md">Start your first circle</div>
        <p>Or ask a friend to invite you with your phone number.</p>
        <Link href="/circles/new" className="btn btn--lime">
          Start a circle
        </Link>
      </>
    );
  }

  const { view, standing: s } = focus;
  const { circle, round } = view;
  const href = `/circles/${circle.id}`;
  const pot = round ? potNaira(circle.amount_kobo_text, round.contribution_count) : null;
  const recipient = firstName(round?.recipient_name ?? null);

  switch (s.kind) {
    case 'owe':
      if (s.toSelf) {
        return (
          <>
            <div className="hero__label">
              {circle.name} · your turn to receive
            </div>
            <div className="amount">{pot}</div>
            <p>
              Everyone pays in, you too. Mark your own {nairaClean(s.contribution.amount_kobo_text)}{' '}
              share, then confirm the others as they arrive.
            </p>
            <Link href={href} className="btn btn--lime">
              Open {circle.name}
            </Link>
          </>
        );
      }
      return (
        <>
          <div className="hero__label">
            Pay {recipient} by {dayMonth(s.contribution.due_date)}
          </div>
          <div className="amount">{nairaClean(s.contribution.amount_kobo_text)}</div>
          <p>
            {circle.name} · Round {s.contribution.round_number}
          </p>
          <Link href={`${href}?pay=1`} className="btn btn--lime">
            Pay now
          </Link>
        </>
      );
    case 'invited':
      return (
        <>
          <div className="hero__label">You have been invited</div>
          <div className="amount amount--md">{circle.name}</div>
          <p>
            {nairaClean(circle.amount_kobo_text)} {cadence(circle.period_days)} · you would receive
            in round {s.membership.payout_position}
          </p>
          <Link href={href} className="btn btn--lime">
            See the invite
          </Link>
        </>
      );
    case 'receiving':
      return (
        <>
          <div className="hero__label">
            {circle.name} · Round {round?.round_number}
          </div>
          <div className="amount">{pot}</div>
          <p style={{ marginBottom: 6 }}>You receive on {round ? dayMonth(round.due_date) : '—'}</p>
          <Progress done={round?.confirmed_count ?? 0} of={round?.contribution_count ?? 0} />
          <Link href={href} className="btn btn--lime">
            Review payments
          </Link>
        </>
      );
    case 'disputed':
      return (
        <>
          <div className="hero__label">{circle.name}</div>
          <div className="amount amount--md">Your payment is disputed</div>
          <p>Talk to {recipient} and check your bank app for the transfer.</p>
          <Link href={href} className="btn btn--ghost">
            View circle
          </Link>
        </>
      );
    case 'waiting':
      return (
        <>
          <div className="hero__label">
            {circle.name} · Round {s.contribution.round_number}
          </div>
          <div className="amount amount--md">Waiting for {recipient}</div>
          <p>
            You marked {nairaClean(s.contribution.amount_kobo_text)} as paid. It turns green here
            once {recipient} confirms.
          </p>
          <Link href={href} className="btn btn--ghost">
            View circle
          </Link>
        </>
      );
    case 'setup': {
      const isOwner = circle.created_by === userId;
      return (
        <>
          <div className="hero__label">{circle.name} · not started</div>
          <div className="amount amount--md">
            {circle.joined_count} of {circle.member_target} joined
          </div>
          <p>
            {isOwner
              ? 'Invite the rest, then start the circle.'
              : 'It starts once everyone has joined.'}
          </p>
          <Link href={href} className={isOwner ? 'btn btn--lime' : 'btn btn--ghost'}>
            {isOwner ? 'Invite people' : 'View circle'}
          </Link>
        </>
      );
    }
    case 'paid':
      return (
        <>
          <div className="hero__label">You’re paid up</div>
          <div className="amount">{pot}</div>
          <p>
            {recipient} receives on {round ? dayMonth(round.due_date) : '—'}
          </p>
          <Link href={href} className="btn btn--ghost">
            View circle
          </Link>
        </>
      );
    default:
      return (
        <>
          <div className="hero__label">All quiet</div>
          <div className="amount amount--md">Nothing due</div>
          <p>None of your circles needs anything from you right now.</p>
          <Link href="/circles/new" className="btn btn--ghost">
            Start a circle
          </Link>
        </>
      );
  }
}

function Progress({ done, of }: { done: number; of: number }) {
  const percent = of === 0 ? 0 : Math.round((done / of) * 100);
  return (
    <>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={of}
        aria-valuenow={done}
        aria-label="Payments confirmed"
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <p>
        {done} of {of} confirmed
      </p>
    </>
  );
}

const CARD_CHIP: Record<MyStanding['kind'], { tone: Tone; label: string }> = {
  owe: { tone: 'bad', label: 'Not paid' },
  invited: { tone: 'neutral', label: 'Invited' },
  receiving: { tone: 'wait', label: 'Your turn' },
  disputed: { tone: 'bad', label: 'Disputed' },
  waiting: { tone: 'wait', label: 'Waiting' },
  setup: { tone: 'neutral', label: 'Not started' },
  paid: { tone: 'ok', label: 'Paid up' },
  completed: { tone: 'ok', label: 'Finished' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  observer: { tone: 'neutral', label: 'Active' },
};

function CircleCard({ view, userId }: { view: CircleView; userId: string }) {
  const { circle, members, round } = view;
  const s = standing(view, userId);
  const chip =
    s.kind === 'setup'
      ? { tone: 'neutral' as const, label: `${circle.joined_count} of ${circle.member_target} joined` }
      : s.kind === 'receiving' && round
        ? {
            tone: (round.confirmed_count === round.contribution_count ? 'ok' : 'wait') as Tone,
            label: `${round.confirmed_count} of ${round.contribution_count} paid`,
          }
        : CARD_CHIP[s.kind];

  const amount = `${nairaClean(circle.amount_kobo_text)} ${cadence(circle.period_days)}`;
  const sub = round
    ? `Round ${round.round_number} of ${circle.member_target} · ${amount}`
    : `${amount} · ${circle.status === 'completed' ? 'Finished' : circle.status === 'cancelled' ? 'Cancelled' : 'Not started'}`;

  const pot = potNaira(circle.amount_kobo_text, round?.contribution_count ?? circle.member_target);
  const foot = round
    ? round.recipient_user_id === userId
      ? `You receive ${pot}`
      : `${firstName(round.recipient_name)} receives ${pot}`
    : circle.status === 'draft' || circle.status === 'inviting'
      ? `Pot ${pot}`
      : '';

  return (
    <Link href={`/circles/${circle.id}`} className="card">
      <div className="circle-card__top">
        <b>{circle.name}</b>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>
      <div className="circle-card__sub">{sub}</div>
      <div className="circle-card__foot">
        <AvatarStack names={members.map((m) => m.display_name)} />
        <span>{foot}</span>
      </div>
    </Link>
  );
}
