-- Migration: deleting an account removes its sync tombstones (S5).
--
-- sync_tombstones.user_id has no foreign key to auth.users, so 0122's cascade
-- never reached it. A deleted account's tombstones kept its user id and the ids
-- of its deleted rows for good. Tombstones are sync state, not user content:
-- once the owner is gone nobody can read them, so they go with the account.
-- Ownerless tombstones (user_id is null) are left alone; they reveal only a
-- random id.

create or replace function sync_tombstones_purge_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sync_tombstones where user_id = old.id;
  return null;
end;
$$;

revoke all on function sync_tombstones_purge_user() from public, anon;

drop trigger if exists sync_tombstones_purge_user on auth.users;
create trigger sync_tombstones_purge_user
  after delete on auth.users
  for each row execute function sync_tombstones_purge_user();
