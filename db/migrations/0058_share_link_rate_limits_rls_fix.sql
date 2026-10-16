-- 0056 enabled RLS on share_link_rate_limits without policies, which blocked
-- inserts from the security-definer check_share_link_rate RPC.

alter table share_link_rate_limits disable row level security;
