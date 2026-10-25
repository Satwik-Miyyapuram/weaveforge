-- Undo 0150 — stop granting new sequences to service_role by default.
--
-- Leaves the grants on existing sequences: 0114 gave service_role the same
-- access to the older ones, and removing sync_seq would break service-role
-- writes again. Safe to run more than once.

alter default privileges in schema public
  revoke usage, select on sequences from service_role;
