-- Remove the legacy admin role; existing admins become professors.

update profiles set role = 'professor' where role = 'admin';

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('professor', 'phd', 'masters'));

create or replace function can_access(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when owner is null then false
    when owner = auth.uid() then true
    else exists (
      with recursive subtree as (
        select auth.uid() as uid
        union all
        select p.user_id
          from profiles p
          join subtree s on p.supervisor_id = s.uid
      )
      select 1 from subtree where uid = owner
    )
  end
$$;

drop policy if exists "profiles_modify_admin" on profiles;

drop policy if exists "organizations_select_member" on organizations;
create policy "organizations_select_member" on organizations
  for select using (is_org_member(id, auth.uid()));

drop policy if exists "org_memberships_select_lab" on org_memberships;
create policy "org_memberships_select_lab" on org_memberships
  for select using (is_org_member(org_id, auth.uid()));
