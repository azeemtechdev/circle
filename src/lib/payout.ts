/**
 * Payout account details (migration 0010), as the screens see them.
 *
 * Pure, so it can be tested without a database or a request.
 */

export interface PayoutAccount {
  user_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  created_at: string;
  updated_at: string;
}

const DAY_MS = 86_400_000;

/**
 * Edited after first entry, within the last `days` days.
 *
 * Drives the warning on the pay sheet. The case it exists for is a hijacked
 * account swapping the details just before payout day; a first-time entry is
 * not a change and does not warn.
 */
export function changedRecently(account: PayoutAccount, now: Date = new Date(), days = 7): boolean {
  const updated = new Date(account.updated_at).getTime();
  if (updated === new Date(account.created_at).getTime()) return false;
  return now.getTime() - updated < days * DAY_MS;
}

/** Whole days since the last change, for "changed 2 days ago". */
export function daysSinceChange(account: PayoutAccount, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(account.updated_at).getTime()) / DAY_MS));
}

/** "0123 456 789" — easier to read back against a bank app than ten digits in a row. */
export function groupAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
}

/** Common Nigerian banks for the picker. "Other" lets anyone else type theirs. */
export const NIGERIAN_BANKS = [
  'Access Bank',
  'First Bank',
  'GTBank',
  'UBA',
  'Zenith Bank',
  'Fidelity Bank',
  'FCMB',
  'Union Bank',
  'Sterling Bank',
  'Stanbic IBTC',
  'Wema Bank',
  'Polaris Bank',
  'Ecobank',
  'Keystone Bank',
  'Opay',
  'Moniepoint',
  'Palmpay',
  'Kuda',
] as const;
