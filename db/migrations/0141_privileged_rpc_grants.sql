-- Privileged RPCs back to the server, and share-link guessing rate-limited per
-- caller.
--
-- 1. Server-only functions. Each of these is reachable from the browser through
--    PostgREST's /rpc, and none should be:
--      * delete_user_account_data(uuid): security definer with no caller check.
--        Only the admin provisioner calls it, as service_role.
--      * check_share_link_rate(text, int, interval): a signed-in user could fill
--        any bucket, including another caller's. Only the share-link RPCs call
--        it, and they are definer functions, so they run as the owner.
--      * shared_to_user(text, uuid, uuid): answers "is X shared with Y" for any
--        X and Y. Only blob-access.ts calls it, as service_role; no policy does.
--      * experiment_metrics_rollup(int, int): rewrites every user's metric
--        rows. Only scripts/rollup-metric-chunks.mjs calls it, as the owner.
--    `revoke ... from public` (0081, 0115) never removed these: Supabase's
--    default privileges grant EXECUTE to anon and authenticated by name.
--
-- 2. resolve_share_link counted attempts per token, so a guesser trying a new
--    token each time never reached the limit and every attempt left a row.
--    It now counts misses per caller: per user when signed in, and one shared
--    bucket for anon. A hit keeps the old per-token limit. Guessing therefore
--    stops quickly and never blocks somebody opening a link that exists.
--
-- 3. experiment_metric_name_id refuses a new name longer than 256 characters.
--    Names already stored still resolve.
--
-- 4. Sequences. 0114 granted USAGE on every sequence to authenticated. The two
--    below are written only by definer functions, so the grant only let a user
--    burn through them with nextval(). The rest (sync_seq, identity columns of
--    tables users insert into) are needed and keep the grant.
--
-- The self-hosted database replays 0026_self_host_grants.sql, which grants
-- EXECUTE on every function and USAGE on every sequence to authenticated.
-- db/migrations-self-hosted-postgres/0030_self_host_privileged_rpc_grants.sql
-- repeats sections 1 and 4 after it.
--
-- Rollback: db/migrations-rollback/0141_privileged_rpc_grants.sql.

-- 1. -------------------------------------------------------------------------

revoke execute on function delete_user_account_data(uuid) from public, anon, authenticated;
revoke execute on function check_share_link_rate(text, int, interval) from public, anon, authenticated;
revoke execute on function shared_to_user(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function experiment_metrics_rollup(int, int) from public, anon, authenticated;

grant execute on function delete_user_account_data(uuid) to service_role;
grant execute on function check_share_link_rate(text, int, interval) to service_role;
grant execute on function shared_to_user(text, uuid, uuid) to service_role;
grant execute on function experiment_metrics_rollup(int, int) to service_role;

-- 2. -------------------------------------------------------------------------

create or replace function resolve_share_link(p_token_hash bytea)
returns table (
  id uuid,
  owner_id uuid,
  resource_type text,
  resource_id uuid,
  access text,
  dek_wrap bytea,
  dek_epoch int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from share_links sl
  where sl.token_hash = p_token_hash
    and (sl.expires_at is null or sl.expires_at > now());

  if not found then
    -- A refused attempt raises, so its row is never stored: the table holds at
    -- most one hour's allowance per bucket.
    if auth.uid() is null then
      perform check_share_link_rate('resolve-miss:anon', 200, interval '1 hour');
    else
      perform check_share_link_rate('resolve-miss:' || auth.uid()::text, 20, interval '1 hour');
    end if;
    return;
  end if;

  perform check_share_link_rate(
    'resolve:' || encode(p_token_hash, 'hex'),
    30,
    interval '1 hour'
  );

  return query
  select sl.id, sl.owner_id, sl.resource_type, sl.resource_id, sl.access, sl.dek_wrap, sl.dek_epoch
  from share_links sl
  where sl.token_hash = p_token_hash
    and (sl.expires_at is null or sl.expires_at > now());
end;
$$;

grant execute on function resolve_share_link(bytea) to anon, authenticated;

-- 3. -------------------------------------------------------------------------

create or replace function experiment_metric_name_id(p_name text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id int;
begin
  if p_name is null then
    raise exception 'metric name is required';
  end if;

  select id into v_id from experiment_metric_names where name = p_name;
  if v_id is not null then
    return v_id;
  end if;

  if length(p_name) > 256 then
    raise exception 'metric name is too long (% characters, at most 256)', length(p_name);
  end if;

  insert into experiment_metric_names (name) values (p_name)
    on conflict (name) do update set name = excluded.name
    returning id into v_id;
  return v_id;
end;
$$;

-- 4. -------------------------------------------------------------------------

revoke usage, select, update on sequence experiment_metric_names_id_seq from public, anon, authenticated;
revoke usage, select, update on sequence share_link_rate_limits_id_seq from public, anon, authenticated;
