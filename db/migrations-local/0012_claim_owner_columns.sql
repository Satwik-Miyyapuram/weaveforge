-- Migration: claim every owner column, not only `user_id`.
--
-- screening_decisions owns rows by `reviewer_id`; left on the local user, the
-- server's row-level check refused every adopted insert.
create or replace function sync_claim(p_account uuid, p_local uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  moved integer := 0;
  touched integer;
begin
  insert into auth.users (id) values (p_account) on conflict (id) do nothing;
  for r in
    select c.table_name, c.column_name
      from sync_tables s
      join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = s.table_name
     where c.column_name in ('user_id', 'reviewer_id', 'author_id', 'owner_id')
     order by c.table_name, c.column_name
  loop
    perform set_config('weaveforge.sync_applying', 'on', true);
    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using p_account, p_local;
    get diagnostics touched = row_count;
    perform set_config('weaveforge.sync_applying', 'off', true);
    moved := moved + touched;
  end loop;
  return moved;
end;
$$;

revoke all on function sync_claim(uuid, uuid) from public;

-- Devices adopted before this fix: hand stranded decisions to the account that
-- owns their list item.
do $$
begin
  if to_regclass('public.screening_decisions') is not null then
    perform set_config('weaveforge.sync_applying', 'on', true);
    update screening_decisions d
       set reviewer_id = l.user_id
      from reading_list_items i
      join reading_lists l on l.id = i.list_id
     where d.item_id = i.id
       and d.reviewer_id = '00000000-0000-4000-8000-000000000001'
       and l.user_id <> d.reviewer_id;
    perform set_config('weaveforge.sync_applying', 'off', true);
  end if;
end;
$$;
