-- Relay-only tokens cannot authenticate SDK routes. Existing tokens retain
-- their SDK scope; MCP tokens receive a separate, revocable scope.
alter table api_tokens add column if not exists scopes text[] not null default array['sdk']::text[];
update api_tokens set scopes = array['sdk']::text[] where scopes is null or cardinality(scopes) = 0;

create or replace function resolve_mcp_relay_token(p_token_hash bytea)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user_id uuid; v_id uuid;
begin
  select id, user_id into v_id, v_user_id from api_tokens
  where token_hash = p_token_hash and 'mcp_relay' = any(scopes)
    and (expires_at is null or expires_at > now()) limit 1;
  if v_user_id is null then return null; end if;
  update api_tokens set last_used_at = now() where id = v_id;
  return v_user_id;
end; $$;
revoke all on function resolve_mcp_relay_token(bytea) from public;
grant execute on function resolve_mcp_relay_token(bytea) to service_role;
