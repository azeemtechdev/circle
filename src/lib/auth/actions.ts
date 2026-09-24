'use server';

import { redirect } from 'next/navigation';

import type { AuthFormState } from '@/lib/auth/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Authentication Server Actions.
 *
 * Server Actions rather than API routes because these are form posts, not part
 * of the money API: nothing here is a state transition, nothing writes to the
 * ledger, and there is no entity to be idempotent about. The idempotency-key
 * rule applies to the transition endpoints, which are separate.
 *
 * Errors come back as state for the form to render. An auth failure is an
 * ordinary thing a person does — a typo in a password — and it should not look
 * like a crash to someone on a cheap Android phone with a bad connection.
 */

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

/** Keeps an open redirect out of the `next` parameter. */
function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = text(formData, 'email');
  const password = text(formData, 'password');
  const displayName = text(formData, 'displayName');
  const phone = text(formData, 'phone');

  if (!email || !password) {
    return { error: 'Enter your email and a password.' };
  }
  if (!displayName) {
    return { error: 'Enter the name your circle will recognise.' };
  }
  if (password.length < 8) {
    return { error: 'Use at least 8 characters for your password.' };
  }

  const supabase = await createSupabaseServerClient();

  // display_name and phone go into raw_user_meta_data, which is exactly where
  // the handle_new_user trigger reads them from (migrations 0005, 0007). This
  // is what makes the account findable by phone, and therefore invitable —
  // without it the profile is created with a null phone and no circle owner can
  // ever locate this person.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, phone: phone || null } },
  });

  if (error) return { error: error.message };

  // Supabase returns a user with no session when email confirmation is on.
  if (!data.session) {
    return { error: null, notice: 'Check your email to confirm your account, then sign in.' };
  }

  redirect('/dashboard');
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = text(formData, 'email');
  const password = text(formData, 'password');
  const next = safeNext(text(formData, 'next'));

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Deliberately not "no account with that email": that tells a stranger which
  // addresses are registered.
  if (error) return { error: 'That email and password do not match an account.' };

  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
