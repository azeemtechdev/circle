'use client';

import { useActionState, useState } from 'react';

import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';
import { updateProfile } from '@/lib/auth/profile-actions';

export function ProfileForm({
  displayName: initialName,
  phone: initialPhone,
}: {
  displayName: string;
  phone: string;
}) {
  const [state, action, pending] = useActionState(updateProfile, EMPTY_AUTH_STATE);
  // Controlled so a failed save keeps what was typed.
  const [displayName, setDisplayName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);

  return (
    <form action={action} style={{ paddingBottom: 6 }}>
      <label className="field">
        <span>Your name</span>
        <input
          className="input"
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          autoComplete="name"
        />
        <small>What the others in your circle see.</small>
      </label>

      <label className="field">
        <span>Phone number</span>
        <input
          className="input"
          name="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0803 123 4567"
        />
        <small>How friends find you to invite you. 0803… and +234803… are the same number.</small>
      </label>

      {state.error ? (
        <p role="alert" className="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="notice">
          {state.notice}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
