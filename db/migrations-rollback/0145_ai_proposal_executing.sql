-- Undo 0145 — restore the 0070 status check without 'executing'.
--
-- A row left 'executing' (an approval in flight, or one whose tab closed
-- mid-run) goes back to 'pending' first so the old check accepts it and the
-- proposal shows in the review queue again. Roll the app back first: an app
-- that claims would fail the restored check on every approval, and the old app
-- can run a proposal twice again.
--
-- Safe to run more than once.

update public.ai_proposals set status = 'pending' where status = 'executing';

-- 0070 declared the check inline, so Postgres named it; drop whichever status
-- check is there rather than trust the generated name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ai_proposals'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.ai_proposals drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.ai_proposals
  add constraint ai_proposals_status_check
  check (status in ('pending', 'accepted', 'rejected', 'conflicted'));
