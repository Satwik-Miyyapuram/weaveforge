-- Backfill: users without an explicit lab membership are standalone (not masters/phd/professor).

update profiles p
   set role = 'standalone',
       supervisor_id = null,
       active_org_id = null
 where p.role <> 'standalone'
   and not exists (
     select 1
       from org_memberships om
      where om.user_id = p.user_id
        and om.joined_via in ('invite', 'create')
   )
   and not exists (
     select 1 from organizations o where o.owner_id = p.user_id
   );

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

  insert into profiles (user_id, email, full_name, role, org_setup_complete, active_org_id, supervisor_id)
  values (uid, uemail, uname, 'standalone', true, null, null)
  on conflict (user_id) do update
    set org_setup_complete = true,
        active_org_id = null,
        supervisor_id = null,
        role = 'standalone';
end;
$$;

revoke all on function complete_org_setup() from public;
grant execute on function complete_org_setup() to authenticated;
