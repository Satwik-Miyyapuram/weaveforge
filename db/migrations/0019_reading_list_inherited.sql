-- Track list memberships propagated from descendant lists (for "via sublist" UI).
alter table reading_list_items
  add column if not exists inherited_from_list_id uuid references reading_lists(id) on delete set null;
