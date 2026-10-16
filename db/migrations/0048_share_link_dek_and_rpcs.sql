-- Share-link DEK wrap + resolve/redeem RPCs (LINK_SHARE_PLAN.md).

alter table share_links
  add column if not exists dek_wrap bytea,
  add column if not exists dek_epoch int;

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
language sql
security definer
set search_path = public
stable
as $$
  select sl.id, sl.owner_id, sl.resource_type, sl.resource_id, sl.access, sl.dek_wrap, sl.dek_epoch
  from share_links sl
  where sl.token_hash = p_token_hash
    and (sl.expires_at is null or sl.expires_at > now());
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
  select * into v from share_links
  where token_hash = p_token_hash
    and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;
  if auth.uid() is null then
    raise exception 'Not authenticated';
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

grant execute on function resolve_share_link(bytea) to anon, authenticated;
grant execute on function redeem_share_link(bytea) to authenticated;
