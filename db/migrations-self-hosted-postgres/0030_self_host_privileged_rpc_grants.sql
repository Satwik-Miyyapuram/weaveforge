-- OCI / self-hosted Postgres only. Applied AFTER 0026_self_host_grants.sql.
--
-- 0026 grants EXECUTE on every function in `public`, and USAGE on every
-- sequence, to authenticated. The deploy script replays it on every
-- `--follow-ups-only` run, which re-opens what
-- db/migrations/0141_privileged_rpc_grants.sql closed. This file closes it
-- again. Keep it in step with sections 1 and 4 of 0141.
--
-- Safe to replay: revoke and grant are idempotent.

revoke execute on function delete_user_account_data(uuid) from public, anon, authenticated;
revoke execute on function check_share_link_rate(text, int, interval) from public, anon, authenticated;
revoke execute on function shared_to_user(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function experiment_metrics_rollup(int, int) from public, anon, authenticated;

grant execute on function delete_user_account_data(uuid) to service_role;
grant execute on function check_share_link_rate(text, int, interval) to service_role;
grant execute on function shared_to_user(text, uuid, uuid) to service_role;
grant execute on function experiment_metrics_rollup(int, int) to service_role;

revoke usage, select, update on sequence experiment_metric_names_id_seq from public, anon, authenticated;
revoke usage, select, update on sequence share_link_rate_limits_id_seq from public, anon, authenticated;
