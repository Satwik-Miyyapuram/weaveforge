-- Distinguish explicit lab joins from migration 0036 backfill.
-- Standalone users should not appear "in a lab" until they create/join one.

alter table org_memberships
  add column if not exists joined_via text not null default 'legacy'
  check (joined_via in ('legacy', 'invite', 'create'));

-- Undo implicit active-org assignment for backfilled non-owners.
update profiles p
   set active_org_id = null
 where active_org_id is not null
   and exists (
     select 1
       from org_memberships om
      where om.user_id = p.user_id
        and om.org_id = p.active_org_id
        and om.joined_via = 'legacy'
   )
   and not exists (
     select 1
       from organizations o
      where o.id = p.active_org_id
        and o.owner_id = p.user_id
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

  insert into profiles (user_id, email, full_name, role, org_setup_complete, active_org_id)
  values (uid, uemail, uname, 'masters', true, null)
  on conflict (user_id) do update
    set org_setup_complete = true,
        active_org_id = null;
end;
$$;

revoke all on function complete_org_setup() from public;
grant execute on function complete_org_setup() to authenticated;

-- Only switch into labs the user explicitly joined (or owns).
create or replace function switch_active_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m record;
  is_owner boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select om.role, om.supervisor_id, om.joined_via
    into m
    from org_memberships om
   where om.org_id = p_org_id and om.user_id = uid;

  if not found then
    raise exception 'Not a member of this lab';
  end if;

  select exists(
    select 1 from organizations o where o.id = p_org_id and o.owner_id = uid
  ) into is_owner;

  if m.joined_via = 'legacy' and not is_owner then
    raise exception 'Join this lab with an invite code first';
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
