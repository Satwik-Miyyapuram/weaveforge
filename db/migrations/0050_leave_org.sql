-- Let members leave a lab (owners must delete the org instead).

create or replace function leave_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner_id uuid;
  next record;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not is_org_member(p_org_id, uid) then
    raise exception 'Not a member of this lab';
  end if;

  select organizations.owner_id into owner_id
    from organizations
   where id = p_org_id;

  if owner_id is null then
    raise exception 'Lab not found';
  end if;

  if owner_id = uid then
    raise exception 'Lab owners cannot leave — delete the lab or transfer ownership first';
  end if;

  delete from org_memberships
   where org_id = p_org_id and user_id = uid;

  select om.org_id, om.role, om.supervisor_id
    into next
    from org_memberships om
   where om.user_id = uid
   order by om.joined_at desc
   limit 1;

  if found then
    update profiles
       set active_org_id = next.org_id,
           role = next.role,
           supervisor_id = next.supervisor_id,
           org_setup_complete = true
     where user_id = uid
       and (active_org_id = p_org_id or active_org_id is null);
  else
    update profiles
       set active_org_id = null,
           supervisor_id = null,
           role = 'masters',
           org_setup_complete = true
     where user_id = uid;
  end if;
end;
$$;

revoke all on function leave_org(uuid) from public;
grant execute on function leave_org(uuid) to authenticated;
