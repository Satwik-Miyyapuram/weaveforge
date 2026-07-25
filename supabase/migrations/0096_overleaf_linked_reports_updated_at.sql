-- overleaf_linked_reports.updated_at only ever got its insert default, so an
-- edited row kept its original timestamp. The list is ordered by updated_at
-- desc, which meant editing a report visibly sank it down the list.
--
-- Reuses set_updated_at() from 0001, same as papers.

drop trigger if exists overleaf_linked_reports_set_updated_at on overleaf_linked_reports;
create trigger overleaf_linked_reports_set_updated_at
  before update on overleaf_linked_reports
  for each row execute function set_updated_at();
