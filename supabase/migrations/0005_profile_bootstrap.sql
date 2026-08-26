-- 0005_profile_bootstrap.sql
--
-- In production, Supabase owns auth.users and the schema is permission-locked.
-- In PGlite, the auth schema/table does not exist, so we create a tiny mock
-- version just for testing. We swallow insufficient_privilege so the migration
-- is safe to run in the live Supabase SQL editor without crashing.

create or replace function public.handle_new_auth_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(new.email, '@', 1), '')
  );

  if v_display_name is null or length(trim(v_display_name)) = 0 then
    v_display_name := 'Circle member';
  end if;

  insert into public.profiles (id, display_name, phone)
  values (new.id, v_display_name, new.phone)
  on conflict (id) do update
    set display_name = excluded.display_name,
        phone = excluded.phone;

  return new;
end;
$$;

do $$
begin
  begin
    create schema if not exists auth;
  exception when insufficient_privilege then
    null;
  end;

  begin
    create table if not exists auth.users (
      id uuid primary key,
      email text,
      phone text,
      raw_user_meta_data jsonb,
      created_at timestamptz not null default now()
    );
  exception when insufficient_privilege then
    null;
  end;

  if to_regclass('auth.users') is not null then
    begin
      drop trigger if exists on_auth_user_created on auth.users;
      create trigger on_auth_user_created
        after insert on auth.users
        for each row
        execute function public.handle_new_auth_user();
    exception when insufficient_privilege then
      null;
    end;
  end if;
end $$;