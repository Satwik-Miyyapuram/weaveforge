alter table ai_mcp_relay_requests
  drop constraint if exists ai_mcp_relay_requests_status_check;
alter table ai_mcp_relay_requests
  add constraint ai_mcp_relay_requests_status_check
  check (status in ('pending', 'claimed', 'complete', 'cancelled', 'expired'));
alter table ai_mcp_relay_requests add column if not exists claimed_at timestamptz;

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
