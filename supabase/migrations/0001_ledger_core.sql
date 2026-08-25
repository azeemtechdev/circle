-- 0001_ledger_core.sql
--
-- The double-entry ledger: accounts, ledger_entries, transfers, events.
--
-- Non-negotiable rules this migration enforces at the database level, so that
-- application bugs cannot violate them (PLAN.md §4, CLAUDE.md "Hard rules"):
--
--   1. Money is integer kobo in BIGINT. No floats anywhere.
--   2. Every value movement is exactly two rows, debit and credit, equal
--      amounts, inserted by one function call — atomic or not at all.
--   3. ledger_entries and events are APPEND-ONLY. No UPDATE, no DELETE, for
--      anyone. Corrections are reversing entries.
--   4. The signed sum across ledger_entries is always zero.
--   5. Posting is idempotent: the same idempotency key returns the original
--      transfer and writes nothing new.
--
-- Portability note: this file runs against both the live Supabase project and
-- the PGlite test database, so it creates the Supabase roles if they are
-- missing rather than assuming them.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
-- One virtual account per membership per circle, plus exactly one clearing
-- account per circle. Money flows member -> clearing on a confirmed
-- contribution, and clearing -> member on a round payout.
--
-- circle_id and membership_id carry no foreign keys yet: `circles` and
-- `memberships` are Phase 2. The columns are typed and constrained now so the
-- FKs can be added later without touching the ledger.

create table if not exists public.accounts (
  id            uuid        primary key default gen_random_uuid(),
  circle_id     uuid        not null,
  membership_id uuid,
  kind          text        not null check (kind in ('member', 'clearing')),
  created_at    timestamptz not null default now(),

  -- A member account must name its membership; a clearing account must not.
  constraint accounts_membership_matches_kind check (
    (kind = 'member'   and membership_id is not null) or
    (kind = 'clearing' and membership_id is null)
  )
);

-- One account per membership, and exactly one clearing account per circle.
create unique index if not exists accounts_one_per_membership
  on public.accounts (circle_id, membership_id)
  where membership_id is not null;

create unique index if not exists accounts_one_clearing_per_circle
  on public.accounts (circle_id)
  where kind = 'clearing';

-- ---------------------------------------------------------------------------
-- transfers
-- ---------------------------------------------------------------------------
-- One row per value movement, and the idempotency record for it. The unique
-- index on idempotency_key is what makes a replayed post a no-op: the second
-- caller collides, and the function returns the original transfer instead.

create table if not exists public.transfers (
  id                   uuid        primary key default gen_random_uuid(),
  idempotency_key      text        not null unique,
  amount_kobo          bigint      not null check (amount_kobo > 0),
  debit_account_id     uuid        not null references public.accounts (id),
  credit_account_id    uuid        not null references public.accounts (id),
  -- Set when this transfer reverses an earlier one. A transfer may be
  -- reversed at most once, enforced by the unique index below.
  reverses_transfer_id uuid        references public.transfers (id),
  contribution_id      uuid,
  memo                 text,
  created_at           timestamptz not null default now(),

  constraint transfers_accounts_differ check (debit_account_id <> credit_account_id)
);

create unique index if not exists transfers_one_reversal_per_transfer
  on public.transfers (reverses_transfer_id)
  where reverses_transfer_id is not null;

-- ---------------------------------------------------------------------------
-- ledger_entries
-- ---------------------------------------------------------------------------
-- The money truth. Append-only. Two rows per transfer.
--
-- signed_amount_kobo is a generated column so "the ledger sums to zero" is a
-- single SUM with no application logic to get wrong: a debit is negative, a
-- credit is positive.

create table if not exists public.ledger_entries (
  id                 uuid        primary key default gen_random_uuid(),
  transfer_id        uuid        not null references public.transfers (id),
  account_id         uuid        not null references public.accounts (id),
  direction          text        not null check (direction in ('debit', 'credit')),
  amount_kobo        bigint      not null check (amount_kobo > 0),
  signed_amount_kobo bigint      not null generated always as (
                       case direction when 'debit' then -amount_kobo else amount_kobo end
                     ) stored,
  created_at         timestamptz not null default now()
);

-- Exactly one debit and one credit per transfer.
create unique index if not exists ledger_entries_one_per_direction
  on public.ledger_entries (transfer_id, direction);

create index if not exists ledger_entries_account_idx
  on public.ledger_entries (account_id);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
-- The audit backbone (ARCHITECTURE.md §7): every state transition, who did it,
-- when. Append-only, like the ledger.

create table if not exists public.events (
  id          uuid        primary key default gen_random_uuid(),
  entity_type text        not null,
  entity_id   uuid        not null,
  event_type  text        not null,
  actor_id    uuid,
  from_state  text,
  to_state    text,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_entity_idx
  on public.events (entity_type, entity_id, created_at);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
-- Belt and braces, because this is the rule that must never fail:
--
--   (a) A trigger that raises on UPDATE or DELETE. This fires for EVERY role,
--       including the database owner and service_role, and including ad-hoc
--       SQL typed into the Supabase dashboard.
--   (b) Revoked UPDATE/DELETE grants for the application roles, so the
--       attempt is refused before it even reaches the trigger.
--
-- (a) alone would be enough to preserve the data; (b) alone would not, since a
-- privileged role could still bypass it. CLAUDE.md requires (b) explicitly.

create or replace function public.refuse_mutation()
  returns trigger
  language plpgsql
as $$
begin
  raise exception
    '% is append-only: % is not permitted. Post a reversing entry instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists ledger_entries_append_only on public.ledger_entries;
create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.refuse_mutation();

drop trigger if exists events_append_only on public.events;
create trigger events_append_only
  before update or delete on public.events
  for each row execute function public.refuse_mutation();

-- TRUNCATE does not fire row-level triggers, so the two triggers above would
-- not stop `truncate ledger_entries`. These statement-level triggers close
-- that hole; without them "append-only" is one careless command from false.

drop trigger if exists ledger_entries_no_truncate on public.ledger_entries;
create trigger ledger_entries_no_truncate
  before truncate on public.ledger_entries
  for each statement execute function public.refuse_mutation();

drop trigger if exists events_no_truncate on public.events;
create trigger events_no_truncate
  before truncate on public.events
  for each statement execute function public.refuse_mutation();

-- ---------------------------------------------------------------------------
-- post_double_entry
-- ---------------------------------------------------------------------------
-- The ONLY way value moves. Inserts the transfer, both ledger rows and the
-- audit event in a single statement, so a caller cannot produce a half-posted
-- movement. SECURITY DEFINER because the application roles are deliberately
-- denied direct INSERT on ledger_entries.
--
-- Replay: if p_idempotency_key was used before, the original transfer id is
-- returned and nothing is written.

create or replace function public.post_double_entry(
  p_idempotency_key  text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount_kobo      bigint,
  p_memo             text default null,
  p_contribution_id  uuid default null,
  p_actor_id         uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_transfer_id uuid;
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'amount_kobo must be a positive integer number of kobo, got %', p_amount_kobo
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'an idempotency key is required'
      using errcode = 'check_violation';
  end if;

  -- Replay check. A concurrent duplicate is handled by the ON CONFLICT below.
  select id into v_transfer_id
  from transfers
  where idempotency_key = p_idempotency_key;

  if v_transfer_id is not null then
    return v_transfer_id;
  end if;

  insert into transfers (
    idempotency_key, amount_kobo, debit_account_id, credit_account_id, memo, contribution_id
  )
  values (
    p_idempotency_key, p_amount_kobo, p_debit_account_id, p_credit_account_id, p_memo, p_contribution_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transfer_id;

  -- Lost the race: another transaction inserted the same key. Return theirs.
  if v_transfer_id is null then
    select id into v_transfer_id from transfers where idempotency_key = p_idempotency_key;
    return v_transfer_id;
  end if;

  insert into ledger_entries (transfer_id, account_id, direction, amount_kobo)
  values
    (v_transfer_id, p_debit_account_id,  'debit',  p_amount_kobo),
    (v_transfer_id, p_credit_account_id, 'credit', p_amount_kobo);

  insert into events (entity_type, entity_id, event_type, actor_id, metadata)
  values (
    'transfer',
    v_transfer_id,
    'transfer.posted',
    p_actor_id,
    jsonb_build_object(
      'amount_kobo',       p_amount_kobo::text,
      'debit_account_id',  p_debit_account_id,
      'credit_account_id', p_credit_account_id,
      'memo',              p_memo
    )
  );

  return v_transfer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- post_reversal
-- ---------------------------------------------------------------------------
-- Corrections never edit history. A reversal is a new transfer with the debit
-- and credit accounts swapped, which drives the pair's net effect to zero
-- while leaving both the original and the correction visible forever.

create or replace function public.post_reversal(
  p_idempotency_key   text,
  p_transfer_id       uuid,
  p_memo              text default null,
  p_actor_id          uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_original   transfers;
  v_reversal_id uuid;
begin
  select id into v_reversal_id from transfers where idempotency_key = p_idempotency_key;
  if v_reversal_id is not null then
    return v_reversal_id;
  end if;

  select * into v_original from transfers where id = p_transfer_id;
  if not found then
    raise exception 'cannot reverse unknown transfer %', p_transfer_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_original.reverses_transfer_id is not null then
    raise exception 'transfer % is itself a reversal and cannot be reversed', p_transfer_id
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from transfers where reverses_transfer_id = p_transfer_id) then
    raise exception 'transfer % has already been reversed', p_transfer_id
      using errcode = 'unique_violation';
  end if;

  insert into transfers (
    idempotency_key, amount_kobo, debit_account_id, credit_account_id,
    reverses_transfer_id, contribution_id, memo
  )
  values (
    p_idempotency_key,
    v_original.amount_kobo,
    -- Swapped on purpose: this is what undoes the original.
    v_original.credit_account_id,
    v_original.debit_account_id,
    v_original.id,
    v_original.contribution_id,
    coalesce(p_memo, 'reversal of ' || v_original.id::text)
  )
  returning id into v_reversal_id;

  insert into ledger_entries (transfer_id, account_id, direction, amount_kobo)
  values
    (v_reversal_id, v_original.credit_account_id, 'debit',  v_original.amount_kobo),
    (v_reversal_id, v_original.debit_account_id,  'credit', v_original.amount_kobo);

  insert into events (entity_type, entity_id, event_type, actor_id, metadata)
  values (
    'transfer',
    v_reversal_id,
    'transfer.reversed',
    p_actor_id,
    jsonb_build_object(
      'reverses_transfer_id', v_original.id,
      'amount_kobo',          v_original.amount_kobo::text
    )
  );

  return v_reversal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances are computed, never stored (PLAN.md §4, invariant 3)
-- ---------------------------------------------------------------------------

create or replace view public.account_balances as
select
  a.id                                   as account_id,
  a.circle_id,
  a.membership_id,
  a.kind,
  coalesce(sum(le.signed_amount_kobo), 0)::bigint as balance_kobo
from public.accounts a
left join public.ledger_entries le on le.account_id = a.id
group by a.id, a.circle_id, a.membership_id, a.kind;

-- Balances must cross the API boundary as TEXT, not as a JSON number.
-- PostgREST serialises bigint as a JSON number, and a JS number is a double —
-- so any balance above 2^53 would arrive silently wrong. Returns null for an
-- unknown account so the caller can tell "no such account" from "zero".

create or replace function public.account_balance_kobo(p_account_id uuid)
  returns text
  language sql
  stable
  set search_path = public
as $$
  select case
    when exists (select 1 from accounts where id = p_account_id)
      then (
        select coalesce(sum(signed_amount_kobo), 0)::text
        from ledger_entries
        where account_id = p_account_id
      )
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation (PLAN.md §4, invariant 6)
-- ---------------------------------------------------------------------------
-- Returns one row per check with a pass/fail verdict and the drift. Empty
-- `details` plus ok = true across every row means the ledger is sound.

create or replace function public.reconcile_ledger()
  returns table (check_name text, ok boolean, detail text)
  language sql
  stable
  set search_path = public
as $$
  -- 1. The whole ledger sums to zero.
  select
    'ledger_sums_to_zero',
    coalesce(sum(signed_amount_kobo), 0) = 0,
    'net = ' || coalesce(sum(signed_amount_kobo), 0)::text || ' kobo'
  from ledger_entries

  union all

  -- 2. Every transfer has exactly one debit and one credit of equal size.
  select
    'every_transfer_balanced',
    count(*) = 0,
    'unbalanced transfers: ' || count(*)::text
  from (
    select t.id
    from transfers t
    left join ledger_entries le on le.transfer_id = t.id
    group by t.id, t.amount_kobo
    having count(*) <> 2
       or count(*) filter (where le.direction = 'debit')  <> 1
       or count(*) filter (where le.direction = 'credit') <> 1
       or coalesce(sum(le.signed_amount_kobo), 1) <> 0
       or min(le.amount_kobo) <> t.amount_kobo
       or max(le.amount_kobo) <> t.amount_kobo
  ) unbalanced

  union all

  -- 3. No ledger row is orphaned from a transfer or an account.
  select
    'no_orphan_entries',
    count(*) = 0,
    'orphan entries: ' || count(*)::text
  from ledger_entries le
  where not exists (select 1 from transfers t where t.id = le.transfer_id)
     or not exists (select 1 from accounts  a where a.id = le.account_id)

  union all

  -- 4. Every circle's accounts net to zero: value only moves between members
  --    and the clearing account, never in or out of the circle.
  select
    'each_circle_nets_to_zero',
    count(*) = 0,
    'circles with drift: ' || count(*)::text
  from (
    select ab.circle_id
    from account_balances ab
    group by ab.circle_id
    having sum(ab.balance_kobo) <> 0
  ) drifted

  union all

  -- 5. Amounts are positive integers. A zero or negative amount means a bug
  --    upstream of the CHECK constraints.
  select
    'amounts_are_positive',
    count(*) = 0,
    'non-positive amounts: ' || count(*)::text
  from ledger_entries
  where amount_kobo <= 0;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The application roles may READ the ledger and CALL the posting functions.
-- They may never INSERT, UPDATE or DELETE ledger rows directly: writes go
-- through the SECURITY DEFINER functions, which is what keeps a post atomic
-- and a correction a reversal.

revoke all on public.ledger_entries from anon, authenticated, service_role;
revoke all on public.events         from anon, authenticated, service_role;
revoke all on public.transfers      from anon, authenticated, service_role;
revoke all on public.accounts       from anon, authenticated, service_role;

grant select on public.ledger_entries  to anon, authenticated, service_role;
grant select on public.events          to anon, authenticated, service_role;
grant select on public.transfers       to anon, authenticated, service_role;
grant select on public.accounts        to anon, authenticated, service_role;
grant select on public.account_balances to anon, authenticated, service_role;

-- accounts is written by ordinary application code (Phase 2 creates them when
-- a circle is set up), so it keeps INSERT. It is not append-only.
grant insert on public.accounts to authenticated, service_role;

grant execute on function public.post_double_entry(text, uuid, uuid, bigint, text, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.post_reversal(text, uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.reconcile_ledger() to authenticated, service_role;
grant execute on function public.account_balance_kobo(uuid) to anon, authenticated, service_role;
