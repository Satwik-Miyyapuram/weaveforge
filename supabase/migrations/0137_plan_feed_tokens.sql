-- Plan feed tokens: a calendar subscription link and a widget data link.
--
-- A calendar app cannot send an Authorization header, so the plan feed
-- (`/api/plan/feed/<token>/deadlines.ics` and `widget.json`) carries its
-- credential in the URL. That credential is an ordinary `api_tokens` row with
-- the scope `plan_feed`, minted by the owner through their own session — the
-- `api_tokens_owner_all` policy already allows that — and hashed at rest like
-- every other token.
--
-- The scope is what keeps a leaked calendar link a leaked calendar: this
-- resolver answers for `plan_feed` tokens only, and `resolve_api_token` /
-- `resolve_mcp_relay_token` already refuse anything that is not theirs. The
-- route also checks `api_token_scopes()` before resolving, as the SDK and relay
-- routes do (see `0129`).
--
-- No table change: `scopes` is a `text[]`.
--
-- Reversal: `drop function if exists public.resolve_plan_feed_token(bytea);`
-- and delete rows where `scopes = array['plan_feed']`.

create or replace function public.resolve_plan_feed_token(p_token_hash bytea)
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
    and 'plan_feed' = any(scopes)
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_id is null then
    return null;
  end if;

  -- A calendar polls every hour or so; writing on every poll is churn that
  -- tells the owner nothing an hourly stamp does not.
  update api_tokens set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return v_user_id;
end;
$$;

comment on function public.resolve_plan_feed_token(bytea) is
  'Resolves a ''plan_feed''-scoped API token hash to its user id. Service role only; returns null for any other scope.';

revoke all on function public.resolve_plan_feed_token(bytea) from public;
revoke all on function public.resolve_plan_feed_token(bytea) from anon;
revoke all on function public.resolve_plan_feed_token(bytea) from authenticated;
grant execute on function public.resolve_plan_feed_token(bytea) to service_role;
