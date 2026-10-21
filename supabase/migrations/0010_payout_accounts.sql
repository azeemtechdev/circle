-- 0010_payout_accounts.sql
--
-- Where a member wants to be paid.
--
-- Every round, everyone who owes the recipient has to ask "what's your account
-- number?" in the group chat. Circle never moves money (PLAN.md §2), but it can
-- show the details the recipient entered, next to the amount, with a copy
-- button. This table holds them.
--
-- A table of its own rather than columns on `profiles`, on purpose:
--
--   * `profiles` is readable by anyone who shares a circle with you, including
--     people who have only been INVITED, and it sits behind find_profile_by_phone.
--     Bank details need a narrower audience: people who have actually joined a
--     circle with you. A separate table gets its own policy, so a future
--     loosening of the profiles policy cannot leak account numbers by accident.
--   * It keeps "who is this person" and "where do I send money" apart, which is
--     what the screen needs anyway.
--
-- The account name is TYPED BY THE OWNER and not verified here. Verifying it
-- needs a bank or Paystack name lookup, which is payment-rails territory and a
-- v1 non-goal. The real check is the name the payer's own bank app shows before
-- a transfer goes through; the pay sheet tells them to compare.
--
-- Changes are written to `events`. The dangerous case is a hijacked account
-- swapping the details just before payout day, so the screen warns when they
-- changed recently, and the audit log is where a dispute would look.

create table if not exists public.payout_accounts (
  user_id        uuid        primary key references public.profiles (id) on delete cascade,
  bank_name      text        not null check (length(trim(bank_name)) between 1 and 80),
  -- Text, not a number: NUBAN account numbers can start with 0.
  account_number text        not null check (account_number ~ '^[0-9]{10}$'),
  account_name   text        not null check (length(trim(account_name)) between 1 and 100),
  created_at     timestamptz not null default now(),
  -- Bumped only when a value actually changes. updated_at <> created_at means
  -- "these details were edited after they were first entered", which is what
  -- the recent-change warning keys off.
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- set_my_payout_account
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER with no user id parameter, the same shape as
-- update_my_profile (0007): it can only ever write current_actor()'s own row.
-- No role gets an insert or update grant on the table.
--
-- Not idempotency-keyed: it is a Server Action, not a transition route, and
-- saving the same details twice changes nothing -- an identical save does not
-- even bump updated_at or write an event.

create or replace function public.set_my_payout_account(
  p_bank_name      text,
  p_account_number text,
  p_account_name   text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor    uuid := current_actor();
  v_bank     text := trim(coalesce(p_bank_name, ''));
  -- Spaces are how people read a number aloud ("0123 456 789"); anything else
  -- that is not a digit is a typo the user needs to see.
  v_number   text := regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
  v_name     text := trim(coalesce(p_account_name, ''));
  v_existing payout_accounts;
  v_is_change boolean;
begin
  if v_bank = '' then
    raise exception 'choose your bank' using errcode = 'check_violation';
  end if;
  if v_number !~ '^[0-9]{10}$' then
    raise exception 'an account number is exactly 10 digits' using errcode = 'check_violation';
  end if;
  if v_name = '' then
    raise exception 'enter the name on the account' using errcode = 'check_violation';
  end if;

  select * into v_existing from payout_accounts where user_id = v_actor for update;
  -- Captured now: FOUND is overwritten by the insert or update below.
  v_is_change := found;

  if v_is_change then
    if v_existing.bank_name = v_bank
       and v_existing.account_number = v_number
       and v_existing.account_name = v_name then
      return v_actor;
    end if;

    update payout_accounts
       set bank_name = v_bank, account_number = v_number, account_name = v_name,
           updated_at = now()
     where user_id = v_actor;
  else
    insert into payout_accounts (user_id, bank_name, account_number, account_name)
    values (v_actor, v_bank, v_number, v_name);
  end if;

  -- Last four digits only: the audit log outlives the details, and the full
  -- number is not needed to see that it changed.
  perform record_transition(
    'payout_account', v_actor,
    case when v_is_change then 'payout_account.changed' else 'payout_account.added' end,
    null, null, v_actor,
    jsonb_build_object(
      'bank_name', v_bank,
      'account_name', v_name,
      'account_number_last4', right(v_number, 4)
    )
  );

  return v_actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- You see your own row, and the rows of people who have JOINED a circle you
-- have also joined. An invitee who has not accepted sees nothing yet, and
-- neither does anyone who has left.

alter table public.payout_accounts enable row level security;

drop policy if exists payout_accounts_self_or_joined_circle_mate on public.payout_accounts;
create policy payout_accounts_self_or_joined_circle_mate on public.payout_accounts
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from memberships mine
      join memberships theirs on theirs.circle_id = mine.circle_id
      where mine.user_id = auth.uid()
        and mine.status = 'joined'
        and theirs.user_id = payout_accounts.user_id
        and theirs.status = 'joined'
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase grants new public tables to anon and authenticated by default, so
-- revoke everything first, then hand back read only. EXECUTE on the new
-- function defaults to PUBLIC -- the 0002 defect -- so revoke that too.

revoke all on public.payout_accounts from public, anon, authenticated;
grant select on public.payout_accounts to authenticated, service_role;

do $$
begin
  execute 'revoke execute on function public.set_my_payout_account(text, text, text) from public, anon';
  execute 'grant execute on function public.set_my_payout_account(text, text, text) to authenticated, service_role';
end $$;
