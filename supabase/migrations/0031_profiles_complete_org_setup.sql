-- Allow signed-in users to finish org onboarding without the service role.
-- Inserts a default profile if missing, or sets org_setup_complete = true.
-- Role changes stay admin/service-role only.

create or replace function complete_org_setup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  uemail text;
  uname text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select email,
         coalesce(raw_user_meta_data->>'full_name', email)
    into uemail, uname
    from auth.users
   where id = uid;

  insert into profiles (user_id, email, full_name, role, org_setup_complete)
  values (uid, uemail, uname, 'masters', true)
  on conflict (user_id) do update
    set org_setup_complete = true;
end;
$$;

revoke all on function complete_org_setup() from public;
grant execute on function complete_org_setup() to authenticated;
