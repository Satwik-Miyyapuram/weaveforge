-- Org switcher: align lab_root with profiles.active_org_id and let users switch labs.

create or replace function lab_root(uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.owner_id
       from profiles p
       join organizations o on o.id = p.active_org_id
      where p.user_id = uid
        and exists (
          select 1 from org_memberships om
           where om.org_id = p.active_org_id and om.user_id = uid
        )),
    (select o.owner_id
       from org_memberships om
       join organizations o on o.id = om.org_id
      where om.user_id = uid
      order by om.joined_at desc
      limit 1),
    (with recursive up as (
       select user_id, supervisor_id, role from profiles where user_id = uid
       union all
       select p.user_id, p.supervisor_id, p.role
         from profiles p join up on up.supervisor_id = p.user_id
     )
     select user_id from up where supervisor_id is null
       order by (role = 'professor') desc limit 1),
    uid)
$$;

create or replace function switch_active_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m record;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select role, supervisor_id
    into m
    from org_memberships
   where org_id = p_org_id and user_id = uid;

  if not found then
    raise exception 'Not a member of this lab';
  end if;

  update profiles
     set active_org_id = p_org_id,
         role = m.role,
         supervisor_id = m.supervisor_id,
         org_setup_complete = true
   where user_id = uid;
end;
$$;

revoke all on function switch_active_org(uuid) from public;
grant execute on function switch_active_org(uuid) to authenticated;
