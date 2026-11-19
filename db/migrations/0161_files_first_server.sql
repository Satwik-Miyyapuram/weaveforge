-- Files-first (0.9.4) server tables: grants, shared co-edited docs, SDK inbox.
--
-- The relay writes shared_docs with the service role after its own permission
-- check. The save log lives inside the Yjs doc, so there is no save table and
-- no lease epoch. Rows are created before the policies that read them.

-- Who may see which item or project. Owner-only writes, grantee reads its own rows.
create table if not exists grants (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope text not null check (scope in ('item', 'project')),
  target_id text not null,
  grantee_user uuid references auth.users(id) on delete cascade,
  link_hash text,
  permission text not null check (permission in ('view', 'comment', 'edit')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint grants_one_grantee check ((grantee_user is null) <> (link_hash is null))
);

create index if not exists grants_grantee_target_idx
  on grants (grantee_user, target_id) where revoked_at is null;
create index if not exists grants_owner_target_idx on grants (owner, target_id);
create unique index if not exists grants_link_hash_key
  on grants (link_hash) where link_hash is not null;

-- One row per co-edited doc. state is the Yjs v1 update; epoch bumps on restore.
create table if not exists shared_docs (
  item_id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('annotations', 'canvas', 'feed', 'note')),
  project_id text,
  workspace_id text,
  epoch bigint not null default 1 check (epoch >= 1),
  format_version int not null default 1 check (format_version >= 1),
  state bytea not null default ''::bytea,
  updated_at timestamptz not null default now(),
  writer_device text,
  writer_lease_until timestamptz,
  status text not null default 'open' check (status in ('open', 'closing')),
  feed_token_hash text
);

create index if not exists shared_docs_owner_idx on shared_docs (owner);
create index if not exists shared_docs_project_idx
  on shared_docs (project_id) where project_id is not null;
create unique index if not exists shared_docs_feed_token_key
  on shared_docs (feed_token_hash) where feed_token_hash is not null;

create or replace function shared_docs_touch() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shared_docs_touch on shared_docs;
create trigger shared_docs_touch
  before update on shared_docs
  for each row execute function shared_docs_touch();

-- Metrics and artifacts queued by the Python SDK until the device claims them.
create table if not exists sdk_inbox (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  experiment_id text,
  kind text not null check (kind in ('metrics', 'artifacts')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  claimed_by text,
  claimed_until timestamptz
);

create index if not exists sdk_inbox_user_idx on sdk_inbox (user_id, id);

-- Effective access for one user on one doc: 'owner', 'edit', 'comment', 'view' or null.
-- A signed-in caller may only ask about itself; the service role has no uid.
create or replace function shared_doc_access(p_item_id text, p_user uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select x.level
  from (
    select 'owner' as level, 4 as rank
    from shared_docs d
    where d.item_id = p_item_id and d.owner = p_user
    union all
    select g.permission,
           case g.permission when 'edit' then 3 when 'comment' then 2 else 1 end
    from grants g
    join shared_docs d on g.owner = d.owner
    where d.item_id = p_item_id
      and g.grantee_user = p_user
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (
        (g.scope = 'item' and g.target_id = d.item_id)
        or (g.scope = 'project' and d.project_id is not null and g.target_id = d.project_id)
      )
  ) x
  where p_user = coalesce(auth.uid(), p_user)
  order by x.rank desc
  limit 1;
$$;

-- Restore bumps the epoch so open clients rejoin on the new state.
create or replace function shared_doc_restore(p_item_id text, p_kind text, p_state bytea)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_epoch bigint;
begin
  update shared_docs
     set state = p_state,
         kind = p_kind,
         epoch = epoch + 1,
         writer_device = null,
         writer_lease_until = null
   where item_id = p_item_id
  returning epoch into v_epoch;

  if v_epoch is null then
    raise exception 'no shared doc' using errcode = 'P0002';
  end if;
  return v_epoch;
end;
$$;

-- Revoking is idempotent: a second call keeps the first revoked_at.
create or replace function revoke_grant(p_id uuid, p_owner uuid) returns text
language plpgsql
set search_path = public
as $$
declare
  v_target text;
begin
  update grants
     set revoked_at = coalesce(revoked_at, now())
   where id = p_id and owner = p_owner
  returning target_id into v_target;
  return v_target;
end;
$$;

-- Claims are leases: a row stays with one device for 90 seconds unless it renews.
create or replace function sdk_inbox_claim(p_after bigint, p_device text, p_limit int default 100)
returns setof sdk_inbox
language plpgsql
set search_path = public
as $$
begin
  return query
    update sdk_inbox s
       set claimed_by = p_device,
           claimed_until = now() + interval '90 seconds'
     where s.id in (
       select i.id
       from sdk_inbox i
       where i.user_id = auth.uid()
         and i.id > p_after
         and (i.claimed_until is null or i.claimed_until < now() or i.claimed_by = p_device)
       order by i.id
       limit least(greatest(p_limit, 1), 500)
       for update skip locked
     )
    returning s.*;
end;
$$;

alter table grants enable row level security;
alter table shared_docs enable row level security;
alter table sdk_inbox enable row level security;

drop policy if exists grants_owner on grants;
create policy grants_owner on grants
  for all to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

drop policy if exists grants_grantee_read on grants;
create policy grants_grantee_read on grants
  for select to authenticated
  using (auth.uid() = grantee_user);

drop policy if exists shared_docs_read on shared_docs;
create policy shared_docs_read on shared_docs
  for select to authenticated
  using (shared_doc_access(item_id, auth.uid()) is not null);

drop policy if exists sdk_inbox_own on sdk_inbox;
create policy sdk_inbox_own on sdk_inbox
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on grants to authenticated;
grant select on shared_docs to authenticated;
grant select, insert, delete on sdk_inbox to authenticated;
grant update (claimed_by, claimed_until) on sdk_inbox to authenticated;
grant usage on sequence sdk_inbox_id_seq to authenticated;
grant select, insert, update, delete on grants, shared_docs, sdk_inbox to service_role;
grant usage on sequence sdk_inbox_id_seq to service_role;

revoke all on function shared_doc_access(text, uuid) from public, anon;
grant execute on function shared_doc_access(text, uuid) to authenticated, service_role;

revoke all on function shared_doc_restore(text, text, bytea) from public, anon, authenticated;
grant execute on function shared_doc_restore(text, text, bytea) to service_role;

revoke all on function revoke_grant(uuid, uuid) from public, anon, authenticated;
grant execute on function revoke_grant(uuid, uuid) to service_role;

revoke all on function sdk_inbox_claim(bigint, text, int) from public, anon;
grant execute on function sdk_inbox_claim(bigint, text, int) to authenticated;

notify pgrst, 'reload schema';
