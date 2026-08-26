'use client';

import { useCallback, useEffect, useState } from 'react';
import { readSupabaseEnv } from '@/lib/env';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatKoboAsNaira, koboFromText } from '@/lib/money';

export function CircleDashboard({ circles, sessionUser, onRefresh }: { circles: Array<any>; sessionUser: { id?: string | null } | null; onRefresh?: () => void }) {
  const env = readSupabaseEnv();
  const supabase = env ? createBrowserSupabaseClient(env) : null;

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { round: any | null; contributions: any[]; memberships: Record<string, any> }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadDetails = useCallback(async (circleId: string) => {
    if (!supabase) return;
    try {
      // memberships map
      const { data: members } = await supabase.from('memberships').select('id,user_id,payout_position').eq('circle_id', circleId).neq('status', 'left');

      const membershipMap: Record<string, any> = {};
      (members ?? []).forEach((m: any) => { membershipMap[m.id] = m; });

      const { data: rounds } = await supabase.from('rounds').select('*').eq('circle_id', circleId).order('round_number', { ascending: false }).limit(1);
      const round = (rounds && rounds[0]) ?? null;

      let contributions: any[] = [];
      if (round) {
        const { data: contribs } = await supabase.from('contributions').select('*').eq('round_id', round.id).order('created_at', { ascending: true });
        contributions = contribs ?? [];
      }

      setDetails((d) => ({ ...d, [circleId]: { round, contributions, memberships: membershipMap } }));
    } catch (e) {
      // ignore — dashboard is best-effort
    }
  }, [supabase]);

  useEffect(() => {
    if (!openFor) return;
    void loadDetails(openFor);
  }, [openFor, loadDetails]);

  const claim = async (contributionId: string) => {
    setBusyId(contributionId);
    try {
      const res = await fetch('/api/circles/claim-contribution', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ id: contributionId }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Claim failed');
      onRefresh?.();
      setDetails({});
    } catch (e) {
      // noop
    } finally { setBusyId(null); }
  };

  const confirm = async (contributionId: string) => {
    setBusyId(contributionId);
    try {
      const res = await fetch('/api/circles/confirm-contribution', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ id: contributionId }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Confirm failed');
      onRefresh?.();
      setDetails({});
    } catch (e) {
      // noop
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold">Your circles</h3>
      <div className="grid gap-3">
        {circles.map((c) => (
          <div key={c.id} className="rounded-2xl border p-4 bg-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">{c.name}</p>
                <p className="text-sm text-black/60">{c.member_target ?? '–'} members • {c.status}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{c.amount_kobo ? formatKoboAsNaira(BigInt(c.amount_kobo)) : '–'}</p>
                <button onClick={() => setOpenFor(openFor === c.id ? null : c.id)} className="mt-2 rounded-full border px-3 py-2">{openFor === c.id ? 'Close' : 'Open'}</button>
              </div>
            </div>

            {openFor === c.id ? (
              <div className="mt-4 space-y-3">
                {details[c.id]?.round ? (
                  <div>
                    <p className="text-sm text-black/60">Round {details[c.id]?.round?.round_number ?? '–'} — status {details[c.id]?.round?.status ?? '–'}</p>
                    <ul className="mt-3 space-y-2">
                      {(details[c.id]?.contributions ?? []).map((contrib: any) => {
                        const payer = details[c.id]?.memberships?.[contrib.payer_membership_id];
                        const recipientId = details[c.id]?.round?.recipient_membership_id;
                        const isPayer = payer?.user_id === sessionUser?.id;
                        const isRecipient = recipientId && details[c.id]?.memberships?.[recipientId]?.user_id === sessionUser?.id;

                        return (
                          <li key={contrib.id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <p className="font-medium">{payer?.user_id === sessionUser?.id ? 'You' : payer?.user_id ?? 'Member'}</p>
                              <p className="text-sm text-black/60">{contrib.status} • {contrib.amount_kobo ? formatKoboAsNaira(BigInt(contrib.amount_kobo)) : '–'}</p>
                            </div>
                            <div className="flex gap-2">
                              {isPayer ? (
                                <button disabled={busyId === contrib.id} onClick={() => claim(contrib.id)} className="rounded-xl bg-emerald-600 text-white px-4 py-2">{busyId === contrib.id ? '…' : "I've paid"}</button>
                              ) : null}
                              {isRecipient ? (
                                <button disabled={busyId === contrib.id} onClick={() => confirm(contrib.id)} className="rounded-xl bg-blue-600 text-white px-4 py-2">{busyId === contrib.id ? '…' : 'Received'}</button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-black/60">No open round data yet.</p>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
