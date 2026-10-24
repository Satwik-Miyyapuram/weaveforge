-- Migration: an AI proposal runs once (review 02-01).
--
-- Approving a proposal read it, checked it was pending, ran its executor and
-- then saved the outcome. Two approvals at once (a double click, two tabs) both
-- passed the check, so the executor ran twice and a note was appended twice.
--
-- The app now claims the row first with one conditional update,
-- `status = 'executing' where status = 'pending'`; only the caller that gets the
-- row back runs the executor. If the executor throws, the row goes back to
-- 'pending' so it can be retried. This migration only widens the status check
-- (0070) to allow 'executing'.
--
-- Proposals already pending keep working unchanged. Safe to run more than once.

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
  check (status in ('pending', 'executing', 'accepted', 'rejected', 'conflicted'));
