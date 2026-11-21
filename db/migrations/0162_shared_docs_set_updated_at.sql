-- Migration: shared_docs keeps updated_at with the shared set_updated_at() trigger.
--
-- 0161 gave shared_docs its own shared_docs_touch() trigger. It does the same
-- thing as set_updated_at() (0001), but every table with updated_at is meant to
-- use the one shared function, so the schema check can find a table that has
-- none. No behaviour changes: updated_at is still set to now() on every update.

drop trigger if exists shared_docs_touch on shared_docs;
drop trigger if exists shared_docs_set_updated_at on shared_docs;
create trigger shared_docs_set_updated_at
  before update on shared_docs
  for each row execute function set_updated_at();

drop function if exists shared_docs_touch();

notify pgrst, 'reload schema';
