-- Migration: ensure users can always read their own profile + backfill legacy accounts.

drop policy if exists "profiles_select_self" on profiles;
create policy "profiles_select_self" on profiles
  for select using (user_id = auth.uid());

insert into profiles (user_id, email, full_name, role, org_setup_complete)
  select id, email, coalesce(raw_user_meta_data->>'full_name', email), 'masters', true
  from auth.users
  on conflict (user_id) do nothing;
