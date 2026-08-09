-- Retention for `ai_mcp_relay_requests`, a table whose own comment calls it
-- "Short-lived opaque MCP relay envelopes" and which never deleted a row.
--
-- Every MCP tool call writes one row carrying a request envelope and, once
-- answered, a response envelope — both JSONB, both large enough to be TOASTed.
-- Measured on the live database: 71 rows occupying 232 kB, of which 136 kB is
-- TOAST, at ~3.3 kB per row. Nothing ever removed any of them.
--
-- `expires_at` existed and was honoured, but only as a *read-time* verdict: the
-- API reports `status: 'expired'` for a pending row past its deadline and
-- leaves it in place. So the table was already the shape of an append-only log
-- without being treated as one, and it grows with usage rather than with the
-- size of the workspace — the same property that made `experiment_metrics` the
-- table that decides when the volume fills.
--
-- Unlike metric points, none of this is worth keeping. A relay envelope is a
-- transport detail: once the response has been read, or the deadline has
-- passed, the row is of no use to anyone. There is nothing to downsample or
-- compact toward — the right retention is deletion.
--
-- Where it runs: inside `claim_ai_mcp_relay_requests`, which is on the polling
-- path an active session already takes. That mirrors `check_share_link_rate`
-- (migration 0049), which deletes rows older than two hours at the top of every
-- rate check rather than relying on a scheduler this deployment does not have.
--
-- Reversal: supabase/migrations-rollback/0116_ai_mcp_relay_retention.sql

/**
 * Delete relay envelopes that can no longer be read.
 *
 * Two rules, because "finished" and "abandoned" age differently:
 *
 *   * A settled row — complete, cancelled, expired — is dead the moment the
 *     client has had a chance to read it. An hour is generous for that.
 *   * A row that is still pending or claimed is kept until well past its own
 *     `expires_at`, so a slow client is never robbed of a response it is still
 *     waiting for. The grace period is deliberately longer than any sane
 *     request TTL.
 *
 * Security definer so the sweep is not limited to the caller's own rows: an
 * abandoned session's rows would otherwise never be reachable by anyone.
 */
create or replace function purge_ai_mcp_relay_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from ai_mcp_relay_requests
   where (status in ('complete', 'cancelled', 'expired')
          and coalesce(completed_at, created_at) < now() - interval '1 hour')
      or (expires_at < now() - interval '24 hours');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function purge_ai_mcp_relay_requests() from public;
grant execute on function purge_ai_mcp_relay_requests() to authenticated, service_role;

-- Supports the sweep's predicate. Without it the delete is a sequential scan on
-- a table that only exists because it grows.
create index if not exists ai_mcp_relay_requests_retention_idx
  on ai_mcp_relay_requests (status, expires_at);

-- Same function as 0073, with the sweep folded in ahead of the claim. Recreated
-- whole rather than wrapped, so there is one definition to read.
create or replace function claim_ai_mcp_relay_requests(p_session_id uuid, p_limit integer default 5)
returns table (id uuid, request_enc jsonb, expires_at timestamptz)
language plpgsql security invoker set search_path = public as $$
begin
  -- Opportunistic, and deliberately not fatal: a session polling for work must
  -- not fail because a housekeeping delete did.
  begin
    perform purge_ai_mcp_relay_requests();
  exception when others then
    null;
  end;

  return query
  with candidates as (
    select r.id from ai_mcp_relay_requests r
    where r.user_id = (select auth.uid()) and r.session_id = p_session_id
      and r.status = 'pending' and r.expires_at > now()
    order by r.created_at for update skip locked limit greatest(1, least(p_limit, 10))
  )
  update ai_mcp_relay_requests r set status = 'claimed', claimed_at = now()
  from candidates c where r.id = c.id
  returning r.id, r.request_enc, r.expires_at;
end; $$;

grant execute on function claim_ai_mcp_relay_requests(uuid, integer) to authenticated;

comment on table ai_mcp_relay_requests is
  'Short-lived opaque MCP relay envelopes. No plaintext workspace data or pairing secret is stored. Swept by purge_ai_mcp_relay_requests(), called from claim_ai_mcp_relay_requests().';
