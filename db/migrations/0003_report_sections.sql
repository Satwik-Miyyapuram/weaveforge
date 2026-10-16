-- Migration: report_sections (thesis report outline)
-- Single source of truth for the report_sections table + Row-Level Security.
-- Owned by the `report` feature module. Self-referencing for chapter > section.

create extension if not exists "pgcrypto";

create table if not exists report_sections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  title         text not null,
  section_no    text,
  parent_id     uuid references report_sections(id) on delete cascade,
  status        text not null default 'not_started'
                  check (status in ('not_started','drafting','review','done')),
  word_count    int  not null default 0 check (word_count >= 0),
  target_words  int  check (target_words >= 0),
  deadline      date,
  draft_url     text,
  notes         text,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists report_sections_user_parent_idx
  on report_sections (user_id, parent_id, sort_order);
create index if not exists report_sections_user_status_idx
  on report_sections (user_id, status);

alter table report_sections enable row level security;

drop policy if exists "report_sections_select_own" on report_sections;
create policy "report_sections_select_own" on report_sections
  for select using (auth.uid() = user_id);

drop policy if exists "report_sections_modify_own" on report_sections;
create policy "report_sections_modify_own" on report_sections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
