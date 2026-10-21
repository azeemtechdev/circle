'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { signUp } from '@/lib/auth/actions';
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';

/**
 * Email and password, through Supabase Auth (src/lib/auth/actions.ts).
 *
 * The design showed a phone number and an SMS code. Circle's auth is email +
 * password: SMS codes need a paid SMS provider, which the $0 stack does not
 * have. The phone is still asked for here, because invites find people by it.
 *
 * When the project requires email confirmation, Supabase returns no session
 * and signUp answers with a notice; that becomes the "check your email"
 * screen below rather than a line of green text under the form.
 */
export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, EMPTY_AUTH_STATE);
  // Controlled, so a failed attempt does not wipe what was typed (React resets
  // uncontrolled fields after a form action), and so the confirmation screen
  // can name the address the email went to.
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  if (state.notice) {
    return (
      <div className="done" style={{ padding: '24px 0 0' }}>
        <div className="tick">
          <Icon name="check" size={42} />
        </div>
        <h1>Check your email</h1>
        <p className="mute" style={{ margin: '10px 0 22px' }}>
          We sent a link to <b style={{ color: 'var(--ink)' }}>{email}</b>. Open it on this phone to
          confirm your account, then sign in.
        </p>
        <Link href="/login" className="btn">
          Go to sign in
        </Link>
        <p className="mute small" style={{ marginTop: 16 }}>
          No email after a few minutes? Check your spam folder.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <h1>Create your account</h1>
      <p className="mute" style={{ margin: '8px 0 0' }}>
        Takes a minute. Then start a circle or join one.
      </p>

      <label className="field">
        <span>Full name</span>
        <input
          className="input"
          name="displayName"
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <small>What the others in your circle will see.</small>
      </label>

      <label className="field">
        <span>Phone number</span>
        <input
          className="input"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0803 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {/* Not required, but without it nobody can invite you: invites look
            people up by phone. Saying so beats a silent dead end later. */}
        <small>How friends find you to invite you. You can add it later.</small>
      </label>

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
          autoComplete="new-password"
          minLength={8}
          required
        />
        <small>At least 8 characters.</small>
      </label>

      {state.error ? (
        <p role="alert" className="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending} style={{ marginTop: 22 }}>
        {pending ? 'Creating your account…' : 'Continue'}
      </button>
    </form>
  );
}
