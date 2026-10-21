'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
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
  const toast = useToast();
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
      toast(`${found.display_name} is invited.`);
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
    <div>
      <form onSubmit={lookUp}>
        <label className="field">
          <span style={{ marginTop: 0 }}>Invite by phone number</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            placeholder="0803 123 4567"
          />
          <small>They will receive in round {nextPosition}.</small>
        </label>
        <button
          type="submit"
          className="btn btn--outline"
          disabled={pending}
          aria-busy={pending && !found}
          style={{ marginTop: 12 }}
        >
          {pending && !found ? 'Looking…' : 'Find this person'}
        </button>
      </form>

      {found ? (
        <div className="card card--flush card--ok" style={{ marginTop: 12 }}>
          <b className="title">Invite {found.display_name}?</b>
          <p>Check this is the person you mean. They will receive in round {nextPosition}.</p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--small"
              onClick={invite}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? 'Inviting…' : 'Yes, invite'}
            </button>
            <button
              type="button"
              className="btn btn--outline btn--small"
              onClick={() => setFound(null)}
              disabled={pending}
            >
              No
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
