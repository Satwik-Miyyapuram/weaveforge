-- Migration: paper_relations (typed graph edges between papers)
-- Single source of truth for the paper_relations table + Row-Level Security.
-- Owned by the `relations` feature module.

create extension if not exists "pgcrypto";

create table if not exists paper_relations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  from_paper    uuid not null references papers(id) on delete cascade,
  to_paper      uuid not null references papers(id) on delete cascade,
  relation      text not null
                  check (relation in
                    ('cites','extends','contradicts','similar','builds_on','uses_method')),
  note          text,
  source        text not null default 'manual'
                  check (source in ('manual','auto')),
  created_at    timestamptz not null default now(),
  unique (from_paper, to_paper, relation),
  check (from_paper <> to_paper)
);

create index if not exists paper_relations_user_idx on paper_relations (user_id);
create index if not exists paper_relations_from_idx on paper_relations (from_paper);
create index if not exists paper_relations_to_idx on paper_relations (to_paper);

alter table paper_relations enable row level security;

drop policy if exists "paper_relations_select_own" on paper_relations;
create policy "paper_relations_select_own" on paper_relations
  for select using (auth.uid() = user_id);

drop policy if exists "paper_relations_modify_own" on paper_relations;
create policy "paper_relations_modify_own" on paper_relations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
