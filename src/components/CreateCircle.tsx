'use client';

import { useState } from 'react';
import { readSupabaseEnv } from '@/lib/env';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function CreateCircle({ onCreated }: { onCreated?: (id: string) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('1000');
  const [members, setMembers] = useState('3');
  const [period, setPeriod] = useState('30');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const env = readSupabaseEnv();
  const supabase = env ? createBrowserSupabaseClient(env) : null;

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return setMessage('Supabase not configured.');
    setBusy(true);
    setMessage('');

    try {
      if (!name.trim()) throw new Error('Give the circle a simple name.');
      const amt = Number.parseInt(amount, 10);
      const mem = Number.parseInt(members, 10);
      const per = Number.parseInt(period, 10);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Choose a positive amount.');
      if (!Number.isFinite(mem) || mem < 2) throw new Error('At least two members.');
      if (!Number.isFinite(per) || per < 1) throw new Error('Period must be at least 1 day.');

      const res = await fetch('/api/circles/create-circle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: name.trim(),
          amountKobo: Math.round(amt * 100),
          periodDays: per,
          memberTarget: mem,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Unable to create circle');
      setName('');
      setAmount('1000');
      setMembers('3');
      setPeriod('30');
      setMessage('Circle created — opening dashboard.');
      onCreated?.(body.id ?? '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <h3 className="text-2xl font-semibold">Create a circle</h3>

      <label className="block text-left">
        <span className="block text-sm text-black/70">Circle name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. School fees" className="w-full rounded-xl border px-3 py-3 text-lg" />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="block text-left">
          <span className="block text-sm text-black/70">Amount (₦)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} className="w-full rounded-xl border px-3 py-3 text-lg" />
        </label>

        <label className="block text-left">
          <span className="block text-sm text-black/70">Members</span>
          <input value={members} onChange={(e) => setMembers(e.target.value)} type="number" min={2} className="w-full rounded-xl border px-3 py-3 text-lg" />
        </label>

        <label className="block text-left">
          <span className="block text-sm text-black/70">Period (days)</span>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} type="number" min={1} className="w-full rounded-xl border px-3 py-3 text-lg" />
        </label>
      </div>

      <button type="submit" disabled={busy} className="w-full rounded-xl bg-black text-white py-4 text-lg font-medium">
        {busy ? 'Creating…' : 'Create circle'}
      </button>

      {message ? <p className="text-sm text-black/70">{message}</p> : null}
    </form>
  );
}
