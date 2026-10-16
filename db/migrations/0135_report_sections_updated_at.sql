-- Migration: report sections remember when they were last edited.
--
-- The Sections list shows an "Edited" column. report_sections had only
-- created_at, so there was nothing to show. Existing rows start at their
-- creation time; the shared set_updated_at() trigger (0001) keeps it current
-- on every update from any client.

alter table report_sections
  add column if not exists updated_at timestamptz;

update report_sections set updated_at = created_at where updated_at is null;

alter table report_sections
  alter column updated_at set default now(),
  alter column updated_at set not null;

drop trigger if exists report_sections_set_updated_at on report_sections;
create trigger report_sections_set_updated_at
  before update on report_sections
  for each row execute function set_updated_at();
