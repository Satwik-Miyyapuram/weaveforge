-- Shared reading list items + backfill org_memberships from profile hierarchy.

-- Recipients can read items when the parent list is shared with them.
drop policy if exists "reading_list_items_select_shared" on reading_list_items;
create policy "reading_list_items_select_shared" on reading_list_items
  for select using (shared_to_me('reading_list', list_id));

-- One org per lab root (professor) for legacy hierarchy users.
insert into organizations (name, owner_id)
select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Lab') || ' Lab',
       p.user_id
from profiles p
where p.user_id in (select distinct lab_root(user_id) from profiles)
  and not exists (select 1 from organizations o where o.owner_id = p.user_id);

-- Membership rows for everyone in a supervised lab tree (skips unrelated standalone users).
insert into org_memberships (org_id, user_id, role, supervisor_id)
select o.id, pr.user_id, pr.role, pr.supervisor_id
from profiles pr
join organizations o on o.owner_id = lab_root(pr.user_id)
where pr.role in ('professor', 'phd', 'masters')
  and (
    pr.supervisor_id is not null
    or pr.role = 'professor'
    or exists (select 1 from profiles sub where sub.supervisor_id = pr.user_id)
  )
  and not exists (
    select 1 from org_memberships om
    where om.org_id = o.id and om.user_id = pr.user_id
  );

-- Align active org with the backfilled membership when unset.
update profiles p
   set active_org_id = o.id
  from organizations o
 where o.owner_id = lab_root(p.user_id)
   and p.active_org_id is null
   and exists (
     select 1 from org_memberships om
     where om.user_id = p.user_id and om.org_id = o.id
   );
