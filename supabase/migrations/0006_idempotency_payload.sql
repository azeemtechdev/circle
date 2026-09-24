-- 0006_idempotency_payload.sql
--
-- Make an idempotency key mean what CLAUDE.md says it means.
--
-- The rule is "same key + same payload -> return the original result, do
-- nothing". claim_idempotency_key matched on the KEY ALONE. It stored no
-- payload and no hash, and its replay branch never even compared the
-- `operation` column it was already recording. So:
--
--   create_circle('k', ...)      -> returns circle A
--   claim_contribution('k', ...) -> returns circle A's id, as a contribution id
--
-- A key reused under a different operation, or with different arguments,
-- silently handed back the wrong entity instead of failing. Nothing detected
-- it because a replay is supposed to look like success.
--
-- This is invisible today only because there are no HTTP clients yet. The
-- moment the Phase 3 routes exist, a client that reuses a key across requests
-- -- a retry wrapper keyed per session rather than per request is the obvious
-- way to get this wrong -- receives a wrong id and acts on it. Fixing it now,
-- while the only callers are tests, costs nothing.
--
-- After this migration a replay must match on key, operation AND payload.
-- Anything else raises rather than returning a stale entity.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.idempotency_keys add column if not exists payload_hash text;

-- ---------------------------------------------------------------------------
-- Hashing
-- ---------------------------------------------------------------------------
-- md5 is a change detector here, not a security primitive: it answers "are
-- these the same arguments as last time". pgcrypto is not guaranteed present,
-- and md5() is built in.
--
-- Parts are joined with a unit separator that cannot occur in the values, so
-- ('ab','c') and ('a','bc') do not collide. A null part is distinct from an
-- empty one for the same reason -- passing a reason of '' is a different
-- request from passing no reason at all.

create or replace function public.idempotency_payload_hash(variadic p_parts text[])
  returns text
  language sql
  immutable
as $$
  select md5(array_to_string(
    array(select coalesce(part, E'\\x00') from unnest(p_parts) as part),
    E'\\x1f'
  ));
$$;

-- ---------------------------------------------------------------------------
-- claim_idempotency_key
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: the payload hash is a required argument, so
-- leaving the two-argument version callable would leave the hole open for any
-- caller that simply did not pass one.

drop function if exists public.claim_idempotency_key(text, text);

create or replace function public.claim_idempotency_key(
  p_key          text,
  p_operation    text,
  p_payload_hash text
)
  returns table (is_replay boolean, entity_id uuid)
  language plpgsql
  set search_path = public
as $$
declare
  v_claimed  text;
  v_existing idempotency_keys;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'an idempotency key is required for %', p_operation
      using errcode = 'check_violation';
  end if;

  insert into idempotency_keys (key, operation, payload_hash)
  values (p_key, p_operation, p_payload_hash)
  on conflict (key) do nothing
  returning key into v_claimed;

  if v_claimed is not null then
    return query select false, null::uuid;
    return;
  end if;

  select * into v_existing from idempotency_keys where key = p_key;

  -- Same key, different request. Returning the original entity here is what
  -- the old version did, and it is how a caller ends up acting on the id of
  -- something they never asked about.
  if v_existing.operation is distinct from p_operation then
    raise exception
      'idempotency key % was already used for %, so it cannot be reused for %',
      p_key, v_existing.operation, p_operation
      using errcode = 'check_violation';
  end if;

  if v_existing.payload_hash is distinct from p_payload_hash then
    raise exception
      'idempotency key % was already used for % with different arguments',
      p_key, p_operation
      using errcode = 'check_violation';
  end if;

  if v_existing.entity_id is null then
    -- The original request is still running, or rolled back mid-flight.
    raise exception 'a request with idempotency key % is already in flight', p_key
      using errcode = 'lock_not_available';
  end if;

  return query select true, v_existing.entity_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transition functions, re-declared to hash their own arguments
-- ---------------------------------------------------------------------------
-- Each body below is the 0004 body with one line changed: the claim call now
-- carries a hash of that function's own parameters. The hash is computed HERE,
-- from the arguments the function actually received, and is never accepted
-- from the caller -- a client-supplied hash could be made to match anything,
-- which would restore the hole this migration closes.

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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'create_circle',
    idempotency_payload_hash(
      p_name, p_amount_kobo::text, p_period_days::text, p_member_target::text
    )
  );
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'invite_member',
    idempotency_payload_hash(p_circle_id::text, p_user_id::text, p_payout_position::text)
  );
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'accept_invite',
    idempotency_payload_hash(p_membership_id::text)
  );
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
  -- The raw p_start_date, not the coalesced value: two requests that differ
  -- only in whether they named a start date are different requests, even on a
  -- day when they would resolve to the same date.
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'activate_circle',
    idempotency_payload_hash(p_circle_id::text, p_start_date::text)
  );
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'claim_contribution',
    idempotency_payload_hash(p_contribution_id::text)
  );
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'confirm_contribution',
    idempotency_payload_hash(p_contribution_id::text)
  );
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'close_round',
    idempotency_payload_hash(p_round_id::text)
  );
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

-- cancel_circle: owner only, and only while no money has been claimed.
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
  select * into v_claim from claim_idempotency_key(
    p_idempotency_key, 'cancel_circle',
    idempotency_payload_hash(p_circle_id::text, p_reason)
  );
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
-- Grants
-- ---------------------------------------------------------------------------
-- `create or replace` preserves a function's grants, so the eight transitions
-- keep the 0004 grants. claim_idempotency_key was DROPPED, which takes its
-- grants with it, so its lockdown has to be re-applied here -- otherwise the
-- recreated function would default to PUBLIC execute, which is the 0002 defect
-- returning through the back door.

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'claim_idempotency_key(text, text, text)',
    'idempotency_payload_hash(text[])'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_signature);
    execute format('grant execute on function public.%s to service_role', v_signature);
  end loop;
end $$;
