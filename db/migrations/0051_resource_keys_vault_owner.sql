-- Fix resource_keys upsert conflicts and reassert vault_page ownership lookup.

create or replace function resource_owner(rtype text, rid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select case rtype
    when 'milestone'      then (select user_id from milestones      where id = rid)
    when 'experiment'     then (select user_id from experiments     where id = rid)
    when 'report_section' then (select user_id from report_sections where id = rid)
    when 'reading_list'   then (select user_id from reading_lists   where id = rid)
    when 'paper'          then (select user_id from papers          where id = rid)
    when 'vault_page'     then (select user_id from vault_pages     where id = rid)
  end
$$;

-- Allow recipients with edit shares to read DEKs (insert remains owner-only).
drop policy if exists "resource_keys_shared_select" on resource_keys;
create policy "resource_keys_shared_select" on resource_keys
  for select using (
    shared_to_me(resource_type, resource_id)
    or shared_to_me_can_edit(resource_type, resource_id)
  );
