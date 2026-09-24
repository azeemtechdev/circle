-- 0005_profile_provisioning.sql
--
-- Profile provisioning and member lookup.
--
-- 0004 added `profiles` and keyed it to auth.users, but nothing ever inserted a
-- row: the table has a select grant, a select-only RLS policy, and no writer of
-- any kind. Meanwhile invite_member takes an existing user id. The result is
-- that a user can sign up and still be invisible — impossible to look up,
-- impossible to invite — which blocks the invite screen and therefore all of
-- Phase 3.
--
-- This migration:
--   1. Creates the profile automatically when a user signs up, via a trigger on
--      auth.users, and backfills anyone who signed up before now.
--   2. Adds `email` to profiles, and normalises `phone` to E.164 so that two
--      spellings of the same Nigerian number resolve to one profile.
--   3. Adds find_profile_by_phone / find_profile_by_email so the invite screen
--      can turn something a human typed into a user id. They return ONLY the id
--      and display name, never the row, so the lookup cannot be used to scrape
--      the user table.
--
-- Deferred on purpose: inviting someone who has no account yet. That needs a
-- membership holding a phone number with a null user_id plus a claim path at
-- signup, and it is not in v1. Invites resolve to existing accounts only.

-- ---------------------------------------------------------------------------
-- auth.users shim for the test database
-- ---------------------------------------------------------------------------
-- Same pattern, and the same rule, as the auth.uid() shim in 0004: create it
-- ONLY when absent, never overwrite Supabase's own table. Without this the
-- trigger below could not be created in PGlite, and the provisioning path — the
-- entire point of this migration — would ship untested.
--
-- Only the columns this migration reads are shimmed.

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;

  if not exists (
    select 1 from pg_tables where schemaname = 'auth' and tablename = 'users'
  ) then
    create table auth.users (
      id                 uuid primary key default gen_random_uuid(),
      email              text unique,
      phone              text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at         timestamptz not null default now()
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles.email
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists email text;

-- ---------------------------------------------------------------------------
-- Phone normalisation
-- ---------------------------------------------------------------------------
-- A Nigerian mobile gets typed as 0803 123 4567, 234 803 123 4567, or
-- +2348031234567. Those are one phone. Lookup only works if the stored form and
-- the typed form are put through the same function, so every write and every
-- read below goes through this one.
--
-- Returns null for anything that does not look like a phone, so a junk string
-- can never match a stored null-free value by accident.

create or replace function public.normalize_phone(p_phone text)
  returns text
  language plpgsql
  immutable
as $$
declare
  v_digits text;
begin
  if p_phone is null then
    return null;
  end if;

  -- Keep digits only; a leading + is re-added below from the country code.
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

  if length(v_digits) = 0 then
    return null;
  end if;

  -- 0803... -> +234803...  (national trunk form)
  if left(v_digits, 1) = '0' and length(v_digits) = 11 then
    return '+234' || substring(v_digits from 2);
  end if;

  -- 234803... -> +234803...
  if left(v_digits, 3) = '234' and length(v_digits) between 13 and 14 then
    return '+' || v_digits;
  end if;

  -- Anything else is treated as already international. Short strings are
  -- rejected rather than stored, so '123' never becomes a matchable "number".
  if length(v_digits) < 8 then
    return null;
  end if;

  return '+' || v_digits;
end;
$$;

-- Normalise whatever 0004 or a manual insert already put there.
update public.profiles
   set phone = public.normalize_phone(phone)
 where phone is not null
   and phone is distinct from public.normalize_phone(phone);

-- A phone and an email each identify at most one person. Without this, a lookup
-- could return two profiles and the invite would silently pick one.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone) where phone is not null;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- Provisioning
-- ---------------------------------------------------------------------------
-- display_name is NOT NULL with a non-empty CHECK, so the fallback chain has to
-- end in something that always exists. Signup metadata first, then the email
-- local part, then the phone, then a placeholder the user can change later.

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_name  text;
  v_phone text;
begin
  v_phone := normalize_phone(new.phone);

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    v_phone,
    'Member'
  );

  -- do nothing, not do update: a re-run or a backfill overlapping the trigger
  -- must never clobber a display name the user has since edited.
  insert into profiles (id, display_name, email, phone)
  values (new.id, v_name, new.email, v_phone)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill everyone who signed up before the trigger existed. Same conflict
-- rule, so running this migration twice is a no-op.
insert into public.profiles (id, display_name, email, phone)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
    public.normalize_phone(u.phone),
    'Member'
  ),
  u.email,
  public.normalize_phone(u.phone)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Lookup
-- ---------------------------------------------------------------------------
-- These are SECURITY DEFINER because the caller cannot read a stranger's
-- profile under RLS — that is the whole reason a lookup function is needed. A
-- definer function bypasses RLS, so each one deliberately returns two columns
-- and nothing else, and requires a signed-in caller. An anonymous visitor
-- cannot probe whether a phone number is registered.

create or replace function public.find_profile_by_phone(p_phone text)
  returns table (id uuid, display_name text)
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_phone text;
begin
  perform current_actor();

  v_phone := normalize_phone(p_phone);
  if v_phone is null then
    return;
  end if;

  return query
    select p.id, p.display_name from profiles p where p.phone = v_phone;
end;
$$;

create or replace function public.find_profile_by_email(p_email text)
  returns table (id uuid, display_name text)
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_email text;
begin
  perform current_actor();

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then
    return;
  end if;

  return query
    select p.id, p.display_name from profiles p where lower(p.email) = v_email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- EXECUTE defaults to PUBLIC. On a SECURITY DEFINER function that is the defect
-- fixed in 0002, and it would be worse here: PUBLIC execute on a lookup would
-- let an anonymous caller enumerate registered phone numbers. Revoke first,
-- then grant narrowly. The grants test asserts this stays true.

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'find_profile_by_phone(text)',
    'find_profile_by_email(text)',
    'normalize_phone(text)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', v_signature);
    execute format('grant execute on function public.%s to authenticated, service_role', v_signature);
  end loop;

  -- The trigger function runs as the table owner on insert; nobody calls it.
  execute 'revoke execute on function public.handle_new_user() from public, anon, authenticated';
end $$;
