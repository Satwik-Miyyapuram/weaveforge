-- Allow reading lists to include vault notes alongside papers.

alter table reading_list_items
  alter column paper_id drop not null,
  add column if not exists vault_page_id uuid references vault_pages(id) on delete cascade;

alter table reading_list_items drop constraint if exists reading_list_items_list_id_paper_id_key;

alter table reading_list_items
  add constraint reading_list_items_ref_check check (
    (paper_id is not null and vault_page_id is null)
    or (paper_id is null and vault_page_id is not null)
  );

create unique index if not exists reading_list_items_list_paper_uq
  on reading_list_items (list_id, paper_id)
  where paper_id is not null;

create unique index if not exists reading_list_items_list_note_uq
  on reading_list_items (list_id, vault_page_id)
  where vault_page_id is not null;

create index if not exists reading_list_items_note_idx
  on reading_list_items (vault_page_id)
  where vault_page_id is not null;
