-- Cover foreign-key columns reported by Supabase advisors. These indexes
-- improve joins, ownership checks, and delete/update cascades without changing
-- access semantics.
create index if not exists comments_author_id_idx
  on comments (author_id);
create index if not exists crdt_updates_author_id_idx
  on crdt_updates (author_id);
create index if not exists crdt_updates_project_id_idx
  on crdt_updates (project_id);
create index if not exists experiment_metrics_user_id_idx
  on experiment_metrics (user_id);
create index if not exists experiments_related_paper_idx
  on experiments (related_paper);
create index if not exists library_pins_owner_id_idx
  on library_pins (owner_id);
create index if not exists library_pins_project_id_idx
  on library_pins (project_id);
create index if not exists org_memberships_supervisor_id_idx
  on org_memberships (supervisor_id);
create index if not exists profiles_active_org_id_idx
  on profiles (active_org_id);
create index if not exists project_key_wraps_granter_id_idx
  on project_key_wraps (granter_id);
create index if not exists reading_list_items_inherited_from_list_id_idx
  on reading_list_items (inherited_from_list_id);
create index if not exists reading_lists_parent_id_idx
  on reading_lists (parent_id);
create index if not exists report_sections_parent_id_idx
  on report_sections (parent_id);
create index if not exists resource_key_wraps_granter_id_idx
  on resource_key_wraps (granter_id);
create index if not exists share_links_owner_id_idx
  on share_links (owner_id);
