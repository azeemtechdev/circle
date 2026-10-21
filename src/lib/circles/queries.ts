import type { PayoutAccount } from '@/lib/payout';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Reads for the screens.
 *
 * Every one of these goes through the views from migration 0008 on a
 * cookie-bound client, so RLS decides what comes back. There is no `where
 * user_id = ...` anywhere below — adding one would suggest the filtering
 * happens here, and if RLS were ever wrong that suggestion is what would hide
 * the bug. A query for a circle you are not in returns nothing, and that is the
 * database's answer, not this file's.
 *
 * Money arrives as `..._kobo_text` and stays a string until it is formatted.
 */

export interface CircleSummary {
  id: string;
  name: string;
  amount_kobo_text: string;
  period_days: number;
  member_target: number;
  status: 'draft' | 'inviting' | 'active' | 'completed' | 'cancelled';
  created_by: string | null;
  activated_on: string | null;
  member_count: number;
  joined_count: number;
}

export interface CircleMember {
  membership_id: string;
  circle_id: string;
  user_id: string;
  payout_position: number;
  status: 'invited' | 'joined' | 'left';
  display_name: string | null;
  phone: string | null;
}

export interface CircleRound {
  round_id: string;
  circle_id: string;
  round_number: number;
  due_date: string;
  status: 'open' | 'collecting' | 'settled' | 'disputed' | 'closed';
  recipient_membership_id: string;
  recipient_user_id: string;
  recipient_name: string | null;
  pot_kobo_text: string;
  contribution_count: number;
  confirmed_count: number;
}

export interface RoundContribution {
  contribution_id: string;
  round_id: string;
  circle_id: string;
  round_number: number;
  due_date: string;
  payer_membership_id: string;
  payer_user_id: string;
  payer_name: string | null;
  amount_kobo_text: string;
  status: 'pending' | 'claimed' | 'confirmed' | 'disputed';
  claimed_at: string | null;
  confirmed_at: string | null;
}

export async function listMyCircles(): Promise<CircleSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('my_circles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load your circles: ${error.message}`);
  return (data ?? []) as CircleSummary[];
}

export async function getCircle(circleId: string): Promise<CircleSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('my_circles')
    .select('*')
    .eq('id', circleId)
    .maybeSingle();

  if (error) throw new Error(`Could not load that circle: ${error.message}`);
  return (data as CircleSummary | null) ?? null;
}

export async function listMembers(circleId: string): Promise<CircleMember[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('circle_members')
    .select('*')
    .eq('circle_id', circleId)
    .order('payout_position');

  if (error) throw new Error(`Could not load the members: ${error.message}`);
  return (data ?? []) as CircleMember[];
}

export async function listRounds(circleId: string): Promise<CircleRound[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('circle_rounds')
    .select('*')
    .eq('circle_id', circleId)
    .order('round_number');

  if (error) throw new Error(`Could not load the rounds: ${error.message}`);
  return (data ?? []) as CircleRound[];
}

export async function listContributions(roundId: string): Promise<RoundContribution[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('round_contributions')
    .select('*')
    .eq('round_id', roundId)
    .order('payer_name');

  if (error) throw new Error(`Could not load who has paid: ${error.message}`);
  return (data ?? []) as RoundContribution[];
}

/**
 * Where someone wants to be paid, or null if they have not said — or if RLS
 * hides it because you have not both joined a circle together (migration
 * 0010). The screen treats both the same: "ask them in the group".
 */
export async function getPayoutAccount(userId: string): Promise<PayoutAccount | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('payout_accounts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the account details: ${error.message}`);
  return (data as PayoutAccount | null) ?? null;
}

/**
 * The round people are actually looking at: the earliest one still open.
 * A completed circle has none, which is why this can return null.
 */
export function currentRound(rounds: CircleRound[]): CircleRound | null {
  return rounds.find((r) => r.status !== 'closed') ?? null;
}
