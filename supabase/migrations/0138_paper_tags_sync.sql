-- Migration: sync paper_tags through the change feed.
--
-- paper_tags has a composite key and the sync path addresses rows by `id`, so
-- the id is derived from that key: every device computes the same one.
alter table paper_tags
  add column if not exists id uuid
  generated always as (md5(paper_id::text || ':' || tag_id::text || ':' || source)::uuid) stored;
create unique index if not exists paper_tags_id_key on paper_tags (id);

insert into sync_tables (table_name) values ('paper_tags') on conflict (table_name) do nothing;
select sync_prepare();

-- paper_tags has no user_id: a delete's tombstone is owned by the paper's owner.
create or replace function sync_tombstone() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := (to_jsonb(old) ->> 'user_id')::uuid;
begin
  if owner is null and tg_table_name = 'reading_list_items' then
    select l.user_id into owner from reading_lists l where l.id = (to_jsonb(old) ->> 'list_id')::uuid;
  elsif owner is null and tg_table_name = 'paper_tags' then
    select p.user_id into owner from papers p where p.id = (to_jsonb(old) ->> 'paper_id')::uuid;
  end if;
  insert into sync_tombstones (table_name, row_id, user_id)
  values (tg_table_name, old.id, owner)
  on conflict (table_name, row_id) do update
    set user_id = excluded.user_id,
        server_seq = nextval('sync_seq'),
        deleted_at = now();
  return null;
end;
$$;

revoke all on function sync_tombstone() from public, anon;

drop trigger if exists paper_tags_sync_tombstone on paper_tags;
create trigger paper_tags_sync_tombstone after delete on paper_tags
  for each row execute function sync_tombstone();
drop trigger if exists paper_tags_sync_untombstone on paper_tags;
create trigger paper_tags_sync_untombstone after insert on paper_tags
  for each row execute function sync_untombstone();

-- Existing links get a real watermark so a first pull sees them.
select set_config('session_replication_role', 'replica', true);
update paper_tags set server_seq = nextval('sync_seq') where server_seq is null or server_seq = 0;
select set_config('session_replication_role', 'origin', true);
