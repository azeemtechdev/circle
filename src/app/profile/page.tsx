import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Logo } from '@/components/ui/logo';
import { ThemePicker } from '@/components/ui/theme-picker';
import { signOut } from '@/lib/auth/actions';
import { getPayoutAccount, listMyCircles } from '@/lib/circles/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

import { PayoutForm } from './payout-form';
import { ProfileForm } from './profile-form';

/**
 * Me: your details, where you get paid, and settings.
 *
 * The trust score (Phase 7) and Telegram reminders (Phase 4) are not built.
 * Their places are kept so the layout does not shift when they arrive, but
 * they show no numbers — a made-up score on a money app is worse than none.
 */
export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, account, circles] = await Promise.all([
    supabase.from('profiles').select('display_name, phone').eq('id', user.id).maybeSingle(),
    getPayoutAccount(user.id),
    listMyCircles(),
  ]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  const name = profile?.display_name ?? null;
  const inCircles = circles.filter((c) => c.status !== 'cancelled').length;

  return (
    <>
      <div className="hero hero--tall">
        <div className="hero__bar">
          <Logo size={26} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={name} large />
          <div style={{ minWidth: 0 }}>
            <h2>{name ?? 'Your account'}</h2>
            <div style={{ opacity: 0.78, fontSize: 14.5 }}>
              {profile?.phone ?? 'No phone number yet'}
            </div>
          </div>
        </div>
      </div>

      <div className="card card--lift" style={{ padding: 0, background: 'transparent' }}>
        <div className="score">
          <div className="score__ring" aria-hidden="true">
            –
          </div>
          <div>
            <b style={{ fontSize: 18 }}>Trust score</b>
            <p style={{ margin: '3px 0 0', fontSize: 14, opacity: 0.8 }}>
              Not available yet. It will be worked out from how reliably you pay, and explained in
              plain words.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="stats">
          <div>
            <b>{inCircles}</b>
            <small>{inCircles === 1 ? 'Circle' : 'Circles'}</small>
          </div>
          <div>
            <b aria-label="Not available yet">–</b>
            <small>On time</small>
          </div>
          <div>
            <b aria-label="Not available yet">–</b>
            <small>Late</small>
          </div>
        </div>
      </div>

      <div className="card card--list">
        <details className="menu-item" open={!account}>
          <summary>
            <span>
              Account for receiving
              <small>
                {account
                  ? `${account.bank_name} ···· ${account.account_number.slice(-4)}`
                  : 'Not added — payers will have to ask you'}
              </small>
            </span>
            <Icon name="chevron" size={18} />
          </summary>
          <PayoutForm
            bankName={account?.bank_name ?? ''}
            accountNumber={account?.account_number ?? ''}
            accountName={account?.account_name ?? name ?? ''}
          />
        </details>

        <details className="menu-item" open={!profile?.phone}>
          <summary>
            <span>
              Your details
              <small>{profile?.phone ? 'Name and phone number' : 'Add your phone so people can invite you'}</small>
            </span>
            <Icon name="chevron" size={18} />
          </summary>
          <ProfileForm displayName={name ?? ''} phone={profile?.phone ?? ''} />
        </details>

        <div className="menu-item">
          <span>
            Reminders on Telegram
            <small>Coming in a later update</small>
          </span>
          <span className="chip">Not available yet</span>
        </div>

        <div className="menu-item" style={{ display: 'block' }}>
          <span>Appearance</span>
          <ThemePicker initial={theme} />
        </div>

        <form action={signOut} className="menu-item" style={{ padding: 0 }}>
          <button type="submit" className="menu-item" style={{ color: 'var(--bad)', borderTop: 0 }}>
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </>
  );
}
