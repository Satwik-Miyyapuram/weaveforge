-- Rate limiting for share link resolve/redeem RPCs.

create table if not exists share_link_rate_limits (
  bucket text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists share_link_rate_limits_bucket_time
  on share_link_rate_limits (bucket, attempted_at desc);

create or replace function check_share_link_rate(
  p_bucket text,
  p_max_attempts int,
  p_window interval
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from share_link_rate_limits
  where attempted_at < now() - interval '2 hours';

  select count(*) into v_count
  from share_link_rate_limits
  where bucket = p_bucket
    and attempted_at > now() - p_window;

  if v_count >= p_max_attempts then
    raise exception 'Rate limit exceeded. Try again later.';
  end if;

  insert into share_link_rate_limits (bucket, attempted_at)
  values (p_bucket, now());
end;
$$;

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

create or replace function redeem_share_link(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v share_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  perform check_share_link_rate(
    'redeem:' || auth.uid()::text,
    20,
    interval '1 hour'
  );

  select * into v from share_links
  where token_hash = p_token_hash
    and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  insert into shares (owner_id, recipient_id, resource_type, resource_id, access)
  values (v.owner_id, auth.uid(), v.resource_type, v.resource_id, v.access)
  on conflict (owner_id, recipient_id, resource_type,
    coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set access = excluded.access;

  return jsonb_build_object(
    'id', v.id,
    'ownerId', v.owner_id,
    'resourceType', v.resource_type,
    'resourceId', v.resource_id,
    'access', v.access,
    'dekWrap', case when v.dek_wrap is not null then encode(v.dek_wrap, 'base64') else null end,
    'dekEpoch', v.dek_epoch
  );
end;
$$;

grant execute on function check_share_link_rate(text, int, interval) to service_role;
grant execute on function resolve_share_link(bytea) to anon, authenticated;
grant execute on function redeem_share_link(bytea) to authenticated;
