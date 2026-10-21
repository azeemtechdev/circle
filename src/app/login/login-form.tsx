'use client';

import { useActionState, useState } from 'react';

import { signIn } from '@/lib/auth/actions';
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';

/**
 * Email and password — the only sign-in Circle's Supabase Auth setup has.
 *
 * No "forgot password" link: there is no reset flow yet, and a link that leads
 * nowhere is worse than none.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, EMPTY_AUTH_STATE);
  // Kept across a failed attempt; retyping an email on a phone keyboard
  // because of a password typo is the kind of friction people quit over.
  const [email, setEmail] = useState('');

  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />

      <label className="field">
        <span>Email</span>
        <input
          className="input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>

      {state.error ? (
        <p role="alert" className="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending} style={{ marginTop: 22 }}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
