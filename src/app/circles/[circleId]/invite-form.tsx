'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { callTransition, newIdempotencyKey, TransitionError } from '@/lib/http/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

interface Found {
  id: string;
  display_name: string;
}

/**
 * Invite by phone, in two steps: look the person up, then confirm their name
 * before inviting them.
 *
 * The confirmation step is not ceremony. A mistyped digit invites a stranger
 * into a circle that is about to move real money, and once activated the
 * rotation is locked. Showing the name is the only chance to catch it.
 *
 * Lookup goes through find_profile_by_phone (migration 0005), which returns
 * only an id and a name — a signed-in caller cannot use it to read a stranger's
 * profile or enumerate the user table.
 */
export function InviteForm({
  circleId,
  nextPosition,
  currentUserId,
  memberUserIds,
}: {
  circleId: string;
  nextPosition: number;
  currentUserId: string;
  /** Everyone already in the circle, so a pointless invite is caught here. */
  memberUserIds: string[];
}) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const keyRef = useRef<string | null>(null);

  async function lookUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setFound(null);

    // try/finally, not a bare await: anything that throws before setPending
    // ran again would leave the button reading "Looking…" forever, with no
    // error shown and nothing to retry. A stuck spinner is the worst failure
    // mode here, because it looks like the app is still working.
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc('find_profile_by_phone', {
        p_phone: phone,
      });

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      const rows = (data ?? []) as Found[];
      if (rows.length === 0) {
        setError(
          'Nobody with that number has a Circle account yet. Ask them to sign up first, then invite them.',
        );
        return;
      }

      const person = rows[0]!;

      // Caught before the button appears rather than after the database says
      // no. The owner joins their own circle when they create it, so looking
      // up your own number is a natural thing to try — and the refusal for it
      // is a unique-constraint violation, which is not an explanation.
      if (person.id === currentUserId) {
        setError('That is your own number. You are already in this circle.');
        return;
      }
      if (memberUserIds.includes(person.id)) {
        setError(`${person.display_name} is already in this circle.`);
        return;
      }

      setFound(person);
    } catch (cause) {
      setError((cause as Error).message || 'Could not look that number up. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function invite() {
    if (!found || pending) return;

    keyRef.current ??= newIdempotencyKey();
    setPending(true);
    setError(null);

    try {
      await callTransition(
        '/api/circles/invite-member',
        { circleId, userId: found.id, payoutPosition: nextPosition },
        keyRef.current,
      );
      keyRef.current = null;
      setFound(null);
      setPhone('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof TransitionError ? cause.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={lookUp} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Invite by phone number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            required
            placeholder="0803 123 4567"
            className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-black/20 px-4 py-3 text-base font-medium disabled:opacity-60 dark:border-white/25"
        >
          {pending ? 'Looking…' : 'Find this person'}
        </button>
      </form>

      {found ? (
        <div className="rounded-lg border border-black/15 p-3 dark:border-white/20">
          <p className="text-sm">
            Invite <span className="font-medium">{found.display_name}</span> as person{' '}
            {nextPosition} in the rotation?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={invite}
              disabled={pending}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            >
              {pending ? 'Inviting…' : 'Yes, invite'}
            </button>
            <button
              type="button"
              onClick={() => setFound(null)}
              className="rounded-lg border border-black/20 px-4 py-2 text-sm dark:border-white/25"
            >
              No
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
