'use server';

import { revalidatePath } from 'next/cache';

import type { AuthFormState } from '@/lib/auth/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Editing your own profile.
 *
 * Calls update_my_profile (migration 0007), which takes no user id — it only
 * ever touches current_actor()'s own row, so this action structurally cannot
 * edit anyone else's, whatever it is passed.
 *
 * A Server Action rather than an API route: no entity is created, nothing
 * enters the ledger, and there is no state transition to replay, so there is
 * nothing for an idempotency key to protect. Saving your name twice leaves the
 * same name.
 */
export async function updateProfile(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  if (!displayName) {
    return { error: 'Enter the name your circle will recognise.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('update_my_profile', {
    p_display_name: displayName,
    // Always sent, so clearing the field clears the number. Null would mean
    // "leave it alone", which would make the field impossible to empty.
    p_phone: phone,
  });

  if (error) return { error: error.message };

  revalidatePath('/profile');
  revalidatePath('/dashboard');
  return { error: null, notice: 'Saved.' };
}
