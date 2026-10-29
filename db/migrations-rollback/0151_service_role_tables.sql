-- Undo 0151 — stop granting new tables to service_role by default.
--
-- Keeps the screening_decisions grant: removing it breaks service-role writes
-- again. Safe to run more than once.

alter default privileges in schema public
  revoke select, insert, update, delete on tables from service_role;
