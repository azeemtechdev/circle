'use client';

import { useActionState } from 'react';

import { signUp } from '@/lib/auth/actions';
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, EMPTY_AUTH_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Your name</span>
        <input
          name="displayName"
          type="text"
          autoComplete="name"
          required
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">This is what the others in your circle will see.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Phone number</span>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="0803 123 4567"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        {/* Not required by the form, but without it nobody can invite you:
            invites are looked up by phone. Saying so is better than a silent
            dead end later. */}
        <span className="text-xs opacity-70">
          How your friends find you to invite you. You can add it later.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">At least 8 characters.</span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-sm text-green-800 dark:text-green-400">
          {state.notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Creating your account…' : 'Create account'}
      </button>
    </form>
  );
}
