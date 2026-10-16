-- Harden share_link_rate_limits: cleanup index, restrict direct function grants.
-- (RLS disabled — rate-limit rows are ephemeral; definer RPC must insert.)

create index if not exists share_link_rate_limits_attempted_at
  on share_link_rate_limits (attempted_at);

revoke all on function check_share_link_rate(text, int, interval) from public;
grant execute on function check_share_link_rate(text, int, interval) to service_role;
