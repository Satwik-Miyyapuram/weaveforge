-- service_role can write screening_decisions, and tables added later.
--
-- Same gap as 0150, for tables: the self-host default privileges grant new
-- tables only to `authenticated`, so screening_decisions (created after the
-- blanket grants) refused service-role inserts with
-- "permission denied for table screening_decisions" (seen in seed:showcase).
-- sync_tables and sync_tombstones stay as they are: internal, written by
-- definer triggers only.

grant select, insert, update, delete on public.screening_decisions to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
