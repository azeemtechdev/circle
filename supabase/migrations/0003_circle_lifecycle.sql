-- 0003_circle_lifecycle.sql
--
-- Circles, memberships, rounds, contributions — and the state machines that
-- move them (ARCHITECTURE.md §2).
--
-- Rules this migration enforces in the database:
--
--   1. Status columns are NEVER written directly. Application roles have no
--      INSERT/UPDATE/DELETE on any of these tables; every transition goes
--      through a SECURITY DEFINER function that checks the current state and
--      raises on an illegal move.
--   2. Every transition writes an `events` row — the audit backbone.
--   3. Every mutating function takes an idempotency key. A replay returns the
--      original result and writes nothing.
--   4. Money still only moves through the Phase 1 ledger functions, in the
--      same transaction as the state change.
--
-- Circle:  draft -> inviting -> active -> completed
--                            \-> cancelled
-- Round:   open -> collecting -> settled -> closed
--                            \-> disputed -> collecting   (Phase 6)
-- Contribution: pending -> claimed -> confirmed
--                                 \-> disputed            (Phase 6)

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
-- One row per mutating request. The primary key is what makes a replay a
-- no-op: the second caller collides and is handed the original entity id.
-- entity_id is filled in once the work succeeds, so a row with a null
-- entity_id means a request is still in flight (or its transaction rolled
-- back, in which case the row rolled back with it).

create table if not exists public.idempotency_keys (
  key        text        primary key,
  operation  text        not null,
  entity_id  uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- circles
-- ---------------------------------------------------------------------------

create table if not exists public.circles (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null check (length(trim(name)) > 0),
  amount_kobo   bigint      not null check (amount_kobo > 0),
  period_days   int         not null check (period_days > 0),
  member_target int         not null check (member_target between 2 and 50),
  status        text        not null default 'draft'
                  check (status in ('draft', 'inviting', 'active', 'completed', 'cancelled')),
  created_by    uuid,
  activated_on  date,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------

create table if not exists public.memberships (
  id              uuid        primary key default gen_random_uuid(),
  circle_id       uuid        not null references public.circles (id),
  -- No FK to a users table yet: Supabase Auth arrives in Phase 3.
  user_id         uuid        not null,
  payout_position int         not null check (payout_position >= 1),
  status          text        not null default 'invited'
                    check (status in ('invited', 'joined', 'left')),
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),

  constraint memberships_one_per_user_per_circle unique (circle_id, user_id)
);

-- Rotation order is unique among members who are still in the circle.
create unique index if not exists memberships_one_per_position
  on public.memberships (circle_id, payout_position)
  where status <> 'left';

-- Now that circles and memberships exist, the Phase 1 accounts table can carry
-- real foreign keys (a TODO recorded in PHASE-01).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_circle_id_fkey'
  ) then
    alter table public.accounts
      add constraint accounts_circle_id_fkey
      foreign key (circle_id) references public.circles (id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'accounts_membership_id_fkey'
  ) then
    alter table public.accounts
      add constraint accounts_membership_id_fkey
      foreign key (membership_id) references public.memberships (id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- rounds
-- ---------------------------------------------------------------------------
-- A round is created when it starts, which is why there is no "scheduled"
-- state: [*] -> open (ARCHITECTURE.md §2).

create table if not exists public.rounds (
  id                      uuid        primary key default gen_random_uuid(),
  circle_id               uuid        not null references public.circles (id),
  round_number            int         not null check (round_number >= 1),
  recipient_membership_id uuid        not null references public.memberships (id),
  due_date                date        not null,
  status                  text        not null default 'open'
                            check (status in ('open', 'collecting', 'settled', 'disputed', 'closed')),
  created_at              timestamptz not null default now(),

  constraint rounds_one_per_number unique (circle_id, round_number)
);

-- A member receives the pot exactly once per circle.
create unique index if not exists rounds_one_payout_per_member
  on public.rounds (circle_id, recipient_membership_id);

-- ---------------------------------------------------------------------------
-- contributions
-- ---------------------------------------------------------------------------

create table if not exists public.contributions (
  id                 uuid        primary key default gen_random_uuid(),
  round_id           uuid        not null references public.rounds (id),
  payer_membership_id uuid       not null references public.memberships (id),
  amount_kobo        bigint      not null check (amount_kobo > 0),
  status             text        not null default 'pending'
                       check (status in ('pending', 'claimed', 'confirmed', 'disputed')),
  transfer_id        uuid        references public.transfers (id),
  claimed_at         timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),

  constraint contributions_one_per_payer_per_round unique (round_id, payer_membership_id)
);

create index if not exists contributions_round_idx on public.contributions (round_id, status);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Claims an idempotency key. Returns the original entity id on a replay, and
-- null when the caller is the first to claim it and should do the work.
create or replace function public.claim_idempotency_key(p_key text, p_operation text)
  returns table (is_replay boolean, entity_id uuid)
  language plpgsql
  set search_path = public
as $$
declare
  v_claimed text;
  v_existing uuid;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'an idempotency key is required for %', p_operation
      using errcode = 'check_violation';
  end if;

  insert into idempotency_keys (key, operation)
  values (p_key, p_operation)
  on conflict (key) do nothing
  returning key into v_claimed;

  if v_claimed is not null then
    return query select false, null::uuid;
    return;
  end if;

  select ik.entity_id into v_existing from idempotency_keys ik where ik.key = p_key;

  if v_existing is null then
    -- The original request is still running, or rolled back mid-flight.
    raise exception 'a request with idempotency key % is already in flight', p_key
      using errcode = 'lock_not_available';
  end if;

  return query select true, v_existing;
end;
$$;

create or replace function public.finish_idempotency_key(p_key text, p_entity_id uuid)
  returns void
  language sql
  set search_path = public
as $$
  update idempotency_keys set entity_id = p_entity_id where key = p_key;
$$;

-- Records a state transition. Called by every transition function; there is no
-- other way a status column changes.
create or replace function public.record_transition(
  p_entity_type text,
  p_entity_id   uuid,
  p_event_type  text,
  p_from        text,
  p_to          text,
  p_actor_id    uuid,
  p_metadata    jsonb default '{}'::jsonb
)
  returns void
  language sql
  set search_path = public
as $$
  insert into events (entity_type, entity_id, event_type, actor_id, from_state, to_state, metadata)
  values (p_entity_type, p_entity_id, p_event_type, p_actor_id, p_from, p_to, p_metadata);
$$;

-- ---------------------------------------------------------------------------
-- create_circle: [*] -> draft
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  p_idempotency_key text,
  p_name            text,
  p_amount_kobo     bigint,
  p_period_days     int,
  p_member_target   int,
  p_created_by      uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_circle_id uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'create_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  insert into circles (name, amount_kobo, period_days, member_target, created_by)
  values (p_name, p_amount_kobo, p_period_days, p_member_target, p_created_by)
  returning id into v_circle_id;

  perform record_transition(
    'circle', v_circle_id, 'circle.created', null, 'draft', p_created_by,
    jsonb_build_object('amount_kobo', p_amount_kobo::text, 'member_target', p_member_target)
  );

  perform finish_idempotency_key(p_idempotency_key, v_circle_id);
  return v_circle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- invite_member: draft -> inviting
-- ---------------------------------------------------------------------------

create or replace function public.invite_member(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_user_id         uuid,
  p_payout_position int,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
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
    'membership', v_membership_id, 'membership.invited', null, 'invited', p_actor_id,
    jsonb_build_object('circle_id', p_circle_id, 'payout_position', p_payout_position)
  );

  if v_circle.status = 'draft' then
    update circles set status = 'inviting' where id = p_circle_id;
    perform record_transition(
      'circle', p_circle_id, 'circle.inviting', 'draft', 'inviting', p_actor_id
    );
  end if;

  perform finish_idempotency_key(p_idempotency_key, v_membership_id);
  return v_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invite: membership invited -> joined
-- ---------------------------------------------------------------------------

create or replace function public.accept_invite(
  p_idempotency_key text,
  p_membership_id   uuid,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
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

  if v_membership.status <> 'invited' then
    raise exception 'membership % is %, so it cannot accept an invite', p_membership_id, v_membership.status
      using errcode = 'check_violation';
  end if;

  update memberships
     set status = 'joined', joined_at = now()
   where id = p_membership_id;

  perform record_transition(
    'membership', p_membership_id, 'membership.joined', 'invited', 'joined', p_actor_id
  );

  perform finish_idempotency_key(p_idempotency_key, p_membership_id);
  return p_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- activate_circle: inviting -> active
-- ---------------------------------------------------------------------------
-- Locks the rotation, creates the virtual accounts, and opens round 1.
-- Requires every seat filled and every invite accepted: a circle that starts
-- with a missing member cannot complete a full rotation.

create or replace function public.activate_circle(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_start_date      date default null,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_circle circles;
  v_joined int;
  v_start date;
  v_membership memberships;
  v_round_id uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'activate_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_circle from circles where id = p_circle_id for update;
  if not found then
    raise exception 'no such circle %', p_circle_id using errcode = 'foreign_key_violation';
  end if;

  if v_circle.status <> 'inviting' then
    raise exception 'cannot activate a % circle; it must be inviting', v_circle.status
      using errcode = 'check_violation';
  end if;

  select count(*) into v_joined
  from memberships
  where circle_id = p_circle_id and status = 'joined';

  if v_joined <> v_circle.member_target then
    raise exception
      'cannot activate: % of % members have joined', v_joined, v_circle.member_target
      using errcode = 'check_violation';
  end if;

  v_start := coalesce(p_start_date, current_date);

  -- One virtual account per member, plus the circle's clearing account.
  for v_membership in
    select * from memberships where circle_id = p_circle_id and status = 'joined'
  loop
    insert into accounts (circle_id, membership_id, kind)
    values (p_circle_id, v_membership.id, 'member');
  end loop;

  insert into accounts (circle_id, membership_id, kind)
  values (p_circle_id, null, 'clearing');

  update circles
     set status = 'active', activated_on = v_start
   where id = p_circle_id;

  perform record_transition(
    'circle', p_circle_id, 'circle.activated', 'inviting', 'active', p_actor_id,
    jsonb_build_object('members', v_joined, 'start_date', v_start)
  );

  v_round_id := open_round(p_circle_id, 1, p_actor_id);

  perform finish_idempotency_key(p_idempotency_key, p_circle_id);
  return p_circle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- open_round: [*] -> open
-- ---------------------------------------------------------------------------
-- Internal: called by activate_circle and close_round, never by a client.
-- Creates the round and a pending contribution for every member, including the
-- recipient — everyone pays in every round, and the recipient takes the pot.

create or replace function public.open_round(
  p_circle_id    uuid,
  p_round_number int,
  p_actor_id     uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_circle circles;
  v_recipient memberships;
  v_round_id uuid;
  v_member memberships;
begin
  select * into v_circle from circles where id = p_circle_id;

  select * into v_recipient
  from memberships
  where circle_id = p_circle_id and status = 'joined' and payout_position = p_round_number;

  if not found then
    raise exception 'no member holds payout position % in circle %', p_round_number, p_circle_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into rounds (circle_id, round_number, recipient_membership_id, due_date)
  values (
    p_circle_id,
    p_round_number,
    v_recipient.id,
    v_circle.activated_on + (v_circle.period_days * p_round_number)
  )
  returning id into v_round_id;

  for v_member in
    select * from memberships where circle_id = p_circle_id and status = 'joined'
  loop
    insert into contributions (round_id, payer_membership_id, amount_kobo)
    values (v_round_id, v_member.id, v_circle.amount_kobo);
  end loop;

  perform record_transition(
    'round', v_round_id, 'round.opened', null, 'open', p_actor_id,
    jsonb_build_object('round_number', p_round_number, 'recipient_membership_id', v_recipient.id)
  );

  return v_round_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_contribution: pending -> claimed  (and round open -> collecting)
-- ---------------------------------------------------------------------------

create or replace function public.claim_contribution(
  p_idempotency_key text,
  p_contribution_id uuid,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_contribution contributions;
  v_round rounds;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'claim_contribution');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  select * into v_contribution from contributions where id = p_contribution_id for update;
  if not found then
    raise exception 'no such contribution %', p_contribution_id using errcode = 'foreign_key_violation';
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

  update contributions
     set status = 'claimed', claimed_at = now()
   where id = p_contribution_id;

  perform record_transition(
    'contribution', p_contribution_id, 'contribution.claimed', 'pending', 'claimed', p_actor_id
  );

  if v_round.status = 'open' then
    update rounds set status = 'collecting' where id = v_round.id;
    perform record_transition('round', v_round.id, 'round.collecting', 'open', 'collecting', p_actor_id);
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_contribution_id);
  return p_contribution_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_contribution: claimed -> confirmed
-- ---------------------------------------------------------------------------
-- The recipient confirms the money arrived. This is where value actually moves
-- in the ledger: member account -> circle clearing account, posted in the same
-- transaction as the state change. When the last contribution is confirmed the
-- round becomes settled.

create or replace function public.confirm_contribution(
  p_idempotency_key text,
  p_contribution_id uuid,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
  v_contribution contributions;
  v_round rounds;
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

  if v_contribution.status <> 'claimed' then
    raise exception
      'contribution % is %, so it cannot be confirmed; it must be claimed first',
      p_contribution_id, v_contribution.status
      using errcode = 'check_violation';
  end if;

  select * into v_round from rounds where id = v_contribution.round_id for update;
  v_circle_id := v_round.circle_id;

  select id into v_payer_account
  from accounts
  where circle_id = v_circle_id and membership_id = v_contribution.payer_membership_id;

  select id into v_clearing_account
  from accounts
  where circle_id = v_circle_id and kind = 'clearing';

  if v_payer_account is null or v_clearing_account is null then
    raise exception 'circle % is missing its virtual accounts', v_circle_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Money moves only through the Phase 1 ledger, in this same transaction.
  v_transfer_id := post_double_entry(
    'contribution:' || p_contribution_id::text,
    v_payer_account,
    v_clearing_account,
    v_contribution.amount_kobo,
    'contribution confirmed',
    p_contribution_id,
    p_actor_id
  );

  update contributions
     set status = 'confirmed', confirmed_at = now(), transfer_id = v_transfer_id
   where id = p_contribution_id;

  perform record_transition(
    'contribution', p_contribution_id, 'contribution.confirmed', 'claimed', 'confirmed', p_actor_id,
    jsonb_build_object('transfer_id', v_transfer_id)
  );

  select count(*) into v_outstanding
  from contributions
  where round_id = v_round.id and status <> 'confirmed';

  if v_outstanding = 0 then
    update rounds set status = 'settled' where id = v_round.id;
    perform record_transition(
      'round', v_round.id, 'round.settled', v_round.status, 'settled', p_actor_id
    );
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_contribution_id);
  return p_contribution_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- close_round: settled -> closed
-- ---------------------------------------------------------------------------
-- Pays the pot out of clearing to this round's recipient, then either opens the
-- next round or completes the circle.

create or replace function public.close_round(
  p_idempotency_key text,
  p_round_id        uuid,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
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

  if v_round.status <> 'settled' then
    raise exception
      'round % is %, so it cannot be closed; every contribution must be confirmed first',
      p_round_id, v_round.status
      using errcode = 'check_violation';
  end if;

  select * into v_circle from circles where id = v_round.circle_id for update;

  select coalesce(sum(amount_kobo), 0) into v_pot
  from contributions
  where round_id = p_round_id and status = 'confirmed';

  select id into v_recipient_account
  from accounts
  where circle_id = v_circle.id and membership_id = v_round.recipient_membership_id;

  select id into v_clearing_account
  from accounts
  where circle_id = v_circle.id and kind = 'clearing';

  perform post_double_entry(
    'payout:' || p_round_id::text,
    v_clearing_account,
    v_recipient_account,
    v_pot,
    'round payout',
    null,
    p_actor_id
  );

  update rounds set status = 'closed' where id = p_round_id;
  perform record_transition(
    'round', p_round_id, 'round.closed', 'settled', 'closed', p_actor_id,
    jsonb_build_object('pot_kobo', v_pot::text)
  );

  if v_round.round_number < v_circle.member_target then
    perform open_round(v_circle.id, v_round.round_number + 1, p_actor_id);
  else
    update circles set status = 'completed' where id = v_circle.id;
    perform record_transition(
      'circle', v_circle.id, 'circle.completed', 'active', 'completed', p_actor_id
    );
  end if;

  perform finish_idempotency_key(p_idempotency_key, p_round_id);
  return p_round_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_circle: draft | inviting -> cancelled
-- ---------------------------------------------------------------------------
-- Only before any money has been claimed. Once a contribution exists the
-- circle has to be unwound deliberately, which is a dispute, not a cancel.

create or replace function public.cancel_circle(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_reason          text default null,
  p_actor_id        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_claim record;
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
    'circle', p_circle_id, 'circle.cancelled', v_circle.status, 'cancelled', p_actor_id,
    jsonb_build_object('reason', p_reason)
  );

  perform finish_idempotency_key(p_idempotency_key, p_circle_id);
  return p_circle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Same posture as the ledger: application roles may read, and may only write
-- through the transition functions. No role can set a status column directly.
--
-- 0002 set ALTER DEFAULT PRIVILEGES to strip PUBLIC execute from new functions,
-- but these REVOKEs are explicit anyway — on a SECURITY DEFINER function the
-- EXECUTE grant is the only thing between an anonymous request and the
-- definer's privileges, and that lesson cost a security fix once already.

revoke all on public.circles            from anon, authenticated, service_role;
revoke all on public.memberships        from anon, authenticated, service_role;
revoke all on public.rounds             from anon, authenticated, service_role;
revoke all on public.contributions      from anon, authenticated, service_role;
revoke all on public.idempotency_keys   from anon, authenticated, service_role;

grant select on public.circles       to authenticated, service_role;
grant select on public.memberships   to authenticated, service_role;
grant select on public.rounds        to authenticated, service_role;
grant select on public.contributions to authenticated, service_role;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'create_circle(text, text, bigint, int, int, uuid)',
    'invite_member(text, uuid, uuid, int, uuid)',
    'accept_invite(text, uuid, uuid)',
    'activate_circle(text, uuid, date, uuid)',
    'claim_contribution(text, uuid, uuid)',
    'confirm_contribution(text, uuid, uuid)',
    'close_round(text, uuid, uuid)',
    'cancel_circle(text, uuid, text, uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', v_signature);
    execute format('grant execute on function public.%s to authenticated, service_role', v_signature);
  end loop;

  -- Internal helpers: callable by nobody but the functions above, which run as
  -- their definer.
  foreach v_signature in array array[
    'open_round(uuid, int, uuid)',
    'claim_idempotency_key(text, text)',
    'finish_idempotency_key(text, uuid)',
    'record_transition(text, uuid, text, text, text, uuid, jsonb)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_signature);
  end loop;
end $$;
