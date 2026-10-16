-- Migration: `resolve_api_token` honours the token's scope.
--
-- `0072` introduced `api_tokens.scopes` and said what it was for, in its own
-- header:
--
--   -- Relay-only tokens cannot authenticate SDK routes. Existing tokens retain
--   -- their SDK scope; MCP tokens receive a separate, revocable scope.
--
-- and delivered half of it. `resolve_mcp_relay_token()` filters on
-- `'mcp_relay' = any(scopes)`; `resolve_api_token()` — the resolver every SDK
-- route goes through, via `requireSdkUser` — filtered only on expiry:
--
--   where token_hash = p_token_hash
--     and (expires_at is null or expires_at > now())
--
-- A relay token is minted with `scopes: ['mcp_relay']` and `expires_at: null`
-- (`api-token-service.ts`), and it is handed to third-party MCP client
-- software by design. Because it also satisfied the SDK resolver, that token —
-- sitting in someone else's config file — authenticated `GET
-- /api/settings/credentials` (decrypted Zotero and Semantic Scholar keys),
-- `/api/sdk/artifacts` and `/api/sdk/experiments`. The scope the relay token
-- was supposed to be confined to did not exist.
--
-- The predicate is one line, and it is the same one the relay resolver already
-- uses. Legitimately-created SDK tokens are unaffected: `createToken()` writes
-- `scopes: ["sdk"]`, and `0072` backfilled every pre-existing token to
-- `array['sdk']`, so nothing that used to work stops working.
--
-- ## The grants, and why `from anon` is named explicitly
--
-- `create or replace` preserves a function's existing ACL, and both of these
-- already exist, so the revokes below are re-issued only to make this file
-- self-contained and to state the intended end state in one place. They name
-- `anon` as well as `public` because `revoke … from public` does not remove the
-- `anon` entry that `alter default privileges` puts on new functions in this
-- schema — see the measurement in `0123_function_execute_grants.sql`.
-- `api_token_scopes` is genuinely new here, so for it the `from anon` revoke is
-- load-bearing rather than a restatement: without it a brand-new definer
-- function would be callable by an anonymous client.
--
-- ## The TypeScript half
--
-- `apps/web/src/app/api/sdk/_shared.ts` reads the token's scopes through
-- `api_token_scopes()` below and refuses before any JWT is minted — one check
-- per surface, `'sdk'` for the SDK routes and `'mcp_relay'` for the relay, so
-- neither accepts the other's token. That is deliberately a second check rather
-- than the only one: `create or replace` replaces a function's whole body, so a
-- future edit that drops this predicate would silently re-open the seam while
-- the application went on behaving exactly as it does today.
--
-- Reversal: re-create `resolve_api_token` as `0061` has it, without the
-- `scopes` predicate, and `drop function if exists public.api_token_scopes(bytea);`

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

  update api_tokens set last_used_at = now() where id = v_id;
  return v_user_id;
end;
$$;

comment on function public.resolve_api_token(bytea) is
  'Resolves an ''sdk''-scoped API token hash to its user id. Service role only; returns null for any other scope.';

revoke all on function public.resolve_api_token(bytea) from public;
revoke all on function public.resolve_api_token(bytea) from anon;
revoke all on function public.resolve_api_token(bytea) from authenticated;
grant execute on function public.resolve_api_token(bytea) to service_role;

/**
 * The scopes stored for one token hash, and nothing else.
 *
 * Exists so the application can make this decision independently of
 * `resolve_api_token`. A token hash is resolved through an RPC everywhere in
 * this schema — `bytea` never travels in a PostgREST query filter, and nor does
 * it in `resolve_api_token`, `resolve_mcp_relay_token` or the share-link
 * resolvers — so the TypeScript check needs something to read the row through,
 * and giving it its own function means one later edit cannot weaken both halves
 * at once.
 *
 * It resolves a hash to a scope list, not to a user: it grants no access by
 * itself, and a caller that could reach it directly would still need the token.
 * Service role only, like both resolvers.
 */
create or replace function public.api_token_scopes(p_token_hash bytea)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select scopes from api_tokens where token_hash = p_token_hash limit 1
$$;

comment on function public.api_token_scopes(bytea) is
  'The scope list stored for one API token hash, or null when there is no such token. Service role only.';

revoke all on function public.api_token_scopes(bytea) from public;
revoke all on function public.api_token_scopes(bytea) from anon;
revoke all on function public.api_token_scopes(bytea) from authenticated;
grant execute on function public.api_token_scopes(bytea) to service_role;
