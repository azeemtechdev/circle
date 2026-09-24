'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

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
 */
export function ActionButton({
  path,
  body,
  label,
  pendingLabel,
  confirm,
  variant = 'primary',
}: {
  path: string;
  body: Record<string, unknown>;
  label: string;
  pendingLabel?: string;
  /** Shown in a confirm() first. Use for anything a person cannot undo. */
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const router = useRouter();
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

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`rounded-lg px-4 py-3 text-base font-medium disabled:opacity-60 ${STYLES[variant]}`}
      >
        {pending ? (pendingLabel ?? 'Working…') : label}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const STYLES: Record<string, string> = {
  primary: 'bg-foreground text-background',
  secondary: 'border border-black/20 dark:border-white/25',
  danger: 'border border-red-600/50 text-red-700 dark:text-red-400',
};
