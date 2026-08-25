-- 0002_lock_down_function_grants.sql
--
-- SECURITY FIX for a defect introduced by 0001.
--
-- Symptom: an anonymous caller, holding only the public anon key, could invoke
-- post_double_entry and post_reversal and write real entries into the ledger.
-- Verified against the live project: the functions returned their own argument
-- validation errors ("amount_kobo must be a positive integer number of kobo"),
-- which proves execution was permitted rather than refused.
--
-- Root cause: PostgreSQL grants EXECUTE on a newly created function to PUBLIC
-- by default. 0001 granted EXECUTE to authenticated and service_role, but
-- never revoked the implicit PUBLIC grant, so anon inherited it. Because these
-- functions are SECURITY DEFINER, they run with the definer's rights and
-- bypass the revoked INSERT grant on ledger_entries — the table-level lockdown
-- in 0001 gave no protection at all.
--
-- Fix: revoke EXECUTE from PUBLIC and from anon explicitly, then re-grant only
-- where intended. Also change the schema default so a function added by a
-- future migration is not exposed the moment it is created.
--
-- This is the general lesson: on a SECURITY DEFINER function, the EXECUTE
-- grant is the ONLY thing standing between an anonymous request and the
-- privileges of the function's owner.

-- ---------------------------------------------------------------------------
-- Stop the bleeding: no function in this schema is callable by PUBLIC.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.post_double_entry(text, uuid, uuid, bigint, text, uuid, uuid)
  from public, anon;

revoke execute on function
  public.post_reversal(text, uuid, text, uuid)
  from public, anon;

-- `authenticated` is revoked here too: 0001 granted it, and an ordinary member
-- has no business auditing every circle's books. Only the server reconciles.
revoke execute on function public.reconcile_ledger()
  from public, anon, authenticated;

revoke execute on function public.account_balance_kobo(uuid)
  from public, anon;

-- A trigger function is invoked by the trigger, not by clients. Nobody needs a
-- direct EXECUTE grant on it.
revoke execute on function public.refuse_mutation()
  from public, anon;

-- Future functions in this schema default to no PUBLIC execute grant, so this
-- defect cannot be reintroduced by simply forgetting a REVOKE.
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Re-grant deliberately
-- ---------------------------------------------------------------------------
-- Writing to the ledger requires a signed-in user or the server. Auditing the
-- books requires the server. Neither is ever anonymous.

grant execute on function
  public.post_double_entry(text, uuid, uuid, bigint, text, uuid, uuid)
  to authenticated, service_role;

grant execute on function
  public.post_reversal(text, uuid, text, uuid)
  to authenticated, service_role;

-- Reconciliation is a server job only — an anonymous visitor, and indeed an
-- ordinary member, has no business auditing every circle's books.
grant execute on function public.reconcile_ledger()
  to service_role;

grant execute on function public.account_balance_kobo(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table reads
-- ---------------------------------------------------------------------------
-- 0001 also granted SELECT on every ledger table to anon, which let an
-- anonymous request read every circle's entire financial history. Row Level
-- Security is what will scope reads to a member's own circles, but the
-- policies need `memberships` to exist, which is Phase 2. Until then anon gets
-- nothing: a closed door now, policies later.

revoke select on public.accounts         from anon;
revoke select on public.transfers        from anon;
revoke select on public.ledger_entries   from anon;
revoke select on public.events           from anon;
revoke select on public.account_balances from anon;
