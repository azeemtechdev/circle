'use client';

import { useActionState } from 'react';

import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';
import { updateProfile } from '@/lib/auth/profile-actions';

export function ProfileForm({
  displayName,
  phone,
}: {
  displayName: string;
  phone: string;
}) {
  const [state, action, pending] = useActionState(updateProfile, EMPTY_AUTH_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Your name</span>
        <input
          name="displayName"
          defaultValue={displayName}
          required
          autoComplete="name"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">What the others in your circle see.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Phone number</span>
        <input
          name="phone"
          defaultValue={phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0803 123 4567"
          className="rounded-lg border border-black/20 px-3 py-3 text-base dark:border-white/25"
        />
        <span className="text-xs opacity-70">
          How friends find you to invite you. 0803… and +234803… are the same number.
        </span>
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
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
