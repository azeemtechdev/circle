-- 0009_owner_joins_own_circle.sql
--
-- The owner is a member of their own circle.
--
-- create_circle inserted the circle and nothing else, so a freshly created
-- three-person circle read "0 of 3 joined" and the owner had to look their own
-- phone number up on the invite screen to invite themselves. Every test wrote
-- that step out by hand, which is how it survived this long: the fixtures made
-- an unnatural flow look normal.
--
-- It is also a correctness problem, not only an awkward one. activate_circle
-- requires joined_count = member_target, so an owner who forgot to invite
-- themselves would fill the circle with other people and then be unable to
-- start it, with nothing on screen explaining why. And `memberships` has a
-- unique index on (circle_id, payout_position) plus one on (circle_id,
-- user_id), so the owner inviting themselves was always one mistyped position
-- away from a constraint error they could not read.
--
-- Whoever creates the circle now takes payout position 1 and is joined
-- immediately -- they do not invite or accept anything, because there is
-- nobody to accept from. Invites therefore start at position 2.
--
-- Position 1 by convention: the organiser collecting first is the usual shape
-- of an ajo, and it is the only position that needs no agreement from anyone
-- else. Choosing a different slot would mean rotation reordering, which the
-- schema does not support and v1 does not need.

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
  v_membership_id uuid;
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

  -- The owner joins in the same transaction as the circle is created. Doing it
  -- as a second statement from the application would allow a circle to exist
  -- with no members if the process died between the two.
  --
  -- Straight to 'joined': the invited -> joined transition exists so that one
  -- person can accept another person's invitation, and there is no such pair
  -- here. Inventing an invite the owner instantly accepts would put two events
  -- in the audit log describing something that never happened.
  insert into memberships (circle_id, user_id, payout_position, status, joined_at)
  values (v_circle_id, v_actor, 1, 'joined', now())
  returning id into v_membership_id;

  perform record_transition(
    'membership', v_membership_id, 'membership.joined', null, 'joined', v_actor,
    jsonb_build_object('circle_id', v_circle_id, 'payout_position', 1, 'reason', 'circle owner')
  );

  perform finish_idempotency_key(p_idempotency_key, v_circle_id);
  return v_circle_id;
end;
$$;

-- `create or replace` keeps the grants from 0004. No new function, nothing to
-- re-grant, and the signature is unchanged so the route and its payload hash
-- are untouched.
