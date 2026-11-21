-- Undo 0162 — puts back the shared_docs_touch() trigger from 0161.
--
-- Safe to run more than once.

create or replace function shared_docs_touch() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shared_docs_set_updated_at on shared_docs;
drop trigger if exists shared_docs_touch on shared_docs;
create trigger shared_docs_touch
  before update on shared_docs
  for each row execute function shared_docs_touch();

notify pgrst, 'reload schema';
