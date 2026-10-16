-- Standalone users are not masters students — they track thesis work independently.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('professor', 'phd', 'masters', 'standalone'));

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

  insert into profiles (user_id, email, full_name, role, org_setup_complete, active_org_id)
  values (uid, uemail, uname, 'standalone', true, null)
  on conflict (user_id) do update
    set org_setup_complete = true,
        active_org_id = null,
        role = case
          when profiles.role in ('professor', 'phd', 'masters') then profiles.role
          else 'standalone'
        end;
end;
$$;

revoke all on function complete_org_setup() from public;
grant execute on function complete_org_setup() to authenticated;
