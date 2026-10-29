-- service_role can use every sequence again, including sync_seq.
--
-- 0114 granted sequences to service_role, but only the ones that existed then.
-- 0118 created sync_seq afterwards, and the default privileges from the
-- self-host grants cover only `authenticated`. So any service-role write to a
-- synced table fails in the sync_stamp trigger with
-- "permission denied for sequence sync_seq" (seen in seed:showcase).
-- App users are `authenticated` and were never affected.

grant usage, select on all sequences in schema public to service_role;

-- Sequences added by later migrations should reach service_role too.
alter default privileges in schema public
  grant usage, select on sequences to service_role;
