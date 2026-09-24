-- 0008_read_views.sql
--
-- Read models for the screens.
--
-- The problem these solve is the same one the ledger solved in 0001: PostgREST
-- serialises a BIGINT as a JSON number, and a JSON number is a double. A screen
-- that selected `amount_kobo` straight off `circles` would receive a value that
-- is silently wrong above 2^53, and CLAUDE.md forbids a float anywhere in a
-- money path. Every view here exposes money as `..._kobo_text`, so the browser
-- parses it with BigInt and formats it at the last possible moment.
--
-- `security_invoker = true` on every view. Without it a view runs as its owner
-- and bypasses the RLS on the tables underneath — one flag between "scoped to
-- your own circles" and "every family's finances readable by anyone signed in".
-- The policies from 0004 are what scope these; the views add no filtering of
-- their own and must not be trusted to.
--
-- Views rather than RPCs because reads are naturally filterable: the client
-- adds `?circle_id=eq.x` and PostgREST pushes it down into the query.

-- ---------------------------------------------------------------------------
-- my_circles
-- ---------------------------------------------------------------------------
-- RLS on `circles` already restricts this to circles you created or belong to,
-- so there is no where clause here.

create or replace view public.my_circles
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.amount_kobo::text              as amount_kobo_text,
  c.period_days,
  c.member_target,
  c.status,
  c.created_by,
  c.activated_on,
  c.created_at,
  (select count(*) from memberships m
    where m.circle_id = c.id and m.status <> 'left')::int    as member_count,
  (select count(*) from memberships m
    where m.circle_id = c.id and m.status = 'joined')::int   as joined_count
from circles c;

-- ---------------------------------------------------------------------------
-- circle_members
-- ---------------------------------------------------------------------------
-- Left join to profiles: a membership can exist for a user whose profile row is
-- not visible to this caller, and losing the whole row in that case would make
-- a member silently disappear from the list.

create or replace view public.circle_members
with (security_invoker = true) as
select
  m.id            as membership_id,
  m.circle_id,
  m.user_id,
  m.payout_position,
  m.status,
  m.joined_at,
  p.display_name,
  p.phone
from memberships m
left join profiles p on p.id = m.user_id;

-- ---------------------------------------------------------------------------
-- circle_rounds
-- ---------------------------------------------------------------------------
-- The pot is summed over CONFIRMED contributions only, which is what
-- close_round actually pays out. Showing the claimed-but-unconfirmed total
-- would promise the recipient money that nobody has acknowledged receiving.

create or replace view public.circle_rounds
with (security_invoker = true) as
select
  r.id            as round_id,
  r.circle_id,
  r.round_number,
  r.due_date,
  r.status,
  r.recipient_membership_id,
  rm.user_id      as recipient_user_id,
  rp.display_name as recipient_name,
  (select coalesce(sum(c.amount_kobo), 0)::text
     from contributions c
    where c.round_id = r.id and c.status = 'confirmed')  as pot_kobo_text,
  (select count(*) from contributions c
    where c.round_id = r.id)::int                          as contribution_count,
  (select count(*) from contributions c
    where c.round_id = r.id and c.status = 'confirmed')::int as confirmed_count
from rounds r
join memberships rm on rm.id = r.recipient_membership_id
left join profiles rp on rp.id = rm.user_id;

-- ---------------------------------------------------------------------------
-- round_contributions
-- ---------------------------------------------------------------------------
-- One row per person per round: the "who has paid" grid on the dashboard.

create or replace view public.round_contributions
with (security_invoker = true) as
select
  c.id            as contribution_id,
  c.round_id,
  r.circle_id,
  r.round_number,
  r.due_date,
  c.payer_membership_id,
  pm.user_id      as payer_user_id,
  pp.display_name as payer_name,
  c.amount_kobo::text as amount_kobo_text,
  c.status,
  c.claimed_at,
  c.confirmed_at
from contributions c
join rounds r on r.id = c.round_id
join memberships pm on pm.id = c.payer_membership_id
left join profiles pp on pp.id = pm.user_id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Read-only, and to `authenticated` only: anon has no select grant on any
-- underlying table (0002, 0004) and must not get one through a view.

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'my_circles', 'circle_members', 'circle_rounds', 'round_contributions'
  ]
  loop
    execute format('revoke all on public.%I from public, anon', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end $$;
