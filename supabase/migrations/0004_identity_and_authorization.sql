-- 0004_identity_and_authorization.sql
--
-- Identity, authorization, and Row Level Security.
--
-- Until now the transition functions accepted an actor id as a PARAMETER and
-- did nothing with it but write it to the audit log. That means every
-- authenticated user could claim or confirm any other member's contribution,
-- activate a circle they do not belong to, or cancel someone else's circle.
-- The functions are SECURITY DEFINER, so table grants gave no protection —
-- the same shape of hole as the PUBLIC execute defect fixed in 0002.
--
-- This migration:
--   1. Derives the actor from auth.uid() inside each function. A caller can no
--      longer name themselves; the parameter is gone.
--   2. Adds an authorization check to every transition: only the payer may
--      claim, only the round's recipient may confirm, only the circle's owner
--      may invite, activate or cancel, and only the invited user may accept.
--   3. Adds `profiles`, keyed to auth.users, so a member has a name and phone.
--   4. Enables RLS on every table and scopes reads to circles you belong to,
--      which is the Phase 1/2 deferral finally paid off.

-- ---------------------------------------------------------------------------
-- auth.uid() shim for the test database
-- ---------------------------------------------------------------------------
-- Supabase provides auth.uid(), reading the sub claim of the request JWT.
-- PGlite has no auth schema, so create a compatible one ONLY when absent —
-- never overwrite the real implementation.

do $outer$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $shim$
      create function auth.uid() returns uuid
        language sql stable
      as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$;
    $shim$;
  end if;
end
$outer$;

-- The actor for the current request. Every transition uses this; none of them
-- accept an actor from the caller any more.
create or replace function public.current_actor()
  returns uuid
  language plpgsql
  stable
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'this action requires a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One row per user. No FK to auth.users in the test database, where that table
-- does not exist; added conditionally so the live project keeps referential
-- integrity.

create table if not exists public.profiles (
  id               uuid        primary key,
  display_name     text        not null check (length(trim(display_name)) > 0),
  phone            text,
  telegram_chat_id text,
  created_at       timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'auth' and tablename = 'users'
  ) and not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

-- Is the given user a live member of this circle?
create or replace function public.is_circle_member(p_circle_id uuid, p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from memberships
    where circle_id = p_circle_id
      and user_id = p_user_id
      and status <> 'left'
  );
$$;

-- The owner is whoever created the circle. Circles created before this
-- migration have a null created_by and therefore no owner, which is correct:
-- they are fixtures, not real circles.
create or replace function public.is_circle_owner(p_circle_id uuid, p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from circles where id = p_circle_id and created_by = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Transition functions, re-declared without a caller-supplied actor
-- ---------------------------------------------------------------------------
-- The old signatures are dropped outright rather than left in place. Leaving a
-- spoofable overload callable would defeat the entire migration.

drop function if exists public.create_circle(text, text, bigint, int, int, uuid);
drop function if exists public.invite_member(text, uuid, uuid, int, uuid);
drop function if exists public.accept_invite(text, uuid, uuid);
drop function if exists public.activate_circle(text, uuid, date, uuid);
drop function if exists public.claim_contribution(text, uuid, uuid);
drop function if exists public.confirm_contribution(text, uuid, uuid);
drop function if exists public.close_round(text, uuid, uuid);
drop function if exists public.cancel_circle(text, uuid, text, uuid);

-- create_circle: [*] -> draft. The caller becomes the owner.
create or replace function public.create_circle(
  p_idempotency_key text,
  p_name            text,
  p_amount_kobo     bigint,
  p_period_days     int,
  p_member_target   int
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_circle_id uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'create_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  insert into circles (name, amount_kobo, period_days, member_target, created_by)
  values (p_name, p_amount_kobo, p_period_days, p_member_target, v_actor)
  returning id into v_circle_id;

  perform record_transition(
    'circle', v_circle_id, 'circle.created', null, 'draft', v_actor,
    jsonb_build_object('amount_kobo', p_amount_kobo::text, 'member_target', p_member_target)
  );

  perform finish_idempotency_key(p_idempotency_key, v_circle_id);
  return v_circle_id;
end;
$$;

-- invite_member: owner only.
create or replace function public.invite_member(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_user_id         uuid,
  p_payout_position int
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_circle circles;
  v_membership_id uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'invite_member');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_circle from circles where id = p_circle_id for update;
  if not found then
    raise exception 'no such circle %', p_circle_id using errcode = 'foreign_key_violation';
  end if;

  if v_circle.created_by is distinct from v_actor then
    raise exception 'only the circle owner may invite members'
      using errcode = 'insufficient_privilege';
  end if;

  if v_circle.status not in ('draft', 'inviting') then
    raise exception 'cannot invite to a % circle; invites are only allowed while draft or inviting', v_circle.status
      using errcode = 'check_violation';
  end if;

  if p_payout_position > v_circle.member_target then
    raise exception 'payout position % exceeds the circle size of %', p_payout_position, v_circle.member_target
      using errcode = 'check_violation';
  end if;

  insert into memberships (circle_id, user_id, payout_position)
  values (p_circle_id, p_user_id, p_payout_position)
  returning id into v_membership_id;

  perform record_transition(
    'membership', v_membership_id, 'membership.invited', null, 'invited', v_actor,
    jsonb_build_object('circle_id', p_circle_id, 'payout_position', p_payout_position)
  );

  if v_circle.status = 'draft' then
    update circles set status = 'inviting' where id = p_circle_id;
    perform record_transition('circle', p_circle_id, 'circle.inviting', 'draft', 'inviting', v_actor);
  end if;

  perform finish_idempotency_key(p_idempotency_key, v_membership_id);
  return v_membership_id;
end;
$$;

-- accept_invite: only the invited user may accept their own invite.
create or replace function public.accept_invite(
  p_idempotency_key text,
  p_membership_id   uuid
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_membership memberships;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'accept_invite');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_membership from memberships where id = p_membership_id for update;
  if not found then
    raise exception 'no such membership %', p_membership_id using errcode = 'foreign_key_violation';
  end if;

  if v_membership.user_id <> v_actor then
    raise exception 'an invite can only be accepted by the person invited'
      using errcode = 'insufficient_privilege';
  end if;

  if v_membership.status <> 'invited' then
    raise exception 'membership % is %, so it cannot accept an invite', p_membership_id, v_membership.status
      using errcode = 'check_violation';
  end if;

  update memberships set status = 'joined', joined_at = now() where id = p_membership_id;

  perform record_transition(
    'membership', p_membership_id, 'membership.joined', 'invited', 'joined', v_actor
  );

  perform finish_idempotency_key(p_idempotency_key, p_membership_id);
  return p_membership_id;
end;
$$;

-- activate_circle: owner only.
create or replace function public.activate_circle(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_start_date      date default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_circle circles;
  v_joined int;
  v_start date;
  v_membership memberships;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'activate_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_circle from circles where id = p_circle_id for update;
  if not found then
    raise exception 'no such circle %', p_circle_id using errcode = 'foreign_key_violation';
  end if;

  if v_circle.created_by is distinct from v_actor then
    raise exception 'only the circle owner may activate it'
      using errcode = 'insufficient_privilege';
  end if;

  if v_circle.status <> 'inviting' then
    raise exception 'cannot activate a % circle; it must be inviting', v_circle.status
      using errcode = 'check_violation';
  end if;

  select count(*) into v_joined
  from memberships where circle_id = p_circle_id and status = 'joined';

  if v_joined <> v_circle.member_target then
    raise exception 'cannot activate: % of % members have joined', v_joined, v_circle.member_target
      using errcode = 'check_violation';
  end if;

  v_start := coalesce(p_start_date, current_date);

  for v_membership in
    select * from memberships where circle_id = p_circle_id and status = 'joined'
  loop
    insert into accounts (circle_id, membership_id, kind)
    values (p_circle_id, v_membership.id, 'member');
  end loop;

  insert into accounts (circle_id, membership_id, kind)
  values (p_circle_id, null, 'clearing');

  update circles set status = 'active', activated_on = v_start where id = p_circle_id;

  perform record_transition(
    'circle', p_circle_id, 'circle.activated', 'inviting', 'active', v_actor,
    jsonb_build_object('members', v_joined, 'start_date', v_start)
  );

  perform open_round(p_circle_id, 1, v_actor);

  perform finish_idempotency_key(p_idempotency_key, p_circle_id);
  return p_circle_id;
end;
$$;

-- claim_contribution: only the payer may say "I've paid".
create or replace function public.claim_contribution(
  p_idempotency_key text,
  p_contribution_id uuid
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_contribution contributions;
  v_round rounds;
  v_payer_user uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'claim_contribution');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_contribution from contributions where id = p_contribution_id for update;
  if not found then
    raise exception 'no such contribution %', p_contribution_id using errcode = 'foreign_key_violation';
  end if;

  select user_id into v_payer_user from memberships where id = v_contribution.payer_membership_id;

  if v_payer_user <> v_actor then
    raise exception 'only the payer may claim their own contribution'
      using errcode = 'insufficient_privilege';
  end if;

  if v_contribution.status <> 'pending' then
    raise exception 'contribution % is %, so it cannot be claimed', p_contribution_id, v_contribution.status
      using errcode = 'check_violation';
  end if;

  select * into v_round from rounds where id = v_contribution.round_id for update;
  if v_round.status not in ('open', 'collecting') then
    raise exception 'round % is %, so it is not accepting claims', v_round.id, v_round.status
      using errcode = 'check_violation';
  end if;

  update contributions set status = 'claimed', claimed_at = now() where id = p_contribution_id;

  perform record_transition(
    'contribution', p_contribution_id, 'contribution.claimed', 'pending', 'claimed', v_actor
  );

  if v_round.status = 'open' then
    update rounds set status = 'collecting' where id = v_round.id;
    perform record_transition('round', v_round.id, 'round.collecting', 'open', 'collecting', v_actor);
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_contribution_id);
  return p_contribution_id;
end;
$$;

-- confirm_contribution: only this round's recipient may say "received".
-- They are the person the money was actually sent to.
create or replace function public.confirm_contribution(
  p_idempotency_key text,
  p_contribution_id uuid
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_contribution contributions;
  v_round rounds;
  v_recipient_user uuid;
  v_circle_id uuid;
  v_payer_account uuid;
  v_clearing_account uuid;
  v_transfer_id uuid;
  v_outstanding int;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'confirm_contribution');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_contribution from contributions where id = p_contribution_id for update;
  if not found then
    raise exception 'no such contribution %', p_contribution_id using errcode = 'foreign_key_violation';
  end if;

  select * into v_round from rounds where id = v_contribution.round_id for update;

  select user_id into v_recipient_user from memberships where id = v_round.recipient_membership_id;

  if v_recipient_user <> v_actor then
    raise exception 'only this round''s recipient may confirm a contribution'
      using errcode = 'insufficient_privilege';
  end if;

  if v_contribution.status <> 'claimed' then
    raise exception
      'contribution % is %, so it cannot be confirmed; it must be claimed first',
      p_contribution_id, v_contribution.status
      using errcode = 'check_violation';
  end if;

  v_circle_id := v_round.circle_id;

  select id into v_payer_account
  from accounts where circle_id = v_circle_id and membership_id = v_contribution.payer_membership_id;

  select id into v_clearing_account
  from accounts where circle_id = v_circle_id and kind = 'clearing';

  if v_payer_account is null or v_clearing_account is null then
    raise exception 'circle % is missing its virtual accounts', v_circle_id
      using errcode = 'foreign_key_violation';
  end if;

  v_transfer_id := post_double_entry(
    'contribution:' || p_contribution_id::text,
    v_payer_account,
    v_clearing_account,
    v_contribution.amount_kobo,
    'contribution confirmed',
    p_contribution_id,
    v_actor
  );

  update contributions
     set status = 'confirmed', confirmed_at = now(), transfer_id = v_transfer_id
   where id = p_contribution_id;

  perform record_transition(
    'contribution', p_contribution_id, 'contribution.confirmed', 'claimed', 'confirmed', v_actor,
    jsonb_build_object('transfer_id', v_transfer_id)
  );

  select count(*) into v_outstanding
  from contributions where round_id = v_round.id and status <> 'confirmed';

  if v_outstanding = 0 then
    update rounds set status = 'settled' where id = v_round.id;
    perform record_transition('round', v_round.id, 'round.settled', v_round.status, 'settled', v_actor);
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_contribution_id);
  return p_contribution_id;
end;
$$;

-- close_round: the recipient acknowledges the payout, which is what releases
-- the pot to them. Any member of the circle may also close it once settled, so
-- a silent recipient cannot stall the rotation — but the money still goes only
-- to the recipient's account.
create or replace function public.close_round(
  p_idempotency_key text,
  p_round_id        uuid
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_round rounds;
  v_circle circles;
  v_recipient_account uuid;
  v_clearing_account uuid;
  v_pot bigint;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'close_round');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_round from rounds where id = p_round_id for update;
  if not found then
    raise exception 'no such round %', p_round_id using errcode = 'foreign_key_violation';
  end if;

  if not is_circle_member(v_round.circle_id, v_actor) then
    raise exception 'only a member of this circle may close its rounds'
      using errcode = 'insufficient_privilege';
  end if;

  if v_round.status <> 'settled' then
    raise exception
      'round % is %, so it cannot be closed; every contribution must be confirmed first',
      p_round_id, v_round.status
      using errcode = 'check_violation';
  end if;

  select * into v_circle from circles where id = v_round.circle_id for update;

  select coalesce(sum(amount_kobo), 0) into v_pot
  from contributions where round_id = p_round_id and status = 'confirmed';

  select id into v_recipient_account
  from accounts where circle_id = v_circle.id and membership_id = v_round.recipient_membership_id;

  select id into v_clearing_account
  from accounts where circle_id = v_circle.id and kind = 'clearing';

  perform post_double_entry(
    'payout:' || p_round_id::text,
    v_clearing_account,
    v_recipient_account,
    v_pot,
    'round payout',
    null,
    v_actor
  );

  update rounds set status = 'closed' where id = p_round_id;
  perform record_transition(
    'round', p_round_id, 'round.closed', 'settled', 'closed', v_actor,
    jsonb_build_object('pot_kobo', v_pot::text)
  );

  if v_round.round_number < v_circle.member_target then
    perform open_round(v_circle.id, v_round.round_number + 1, v_actor);
  else
    update circles set status = 'completed' where id = v_circle.id;
    perform record_transition('circle', v_circle.id, 'circle.completed', 'active', 'completed', v_actor);
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_round_id);
  return p_round_id;
end;
$$;

-- cancel_circle: owner only.
create or replace function public.cancel_circle(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_reason          text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_actor uuid := current_actor();
  v_circle circles;
  v_claimed int;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'cancel_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_circle from circles where id = p_circle_id for update;
  if not found then
    raise exception 'no such circle %', p_circle_id using errcode = 'foreign_key_violation';
  end if;

  if v_circle.created_by is distinct from v_actor then
    raise exception 'only the circle owner may cancel it'
      using errcode = 'insufficient_privilege';
  end if;

  if v_circle.status not in ('draft', 'inviting', 'active') then
    raise exception 'cannot cancel a % circle', v_circle.status using errcode = 'check_violation';
  end if;

  select count(*) into v_claimed
  from contributions c
  join rounds r on r.id = c.round_id
  where r.circle_id = p_circle_id and c.status in ('claimed', 'confirmed');

  if v_claimed > 0 then
    raise exception
      'cannot cancel circle %: % contributions have already been claimed or confirmed',
      p_circle_id, v_claimed
      using errcode = 'check_violation';
  end if;

  update circles set status = 'cancelled' where id = p_circle_id;
  perform record_transition(
    'circle', p_circle_id, 'circle.cancelled', v_circle.status, 'cancelled', v_actor,
    jsonb_build_object('reason', p_reason)
  );

  perform finish_idempotency_key(p_idempotency_key, p_circle_id);
  return p_circle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Grants decide which tables a role may read at all; RLS decides which ROWS.
-- Without this, any signed-in user could read every circle in the database.
--
-- The policies are read-only by design. Writes still have no grant at all and
-- go exclusively through the SECURITY DEFINER functions above, which bypass
-- RLS — that is why the authorization checks in those functions matter so much.

alter table public.profiles       enable row level security;
alter table public.circles        enable row level security;
alter table public.memberships    enable row level security;
alter table public.rounds         enable row level security;
alter table public.contributions  enable row level security;
alter table public.accounts       enable row level security;
alter table public.transfers      enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.events         enable row level security;

drop policy if exists profiles_self_or_circle_mate on public.profiles;
create policy profiles_self_or_circle_mate on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships mine
      join memberships theirs on theirs.circle_id = mine.circle_id
      where mine.user_id = auth.uid()
        and mine.status <> 'left'
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists circles_members_read on public.circles;
create policy circles_members_read on public.circles
  for select to authenticated
  using (created_by = auth.uid() or is_circle_member(id, auth.uid()));

drop policy if exists memberships_members_read on public.memberships;
create policy memberships_members_read on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or is_circle_member(circle_id, auth.uid()));

drop policy if exists rounds_members_read on public.rounds;
create policy rounds_members_read on public.rounds
  for select to authenticated
  using (is_circle_member(circle_id, auth.uid()));

drop policy if exists contributions_members_read on public.contributions;
create policy contributions_members_read on public.contributions
  for select to authenticated
  using (
    exists (
      select 1 from rounds r
      where r.id = contributions.round_id
        and is_circle_member(r.circle_id, auth.uid())
    )
  );

drop policy if exists accounts_members_read on public.accounts;
create policy accounts_members_read on public.accounts
  for select to authenticated
  using (is_circle_member(circle_id, auth.uid()));

drop policy if exists transfers_members_read on public.transfers;
create policy transfers_members_read on public.transfers
  for select to authenticated
  using (
    exists (
      select 1 from accounts a
      where a.id = transfers.debit_account_id
        and is_circle_member(a.circle_id, auth.uid())
    )
  );

drop policy if exists ledger_entries_members_read on public.ledger_entries;
create policy ledger_entries_members_read on public.ledger_entries
  for select to authenticated
  using (
    exists (
      select 1 from accounts a
      where a.id = ledger_entries.account_id
        and is_circle_member(a.circle_id, auth.uid())
    )
  );

-- Events are the audit trail. A member may read the events of entities in
-- their own circles; everything else stays hidden.
drop policy if exists events_members_read on public.events;
create policy events_members_read on public.events
  for select to authenticated
  using (
    (entity_type = 'circle' and is_circle_member(entity_id, auth.uid()))
    or (entity_type = 'membership' and exists (
      select 1 from memberships m
      where m.id = events.entity_id and is_circle_member(m.circle_id, auth.uid())
    ))
    or (entity_type = 'round' and exists (
      select 1 from rounds r
      where r.id = events.entity_id and is_circle_member(r.circle_id, auth.uid())
    ))
    or (entity_type = 'contribution' and exists (
      select 1 from contributions c
      join rounds r on r.id = c.round_id
      where c.id = events.entity_id and is_circle_member(r.circle_id, auth.uid())
    ))
    or (entity_type = 'transfer' and exists (
      select 1 from transfers t
      join accounts a on a.id = t.debit_account_id
      where t.id = events.entity_id and is_circle_member(a.circle_id, auth.uid())
    ))
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.profiles to authenticated, service_role;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'create_circle(text, text, bigint, int, int)',
    'invite_member(text, uuid, uuid, int)',
    'accept_invite(text, uuid)',
    'activate_circle(text, uuid, date)',
    'claim_contribution(text, uuid)',
    'confirm_contribution(text, uuid)',
    'close_round(text, uuid)',
    'cancel_circle(text, uuid, text)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', v_signature);
    execute format('grant execute on function public.%s to authenticated, service_role', v_signature);
  end loop;

  foreach v_signature in array array[
    'current_actor()',
    'is_circle_member(uuid, uuid)',
    'is_circle_owner(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', v_signature);
    execute format('grant execute on function public.%s to authenticated, service_role', v_signature);
  end loop;
end $$;
