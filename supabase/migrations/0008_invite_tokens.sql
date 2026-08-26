-- 0008_invite_tokens.sql
--
-- Allow circle invites to reach people who do not have an account yet.
-- These invite rows can be redeemed by phone or by token after sign-up.

create table if not exists public.invite_tokens (
  id              uuid        primary key default gen_random_uuid(),
  circle_id       uuid        not null references public.circles (id) on delete cascade,
  invited_user_id uuid        null references auth.users (id) on delete cascade,
  invited_phone   text        null,
  invite_token    text        not null unique,
  payout_position int         not null check (payout_position >= 1),
  status          text        not null default 'pending'
                    check (status in ('pending', 'claimed', 'expired')),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  constraint invite_tokens_target_required check (
    (invited_user_id is not null and invited_phone is null)
    or (invited_user_id is null and invited_phone is not null)
    or (invited_user_id is not null and invited_phone is not null)
  )
);

create index if not exists invite_tokens_token_idx on public.invite_tokens (invite_token);
create index if not exists invite_tokens_phone_idx on public.invite_tokens (invited_phone) where invited_phone is not null;
-- Drop old overloads that may conflict due to parameter-order changes in
-- earlier migrations. This ensures PGlite/test runs do not see multiple
-- invite_member signatures.
drop function if exists public.invite_member(text, uuid, uuid, integer);
-- Also drop older accept_invite overloads so the canonical signature
-- defined below is the only accept_invite visible to callers.
drop function if exists public.accept_invite(text, uuid);
drop function if exists public.accept_invite(text, uuid, uuid);

create or replace function public.invite_member(
  p_idempotency_key text,
  p_circle_id       uuid,
  p_payout_position int,
  p_user_id         uuid default null,
  p_phone           text default null,
  p_invite_token    text default null
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
  v_invite_token text;
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

  if p_user_id is not null then
    insert into memberships (circle_id, user_id, payout_position)
    values (p_circle_id, p_user_id, p_payout_position)
    returning id into v_membership_id;

    perform record_transition(
      'membership', v_membership_id, 'membership.invited', null, 'invited', v_actor,
      jsonb_build_object('circle_id', p_circle_id, 'payout_position', p_payout_position, 'user_id', p_user_id)
    );
  elsif p_phone is not null then
    v_invite_token := coalesce(p_invite_token, gen_random_uuid()::text);
    insert into invite_tokens (circle_id, invited_phone, invite_token, payout_position)
    values (p_circle_id, p_phone, v_invite_token, p_payout_position)
    returning id into v_membership_id;

    perform record_transition(
      'invite', v_membership_id, 'invite.created', null, 'pending', v_actor,
      jsonb_build_object('circle_id', p_circle_id, 'invited_phone', p_phone, 'payout_position', p_payout_position)
    );
  elsif p_invite_token is not null then
    insert into invite_tokens (circle_id, invite_token, payout_position)
    values (p_circle_id, p_invite_token, p_payout_position)
    returning id into v_membership_id;

    perform record_transition(
      'invite', v_membership_id, 'invite.created', null, 'pending', v_actor,
      jsonb_build_object('circle_id', p_circle_id, 'invite_token', p_invite_token, 'payout_position', p_payout_position)
    );
  else
    raise exception 'an invite needs a user id, a phone number, or a token'
      using errcode = 'check_violation';
  end if;

  if v_circle.status = 'draft' then
    update circles set status = 'inviting' where id = p_circle_id;
    perform record_transition('circle', p_circle_id, 'circle.inviting', 'draft', 'inviting', v_actor);
  end if;

  perform finish_idempotency_key(p_idempotency_key, v_membership_id);
  return v_membership_id;
end;
$$;



create or replace function public.accept_invite(
  p_idempotency_key text,
  p_membership_id   uuid default null,
  p_invite_token    text default null,
  p_phone           text default null
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
  v_invite invite_tokens;
  v_target_id uuid;
begin
  select * into v_claim from claim_idempotency_key(p_idempotency_key, 'accept_invite');
  if v_claim.is_replay then
    return v_claim.entity_id;
  end if;

  if p_membership_id is not null then
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
  end if;

  if p_invite_token is not null then
    select * into v_invite
    from invite_tokens
    where invite_token = p_invite_token and status = 'pending'
    for update;

    if not found then
      raise exception 'no such pending invite for token %', p_invite_token using errcode = 'foreign_key_violation';
    end if;

    if v_invite.invited_user_id is not null and v_invite.invited_user_id <> v_actor then
      raise exception 'this invite can only be accepted by the intended recipient'
        using errcode = 'insufficient_privilege';
    end if;

    insert into memberships (circle_id, user_id, payout_position, status, joined_at)
    values (v_invite.circle_id, v_actor, v_invite.payout_position, 'joined', now())
    returning id into v_target_id;

    update invite_tokens set status = 'claimed', claimed_at = now(), invited_user_id = v_actor where id = v_invite.id;
    perform record_transition(
      'membership', v_target_id, 'membership.joined', 'invited', 'joined', v_actor,
      jsonb_build_object('circle_id', v_invite.circle_id, 'payout_position', v_invite.payout_position, 'invite_token', p_invite_token)
    );

    perform finish_idempotency_key(p_idempotency_key, v_target_id);
    return v_target_id;
  end if;

  if p_phone is not null then
    select * into v_invite
    from invite_tokens
    where invited_phone = p_phone and status = 'pending'
    order by created_at desc
    limit 1
    for update;

    if not found then
      raise exception 'no such pending invite for phone %', p_phone using errcode = 'foreign_key_violation';
    end if;

    insert into memberships (circle_id, user_id, payout_position, status, joined_at)
    values (v_invite.circle_id, v_actor, v_invite.payout_position, 'joined', now())
    returning id into v_target_id;

    update invite_tokens set status = 'claimed', claimed_at = now(), invited_user_id = v_actor where id = v_invite.id;
    perform record_transition(
      'membership', v_target_id, 'membership.joined', 'invited', 'joined', v_actor,
      jsonb_build_object('circle_id', v_invite.circle_id, 'payout_position', v_invite.payout_position, 'phone', p_phone)
    );

    perform finish_idempotency_key(p_idempotency_key, v_target_id);
    return v_target_id;
  end if;

  raise exception 'accept_invite requires a membership id, token, or phone'
    using errcode = 'check_violation';
end;
$$;
