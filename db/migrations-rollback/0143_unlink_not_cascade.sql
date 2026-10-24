-- Rollback for db/migrations/0143_unlink_not_cascade.sql.
--
-- Puts the three foreign keys back to ON DELETE CASCADE, as 0122 left them.
-- Lossless in data, a regression in behaviour: deleting a supervisor's account
-- deletes their students' profiles and memberships again, and deleting a
-- collaborator's account deletes their edits in shared documents.
--
-- crdt_updates.author_id stays nullable. Edits already unlinked by 0143 have
-- no author, and restoring NOT NULL would mean deleting them.

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
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      target.tbl, target.tbl || '_' || target.col || '_fkey', target.col);
  end loop;
end;
$$;
