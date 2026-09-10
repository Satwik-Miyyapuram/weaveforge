-- Migration: every reference to auth.users goes when the user does.
--
-- `delete_user_account_data` deletes what it knows about, then the auth user
-- is deleted. Tables added since — and rows in older tables that hang off no
-- project — still point at auth.users with a plain foreign key, so that final
-- delete fails and the account survives its own deletion. Cascade is the
-- honest rule: nothing owned by a user outlives the user.

do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tbl, att.attname as col
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.confdeltype <> 'c'
       and cardinality(con.conkey) = 1
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      c.tbl, c.conname, c.col);
  end loop;
end;
$$;
