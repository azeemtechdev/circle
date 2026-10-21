'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { callTransition, newIdempotencyKey, TransitionError } from '@/lib/http/client';

/**
 * A button that performs one transition.
 *
 * The idempotency key is created once, on the first press, and kept in a ref
 * for the life of this button. A double tap, or a retry after the connection
 * dropped, sends the same key — so the second request is a replay and changes
 * nothing. Generating the key inside the click handler instead would mean every
 * tap was a new request, which is exactly the bug idempotency keys exist to
 * prevent.
 *
 * The key is only cleared after a success, so the next deliberate action gets a
 * fresh one.
 *
 * While a request is in flight the button is disabled and says what it is
 * doing; a failure stays on screen under the button until the next press.
 */
export function ActionButton({
  path,
  body,
  label,
  pendingLabel,
  confirm,
  variant = 'primary',
  small = false,
  successMessage,
  onDone,
}: {
  path: string;
  body: Record<string, unknown>;
  label: string;
  pendingLabel?: string;
  /** Shown in a confirm() first. Use for anything a person cannot undo. */
  confirm?: string;
  variant?: 'primary' | 'lime' | 'ghost' | 'outline' | 'danger';
  small?: boolean;
  /** A short toast once the server has accepted it. */
  successMessage?: string;
  /** Runs after success, e.g. to close the sheet the button sits in. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  async function run() {
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;

    keyRef.current ??= newIdempotencyKey();
    setPending(true);
    setError(null);

    try {
      await callTransition(path, body, keyRef.current);
      keyRef.current = null;
      if (successMessage) toast(successMessage);
      onDone?.();
      // Re-renders the server components, so the new state comes from the
      // database rather than from optimistic local state that could disagree
      // with it.
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof TransitionError ? cause.message : 'Something went wrong. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  const className = [
    'btn',
    variant === 'primary' ? '' : `btn--${variant}`,
    small ? 'btn--small' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending}
        className={className}
      >
        {pending ? (pendingLabel ?? 'Working…') : label}
      </button>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
