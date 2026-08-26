-- 0006_membership_identity_fk.sql
--
-- Enforce that every membership belongs to a real auth user identity.
-- This closes the Phase 3 identity gap: members are not allowed to exist
-- without a corresponding user record in auth.users.

-- The test database creates auth.users in 0005, and production Supabase owns the
-- table. The migration is therefore conditional so it runs safely in both
-- environments without overwriting Supabase's real schema.
do $$
begin
  if to_regclass('auth.users') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'memberships_user_id_fkey'
    ) then
      alter table public.memberships
        add constraint memberships_user_id_fkey
        foreign key (user_id) references auth.users (id) on delete cascade;
    end if;
  end if;
end $$;
