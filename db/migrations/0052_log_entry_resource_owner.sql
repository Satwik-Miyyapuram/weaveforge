-- log_entry DEKs use resource_keys; ownership must resolve for RLS.

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
    when 'log_entry'      then (select user_id from log_entries     where id = rid)
  end
$$;
