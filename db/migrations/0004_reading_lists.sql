-- Migration: reading_lists + reading_list_items (the reading-graph hierarchy)
-- Single source of truth for both tables + Row-Level Security.
-- Owned by the `reading-lists` feature module.

create extension if not exists "pgcrypto";

-- Nestable named lists (self-referencing parent_id).
create table if not exists reading_lists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  name          text not null,
  description   text,
  parent_id     uuid references reading_lists(id) on delete cascade,
  sort_order    int  not null default 0,
  color         text,
  created_at    timestamptz not null default now()
);

create index if not exists reading_lists_user_parent_idx
  on reading_lists (user_id, parent_id, sort_order);

-- Paper <-> list membership (many-to-many).
create table if not exists reading_list_items (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references reading_lists(id) on delete cascade,
  paper_id      uuid not null references papers(id) on delete cascade,
  sort_order    int  not null default 0,
  note          text,
  unique (list_id, paper_id)
);

create index if not exists reading_list_items_list_idx
  on reading_list_items (list_id, sort_order);
create index if not exists reading_list_items_paper_idx
  on reading_list_items (paper_id);

-- RLS: lists are scoped by user_id directly.
alter table reading_lists enable row level security;

drop policy if exists "reading_lists_select_own" on reading_lists;
create policy "reading_lists_select_own" on reading_lists
  for select using (auth.uid() = user_id);

drop policy if exists "reading_lists_modify_own" on reading_lists;
create policy "reading_lists_modify_own" on reading_lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS: items have no user_id; authorize via the parent list's ownership.
alter table reading_list_items enable row level security;

drop policy if exists "reading_list_items_select_own" on reading_list_items;
create policy "reading_list_items_select_own" on reading_list_items
  for select using (
    exists (
      select 1 from reading_lists l
      where l.id = reading_list_items.list_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "reading_list_items_modify_own" on reading_list_items;
create policy "reading_list_items_modify_own" on reading_list_items
  for all using (
    exists (
      select 1 from reading_lists l
      where l.id = reading_list_items.list_id and l.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from reading_lists l
      where l.id = reading_list_items.list_id and l.user_id = auth.uid()
    )
  );
