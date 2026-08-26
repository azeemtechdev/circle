-- 0007_create_circle_owner_membership.sql
--
-- Circle owners are members of their own circle from the moment the circle is
-- created. This closes the Phase 3 blocker in §4 and keeps the app from
-- requiring the owner to discover a self-invite flow.

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
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'create_circle');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  insert into circles (name, amount_kobo, period_days, member_target, created_by)
  values (p_name, p_amount_kobo, p_period_days, p_member_target, v_actor)
  returning id into v_circle_id;

  insert into memberships (circle_id, user_id, payout_position, status, joined_at)
  values (v_circle_id, v_actor, 1, 'joined', now())
  returning id into v_membership_id;

  perform record_transition(
    'circle', v_circle_id, 'circle.created', null, 'draft', v_actor,
    jsonb_build_object('amount_kobo', p_amount_kobo::text, 'member_target', p_member_target)
  );

  perform record_transition(
    'membership', v_membership_id, 'membership.joined', null, 'joined', v_actor,
    jsonb_build_object('circle_id', v_circle_id, 'payout_position', 1)
  );

  perform finish_idempotency_key(p_idempotency_key, v_circle_id);
  return v_circle_id;
end;
$$;
