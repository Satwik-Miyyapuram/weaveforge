-- Undo 0149 — resolve_api_token writes last_used_at on every call again, as 0129 had it.
--
-- Lossless in data; brings back one row write per SDK request.
-- Safe to run more than once.

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
    and 'sdk' = any(scopes)
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_id is null then
    return null;
  end if;

  update api_tokens set last_used_at = now() where id = v_id;
  return v_user_id;
end;
$$;

revoke all on function public.resolve_api_token(bytea) from public;
revoke all on function public.resolve_api_token(bytea) from anon;
revoke all on function public.resolve_api_token(bytea) from authenticated;
grant execute on function public.resolve_api_token(bytea) to service_role;
