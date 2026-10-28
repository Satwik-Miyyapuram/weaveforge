-- Migration: comments on a sent check-in (lab snapshot), design D-23 / D24.
--
-- A student sends their supervisor a check-in, and the supervisor had nowhere
-- to answer it: comments resolve their owner through resource_owner (0052),
-- which did not know 'lab_snapshot', so every insert failed the RLS check.
--
-- The supervisor already reads the snapshot itself through can_access (0108's
-- select policy), so view and comment follow the same rule as a milestone: the
-- owner, or anyone above them in the supervisor tree. All three functions keep
-- their signatures, so `create or replace` keeps the grants from 0079.

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
    when 'lab_snapshot'   then (select user_id from lab_snapshots   where id = rid)
  end
$$;

create or replace function can_view_resource(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when resource_owner(rtype, rid) = auth.uid() then true
    when rtype in ('milestone', 'lab_snapshot') and can_access(resource_owner(rtype, rid)) then true
    else shared_to_me(rtype, rid)
  end
$$;

create or replace function can_comment_resource(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when resource_owner(rtype, rid) = auth.uid() then true
    when rtype in ('milestone', 'lab_snapshot') and can_access(resource_owner(rtype, rid)) then true
    else shared_to_me_can_comment(rtype, rid)
  end
$$;
