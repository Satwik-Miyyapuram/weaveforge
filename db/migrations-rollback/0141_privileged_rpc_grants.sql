-- Rollback for db/migrations/0141_privileged_rpc_grants.sql.
--
-- Lossless in data, a regression in security: it hands the server-only RPCs
-- back to signed-in users and lets share-link guessing run unbounded again.
-- On the self-hosted database, also stop applying
-- db/migrations-self-hosted-postgres/0030_self_host_privileged_rpc_grants.sql,
-- or the next `--follow-ups-only` run undoes this rollback.

-- 1. Grants, as they stood after 0130.
grant execute on function delete_user_account_data(uuid) to authenticated;
grant execute on function check_share_link_rate(text, int, interval) to authenticated;
grant execute on function shared_to_user(text, uuid, uuid) to authenticated;
grant execute on function experiment_metrics_rollup(int, int) to anon, authenticated;

-- 2. resolve_share_link counting attempts per token (0049).
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

delete from share_link_rate_limits where bucket like 'resolve-miss:%';

-- 3. experiment_metric_name_id without the length cap (0114).
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

  insert into experiment_metric_names (name) values (p_name)
    on conflict (name) do update set name = excluded.name
    returning id into v_id;
  return v_id;
end;
$$;

-- 4. Sequences (0114 granted usage, select on all of them).
grant usage, select on sequence experiment_metric_names_id_seq to authenticated;
grant usage, select on sequence share_link_rate_limits_id_seq to authenticated;
