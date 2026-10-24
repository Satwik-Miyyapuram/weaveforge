-- Deleting an account unlinks the rows that only name the user, instead of
-- deleting them.
--
-- 0122 turned every foreign key to auth.users into ON DELETE CASCADE, so an
-- account's deletion could never be blocked. That loop also caught columns
-- that point at somebody else's row:
--
--   profiles.supervisor_id, org_memberships.supervisor_id
--     Were `on delete set null` (0015, 0028). Deleting a supervisor's account
--     deleted their students' profiles and lab memberships.
--   crdt_updates.author_id
--     An edit in a shared document. Deleting a collaborator's account deleted
--     their edits that were not yet compacted, so the document lost content.
--     The edit stays, without an author. The insert policy still requires
--     author_id = auth.uid(), so a new edit cannot be written without one.
--
-- comments.author_id stays cascade: delete_user_account_data deletes the
-- user's comments by design. Any future sweep must touch only
-- confdeltype in ('a', 'r'). Review row 40-01.
--
-- Rollback: db/migrations-rollback/0143_unlink_not_cascade.sql.

alter table crdt_updates alter column author_id drop not null;

do $$
declare
  target record;
  c record;
begin
  for target in
    select * from (values
      ('profiles', 'supervisor_id'),
      ('org_memberships', 'supervisor_id'),
      ('crdt_updates', 'author_id')
    ) as t (tbl, col)
  loop
    for c in
      select con.conname
        from pg_constraint con
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
       where con.contype = 'f'
         and con.conrelid = format('public.%I', target.tbl)::regclass
         and con.confrelid = 'auth.users'::regclass
         and att.attname = target.col
    loop
      execute format('alter table public.%I drop constraint %I', target.tbl, c.conname);
    end loop;
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      target.tbl, target.tbl || '_' || target.col || '_fkey', target.col);
  end loop;
end;
$$;
