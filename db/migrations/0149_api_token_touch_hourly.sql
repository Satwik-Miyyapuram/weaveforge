-- Migration: resolve_api_token writes last_used_at at most once an hour (review 40-10).
--
-- Every SDK request resolves its token, and 0129's resolver ended with an
-- unconditional `update api_tokens set last_used_at = now()`: one row write,
-- and a dead tuple, per API call. The settings screen shows the value as
-- "last used", which an hour's resolution answers just as well.
--
-- Same signature, body and grants as 0129; only the update is guarded.
-- Reversal: db/migrations-rollback/0149_api_token_touch_hourly.sql.

create or replace function public.resolve_api_token(p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_id uuid;
begin
  select id, user_id into v_id, v_user_id
  from api_tokens
  where token_hash = p_token_hash
    -- The scope the SDK routes are for. `mcp_relay`-only tokens are not it,
    -- whatever else they are allowed to do.
    and 'sdk' = any(scopes)
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_id is null then
    return null;
  end if;

  update api_tokens set last_used_at = now()
  where id = v_id
    and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return v_user_id;
end;
$$;

revoke all on function public.resolve_api_token(bytea) from public;
revoke all on function public.resolve_api_token(bytea) from anon;
revoke all on function public.resolve_api_token(bytea) from authenticated;
grant execute on function public.resolve_api_token(bytea) to service_role;
