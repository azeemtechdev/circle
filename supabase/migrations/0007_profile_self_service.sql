-- 0007_profile_self_service.sql
--
-- Two gaps in 0005 that only became visible once the signup form existed.
--
-- 1. handle_new_user() read the phone from auth.users.phone, which is only
--    populated for SMS-OTP signups. Circle signs people up with email and
--    password, so auth.users.phone is null and the profile was created with no
--    phone -- which means find_profile_by_phone can never locate them, which
--    means the invite flow that 0005 existed to unblock still does not work.
--    Signup metadata is where the phone actually arrives.
--
-- 2. Nothing could edit a profile. `profiles` has a select grant and no update
--    path, so a user who mistyped their phone at signup, changed number, or
--    wanted a different display name was stuck with it forever, and a user who
--    signed up before being asked for a phone could never become findable.
--
-- Both are one migration because the second is the recovery path for anyone
-- created under the first.

-- ---------------------------------------------------------------------------
-- Provisioning, now reading the phone from signup metadata
-- ---------------------------------------------------------------------------

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
  -- auth.users.phone first (SMS signup), then signup metadata (email signup,
  -- which is what Circle uses).
  v_phone := coalesce(
    normalize_phone(new.phone),
    normalize_phone(new.raw_user_meta_data ->> 'phone')
  );

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    v_phone,
    'Member'
  );

  insert into profiles (id, display_name, email, phone)
  values (new.id, v_name, new.email, v_phone)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_my_profile
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because `profiles` has no update grant to any role and is
-- not getting one: an update policy would have to be written carefully enough
-- to stop a user editing somebody else's row, and the definer function makes
-- that structural instead -- it only ever touches current_actor()'s own row.
-- There is no p_user_id parameter, deliberately; that was the 0004 defect.
--
-- Null means "leave unchanged", so the caller can set a phone without
-- resending the display name.

create or replace function public.update_my_profile(
  p_display_name text default null,
  p_phone        text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := current_actor();
  v_name  text;
  v_phone text;
begin
  if p_display_name is not null and length(trim(p_display_name)) = 0 then
    raise exception 'a display name cannot be blank' using errcode = 'check_violation';
  end if;

  v_name := nullif(trim(coalesce(p_display_name, '')), '');

  if p_phone is not null then
    v_phone := normalize_phone(p_phone);
    -- Distinguish "clear my phone" (an empty string) from "that is not a phone
    -- number", which is almost always a typo the user needs to see.
    if v_phone is null and length(trim(p_phone)) > 0 then
      raise exception '% is not a phone number we recognise', p_phone
        using errcode = 'check_violation';
    end if;
  end if;

  update profiles
     set display_name = coalesce(v_name, display_name),
         phone        = case when p_phone is null then phone else v_phone end
   where id = v_actor;

  if not found then
    raise exception 'no profile for the signed-in user' using errcode = 'no_data_found';
  end if;

  return v_actor;
exception
  -- The unique index from 0005. Without this the caller sees a raw constraint
  -- name, which is not something to put in front of a user.
  when unique_violation then
    raise exception 'that phone number is already registered to another account'
      using errcode = 'unique_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- `create or replace` keeps handle_new_user()'s existing lockdown.
-- update_my_profile is new, so EXECUTE defaults to PUBLIC and must be revoked
-- before it is granted -- the 0002 defect.

do $$
begin
  execute 'revoke execute on function public.update_my_profile(text, text) from public, anon';
  execute 'grant execute on function public.update_my_profile(text, text) to authenticated, service_role';
end $$;
