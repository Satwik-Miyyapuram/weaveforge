-- Migration: let a device apply a row the server already numbered.
--
-- `sync_stamp` assigns a new `server_seq` on every write. On the server that is
-- exactly right. On a device applying a row it pulled from the change feed it
-- is wrong twice over: the row's watermark would be replaced by a number from
-- the device's own sequence, and the device would then either re-send the row
-- as though it were a local edit or skip changes it never actually read.
--
-- So the stamp steps aside when the write is an apply. The flag is
-- transaction-local and set only by `sync_apply` (see
-- supabase/migrations-local), which means a session cannot leave it on and a
-- concurrent statement cannot see it. On the server nothing ever sets it, so
-- this is a no-op there — which is the point: one definition of the trigger,
-- not one per deployment.
create or replace function sync_stamp() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('weaveforge.sync_applying', true), '') = 'on' then
    return new;
  end if;
  new.server_seq := nextval('sync_seq');
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;
