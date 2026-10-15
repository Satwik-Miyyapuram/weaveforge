-- Undo 0116 — stop sweeping `ai_mcp_relay_requests`.
--
-- Restores `claim_ai_mcp_relay_requests` to its 0073 definition and drops the
-- sweep. Rows already deleted do not come back; they were settled or long
-- expired envelopes, and there is nothing in them to restore.
--
-- Safe to run more than once.

create or replace function claim_ai_mcp_relay_requests(p_session_id uuid, p_limit integer default 5)
returns table (id uuid, request_enc jsonb, expires_at timestamptz)
language plpgsql security invoker set search_path = public as $$
begin
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

drop function if exists purge_ai_mcp_relay_requests();
drop index if exists ai_mcp_relay_requests_retention_idx;

comment on table ai_mcp_relay_requests is
  'Short-lived opaque MCP relay envelopes. No plaintext workspace data or pairing secret is stored.';
