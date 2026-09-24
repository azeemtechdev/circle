'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { callTransition, newIdempotencyKey, TransitionError } from '@/lib/http/client';
import { koboFromNairaInput, koboToText } from '@/lib/money';

export function CreateCircleForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const keyRef = useRef<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const periodDays = Number(form.get('periodDays'));
    const memberTarget = Number(form.get('memberTarget'));

    let amountKobo: string;
    try {
      // Naira in, exact kobo out, as a string — never a JSON number.
      amountKobo = koboToText(koboFromNairaInput(String(form.get('amount') ?? '')));
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }

    // One key for this circle, reused if the request has to be retried.
    keyRef.current ??= newIdempotencyKey();
    setPending(true);
    setError(null);

    try {
      const id = await callTransition(
        '/api/circles/create-circle',
        { name, amountKobo, periodDays, memberTarget },
        keyRef.current,
      );
      keyRef.current = null;
      router.push(`/circles/${id}`);
    } catch (cause) {
      setError(cause instanceof TransitionError ? cause.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Circle name</span>
        <input
          name="name"
          required
          placeholder="Family ajo"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Each person pays</span>
        <input
          name="amount"
          required
          inputMode="decimal"
          placeholder="5000"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">In naira, each round. For example 5000.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">How often</span>
        <select
          name="periodDays"
          defaultValue="30"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        >
          <option value="7">Every week</option>
          <option value="14">Every two weeks</option>
          <option value="30">Every month</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">How many people</span>
        <input
          name="memberTarget"
          type="number"
          min={2}
          max={50}
          defaultValue={5}
          required
          inputMode="numeric"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">
          Including you. Everyone gets the pot once, so this is also how many rounds there will be.
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create circle'}
      </button>
    </form>
  );
}
