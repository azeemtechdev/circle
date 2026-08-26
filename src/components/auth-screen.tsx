'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readSupabaseEnv } from '@/lib/env';
import { formatKoboAsNaira, koboFromText } from '@/lib/money';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { CreateCircle } from '@/components/CreateCircle';
import { CircleDashboard } from '@/components/CircleDashboard';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [circleName, setCircleName] = useState('');
  const [amountNaira, setAmountNaira] = useState('1000');
  const [periodDays, setPeriodDays] = useState('30');
  const [memberTarget, setMemberTarget] = useState('3');
  const [inviteCircleId, setInviteCircleId] = useState('');
  const [inviteUserId, setInviteUserId] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteMode, setInviteMode] = useState<'link' | 'userId' | 'phone'>('link');
  const [invitePosition, setInvitePosition] = useState('1');
  const [actionType, setActionType] = useState<'accept-invite' | 'activate-circle' | 'claim-contribution' | 'confirm-contribution' | 'close-round' | 'cancel-circle'>('accept-invite');
  const [actionId, setActionId] = useState('');
  const [actionStartDate, setActionStartDate] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [message, setMessage] = useState('');
  const [circleMessage, setCircleMessage] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [sessionUser, setSessionUser] = useState<{ id?: string; email?: string | null } | null>(null);
  const [circles, setCircles] = useState<Array<{ id: string; name: string; status: string; amount_kobo: string | null; member_target: number | null; period_days: number | null }>>([]);
  const [isLoadingCircles, setIsLoadingCircles] = useState(false);
  const [circleLoadError, setCircleLoadError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingCircle, setIsCreatingCircle] = useState(false);
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const [isRunningAction, setIsRunningAction] = useState(false);

  const supabase = useMemo(() => {
    const env = readSupabaseEnv();
    return env ? createBrowserSupabaseClient(env) : null;
  }, []);

  const loadMyCircles = useCallback(async () => {
    if (!supabase || !sessionUser?.id) {
      setCircles([]);
      setCircleLoadError('');
      return;
    }

    setIsLoadingCircles(true);
    setCircleLoadError('');

    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from('memberships')
        .select('circle_id')
        .eq('user_id', sessionUser.id)
        .neq('status', 'left');

      if (membershipsError) {
        throw membershipsError;
      }

      const circleIds = [...new Set((memberships ?? []).map((membership) => membership.circle_id).filter(Boolean))];
      if (circleIds.length === 0) {
        setCircles([]);
        return;
      }

      const { data: nextCircles, error: circlesError } = await supabase
        .from('circles')
        .select('id, name, status, amount_kobo, member_target, period_days, created_by')
        .in('id', circleIds);

      if (circlesError) {
        throw circlesError;
      }

      setCircles((nextCircles ?? []) as Array<{ id: string; name: string; status: string; amount_kobo: string | null; member_target: number | null; period_days: number | null }>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load circles.';
      setCircleLoadError(message);
      setCircles([]);
    } finally {
      setIsLoadingCircles(false);
    }
  }, [sessionUser?.id, supabase]);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSessionUser(data.session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    void loadMyCircles();
  }, [loadMyCircles]);

  const ensureProfileRow = useCallback(async (userId: string | undefined, fallbackName?: string) => {
    if (!supabase || !userId) return;

    const safeDisplayName = (fallbackName ?? '').trim() || 'Circle member';
    const { error } = await supabase.from('profiles').upsert(
      {
        id: userId,
        display_name: safeDisplayName,
        phone: null,
        telegram_chat_id: null,
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw error;
    }
  }, [supabase]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setMessage('Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: displayName || email.split('@')[0] },
            emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
          },
        });

        if (error) throw error;
        await ensureProfileRow(data.user?.id, displayName || email.split('@')[0]);
        setMessage('Check your email for the confirmation link.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await ensureProfileRow(data.user?.id, displayName || email.split('@')[0]);
        setMessage('Signed in successfully.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      setMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
    setCircles([]);
    setCircleLoadError('');
  };

  const handleCreateCircle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionUser) {
      setCircleMessage('Sign in before creating a circle.');
      return;
    }

    setIsCreatingCircle(true);
    setCircleMessage('');

    try {
      const amountValue = Number.parseInt(amountNaira, 10);
      const periodValue = Number.parseInt(periodDays, 10);
      const membersValue = Number.parseInt(memberTarget, 10);

      if (!circleName.trim()) throw new Error('Circle name is required.');
      if (!Number.isFinite(amountValue) || amountValue <= 0) throw new Error('Contribution amount must be greater than zero.');
      if (!Number.isFinite(periodValue) || periodValue <= 0) throw new Error('Period must be a positive number of days.');
      if (!Number.isFinite(membersValue) || membersValue < 2 || membersValue > 50) throw new Error('A circle must have between 2 and 50 members.');

      const response = await fetch('/api/circles/create-circle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: circleName.trim(),
          amountKobo: Math.round(amountValue * 100),
          periodDays: periodValue,
          memberTarget: membersValue,
        }),
      });

      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Unable to create the circle.');
      }

      setCircleName('');
      setAmountNaira('1000');
      setPeriodDays('30');
      setMemberTarget('3');
      setInviteCircleId(body.id ?? '');
      setCircleMessage(`Circle created successfully. ID: ${body.id ?? 'unknown'}`);
      void loadMyCircles();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Unable to create the circle.';
      setCircleMessage(nextMessage);
    } finally {
      setIsCreatingCircle(false);
    }
  };

  const inviteShareLink = inviteCircleId.trim()
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://example.com'}/?circle=${encodeURIComponent(inviteCircleId.trim())}`
    : 'Create a circle to generate a shareable invite link.';

  const handleInviteMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionUser) {
      setInviteMessage('Sign in before inviting a member.');
      return;
    }

    setIsInvitingMember(true);
    setInviteMessage('');

    try {
      const position = Number.parseInt(invitePosition, 10);
      if (!inviteCircleId.trim()) throw new Error('Circle ID is required.');
      if (inviteMode === 'link' && !inviteCircleId.trim()) throw new Error('Circle ID is required to create a link invitation.');
      if (inviteMode === 'userId' && !inviteUserId.trim()) throw new Error('User ID is required.');
      if (inviteMode === 'phone' && !invitePhone.trim()) throw new Error('Phone number is required.');
      if (!Number.isFinite(position) || position < 1) throw new Error('Payout position must be at least 1.');

      const payload: { circleId: string; userId?: string; phone?: string; payoutPosition: number } = {
        circleId: inviteCircleId.trim(),
        payoutPosition: position,
      };

      if (inviteMode === 'userId') {
        payload.userId = inviteUserId.trim();
      }
      if (inviteMode === 'phone') {
        payload.phone = invitePhone.trim();
      }

      const response = await fetch('/api/circles/invite-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Unable to invite the member.');
      }

      setInviteUserId('');
      setInvitePhone('');
      setInvitePosition('1');
      setInviteMessage(`Invite created successfully. Membership ID: ${body.id ?? 'unknown'}`);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Unable to invite the member.';
      setInviteMessage(nextMessage);
    } finally {
      setIsInvitingMember(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteCircleId.trim()) {
      setInviteMessage('Create a circle first to generate a share link.');
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteShareLink);
        setInviteMessage('Invite link copied to your clipboard.');
        return;
      }

      setInviteMessage('Copy is unavailable here, but your invite link is ready: ' + inviteShareLink);
    } catch {
      setInviteMessage('Could not copy the link automatically. Use the share link shown below.');
    }
  };

  const handleCircleAction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionUser) {
      setActionMessage('Sign in before running a circle action.');
      return;
    }

    setIsRunningAction(true);
    setActionMessage('');

    try {
      if (!actionId.trim()) throw new Error('An entity ID is required.');

      const payload: Record<string, string | null> = { id: actionId.trim() };
      if (actionType === 'activate-circle' && actionStartDate.trim()) {
        payload.startDate = actionStartDate.trim();
      }
      if (actionType === 'cancel-circle' && actionReason.trim()) {
        payload.reason = actionReason.trim();
      }

      const response = await fetch(`/api/circles/${actionType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Unable to complete the circle action.');
      }

      setActionId('');
      setActionStartDate('');
      setActionReason('');
      setActionMessage(`Action succeeded. Result ID: ${body.id ?? 'unknown'}`);
      void loadMyCircles();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Unable to complete the circle action.';
      setActionMessage(nextMessage);
    } finally {
      setIsRunningAction(false);
    }
  };

  return (
    <section className="w-full max-w-md rounded-2xl border border-black/10 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/40">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-black/50 dark:text-white/60">Access</p>
          <h2 className="mt-2 text-2xl font-semibold text-black dark:text-white">Circle auth</h2>
        </div>
        {sessionUser ? (
          <button type="button" onClick={handleSignOut} className="rounded-full border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
            Sign out
          </button>
        ) : null}
      </div>

      {sessionUser ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-700/80 dark:text-emerald-300/80">Member</p>
                <p className="mt-1 text-base font-semibold">{sessionUser.email ?? 'member'}</p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-black/50 dark:text-white/60">Overview</p>
                <h3 className="mt-1 text-xl font-semibold text-black dark:text-white">Circle dashboard</h3>
              </div>
              <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-black/70 dark:border-white/10 dark:bg-black dark:text-white/80">
                {circles.length > 0 ? `${circles.length} circles` : 'Ready to run'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {[
                { label: 'Circles', value: String(circles.length) },
                { label: 'Active', value: String(circles.filter((circle) => circle.status === 'active').length) },
                { label: 'Amount', value: circles[0] && circles[0].amount_kobo ? formatKoboAsNaira(koboFromText(circles[0].amount_kobo)) : '—' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-black/10 bg-white p-3 text-left dark:border-white/10 dark:bg-black">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-black/45 dark:text-white/55">{card.label}</p>
                  <p className="mt-2 text-xl font-semibold text-black dark:text-white">{card.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-black dark:text-white">My circles</h3>
            </div>

            {isLoadingCircles ? (
              <p className="text-sm text-black/60 dark:text-white/70">Loading circles…</p>
            ) : circleLoadError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-950/20 dark:text-red-200">{circleLoadError}</p>
            ) : circles.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/15 bg-white/80 p-3 text-sm text-black/70 dark:border-white/15 dark:bg-black/20 dark:text-white/80">
                No circles yet. Create one to start your next round.
              </p>
            ) : (
              <ul className="space-y-2 text-sm text-black/70 dark:text-white/80">
                {circles.map((circle) => (
                  <li key={circle.id} className="rounded-xl border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-black">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-black dark:text-white">{circle.name}</p>
                        <p className="text-xs uppercase tracking-[0.12em] text-black/45 dark:text-white/55">{circle.status}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-black dark:text-white">{circle.amount_kobo ? formatKoboAsNaira(koboFromText(circle.amount_kobo)) : '—'}</p>
                        <p className="text-xs text-black/50 dark:text-white/60">{circle.member_target ?? 0} members</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-6">
            <CreateCircle onCreated={(id) => { setInviteCircleId(id); void loadMyCircles(); }} />
            <CircleDashboard circles={circles} sessionUser={sessionUser} onRefresh={() => void loadMyCircles()} />
          </div>

          <form className="space-y-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]" onSubmit={handleInviteMember}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-black dark:text-white">Invite member</h3>
            </div>

            <label className="block text-left text-sm">
              <span className="mb-1 block text-black/70 dark:text-white/70">Circle ID</span>
              <input
                value={inviteCircleId}
                onChange={(event) => setInviteCircleId(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                placeholder="circle UUID"
              />
            </label>

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-black">
              {[
                { key: 'link', label: 'Link' },
                { key: 'userId', label: 'User ID' },
                { key: 'phone', label: 'Phone' },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setInviteMode(option.key as typeof inviteMode)}
                  className={`rounded-lg px-2 py-2 text-xs font-medium transition ${inviteMode === option.key ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {inviteMode === 'userId' ? (
              <label className="block text-left text-sm">
                <span className="mb-1 block text-black/70 dark:text-white/70">User ID</span>
                <input
                  value={inviteUserId}
                  onChange={(event) => setInviteUserId(event.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                  placeholder="member UUID"
                />
              </label>
            ) : null}

            {inviteMode === 'phone' ? (
              <label className="block text-left text-sm">
                <span className="mb-1 block text-black/70 dark:text-white/70">Phone number</span>
                <input
                  value={invitePhone}
                  onChange={(event) => setInvitePhone(event.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                  placeholder="+234 800 000 0000"
                />
              </label>
            ) : null}

            {inviteMode === 'link' ? (
              <div className="rounded-xl border border-dashed border-black/15 bg-white/80 p-3 dark:border-white/15 dark:bg-black/20">
                <p className="text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/55">Share link</p>
                <p className="mt-2 break-all text-sm text-black/75 dark:text-white/80">{inviteShareLink}</p>
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="mt-3 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/5 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5"
                >
                  Copy invite link
                </button>
              </div>
            ) : null}

            <label className="block text-left text-sm">
              <span className="mb-1 block text-black/70 dark:text-white/70">Payout position</span>
              <input
                type="number"
                min="1"
                step="1"
                value={invitePosition}
                onChange={(event) => setInvitePosition(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
              />
            </label>

            <button
              type="submit"
              disabled={isInvitingMember}
              className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-black/90 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {isInvitingMember ? 'Inviting…' : 'Invite member'}
            </button>

            {inviteMessage ? (
              <p className="rounded-xl border border-black/10 bg-white/80 p-3 text-sm text-black/70 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                {inviteMessage}
              </p>
            ) : null}
          </form>

          <form className="space-y-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]" onSubmit={handleCircleAction}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-black dark:text-white">Circle actions</h3>
            </div>

            <label className="block text-left text-sm">
              <span className="mb-1 block text-black/70 dark:text-white/70">Action</span>
              <select
                value={actionType}
                onChange={(event) => setActionType(event.target.value as typeof actionType)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none dark:border-white/10 dark:bg-black dark:text-white"
              >
                <option value="accept-invite">Accept invite</option>
                <option value="activate-circle">Activate circle</option>
                <option value="claim-contribution">Claim contribution</option>
                <option value="confirm-contribution">Confirm contribution</option>
                <option value="close-round">Close round</option>
                <option value="cancel-circle">Cancel circle</option>
              </select>
            </label>

            <label className="block text-left text-sm">
              <span className="mb-1 block text-black/70 dark:text-white/70">ID</span>
              <input
                value={actionId}
                onChange={(event) => setActionId(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                placeholder="membership / round / contribution / circle UUID"
              />
            </label>

            {actionType === 'activate-circle' ? (
              <label className="block text-left text-sm">
                <span className="mb-1 block text-black/70 dark:text-white/70">Start date (YYYY-MM-DD)</span>
                <input
                  value={actionStartDate}
                  onChange={(event) => setActionStartDate(event.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                  placeholder="2026-01-01"
                />
              </label>
            ) : null}

            {actionType === 'cancel-circle' ? (
              <label className="block text-left text-sm">
                <span className="mb-1 block text-black/70 dark:text-white/70">Reason</span>
                <input
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                  placeholder="Changed plans"
                />
              </label>
            ) : null}

            <button
              type="submit"
              disabled={isRunningAction}
              className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-black/90 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {isRunningAction ? 'Running…' : `Run ${actionType.replace('-', ' ')}`}
            </button>

            {actionMessage ? (
              <p className="rounded-xl border border-black/10 bg-white/80 p-3 text-sm text-black/70 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                {actionMessage}
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-2 rounded-full border border-black/10 p-1 dark:border-white/10">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-full px-3 py-2 text-sm ${mode === 'login' ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black/70 dark:text-white/70'}`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-full px-3 py-2 text-sm ${mode === 'signup' ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black/70 dark:text-white/70'}`}
            >
              Sign up
            </button>
          </div>

          {mode === 'signup' ? (
            <label className="block text-left text-sm">
              <span className="mb-1 block text-black/70 dark:text-white/70">Display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none ring-0 placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
                placeholder="Aisha Bello"
              />
            </label>
          ) : null}

          <label className="block text-left text-sm">
            <span className="mb-1 block text-black/70 dark:text-white/70">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none ring-0 placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
              placeholder="you@example.com"
            />
          </label>

          <label className="block text-left text-sm">
            <span className="mb-1 block text-black/70 dark:text-white/70">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-black outline-none ring-0 placeholder:text-black/40 dark:border-white/10 dark:bg-black dark:text-white dark:placeholder:text-white/40"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-black/90 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            {isSubmitting ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          {message ? (
            <p className="rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm text-black/70 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80">
              {message}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
