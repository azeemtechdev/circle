'use server';

import { revalidatePath } from 'next/cache';

import type { AuthFormState } from '@/lib/auth/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Saving where you want to be paid.
 *
 * Calls set_my_payout_account (migration 0010), which takes no user id and
 * only ever writes current_actor()'s own row. Validation lives there; the
 * checks below only spare a round trip for the obvious blanks.
 *
 * A Server Action, like updateProfile: nothing enters the ledger and no state
 * machine moves, and saving identical details is already a no-op in SQL.
 */
export async function savePayoutAccount(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const bankName = String(formData.get('bankName') ?? '').trim();
  const accountNumber = String(formData.get('accountNumber') ?? '').trim();
  const accountName = String(formData.get('accountName') ?? '').trim();

  if (!bankName || !accountNumber || !accountName) {
    return { error: 'Fill in your bank, account number and the name on the account.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_my_payout_account', {
    p_bank_name: bankName,
    p_account_number: accountNumber,
    p_account_name: accountName,
  });

  if (error) return { error: capitalise(error.message) };

  revalidatePath('/profile');
  return { error: null, notice: 'Saved. Members of your circles will see these when it is your turn.' };
}

function capitalise(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1) + (message.endsWith('.') ? '' : '.');
}
