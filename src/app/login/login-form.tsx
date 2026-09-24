'use client';

import { useActionState } from 'react';

import { signIn } from '@/lib/auth/actions';
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, EMPTY_AUTH_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          // inputMode and autoComplete matter more than they look: this is used
          // on a cheap Android keyboard, one-handed, often on mobile data.
          inputMode="email"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
