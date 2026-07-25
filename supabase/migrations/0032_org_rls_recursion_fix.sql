-- Fix RLS infinite recursion on org_memberships (0028 policies queried the same
-- table they protect). Use SECURITY DEFINER helpers, same pattern as can_access.

create or replace function shares_org_with(viewer uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from org_memberships mine
      join org_memberships peer on peer.org_id = mine.org_id
     where mine.user_id = viewer
       and peer.user_id = target
  );
$$;

create or replace function is_org_member(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_memberships
     where org_id = p_org_id and user_id = p_user_id
  );
$$;

drop policy if exists "profiles_select_lab" on profiles;
create policy "profiles_select_lab" on profiles
  for select using (
    shares_org_with(auth.uid(), user_id)
    or lab_root(user_id) = lab_root(auth.uid())
  );

drop policy if exists "org_memberships_select_lab" on org_memberships;
create policy "org_memberships_select_lab" on org_memberships
  for select using (
    is_org_member(org_id, auth.uid())
    or app_role(auth.uid()) = 'admin'
  );

drop policy if exists "organizations_select_member" on organizations;
create policy "organizations_select_member" on organizations
  for select using (
    is_org_member(id, auth.uid())
    or app_role(auth.uid()) = 'admin'
  );
