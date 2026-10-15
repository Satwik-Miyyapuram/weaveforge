-- Migration: papers (reference module)
-- Single source of truth for the papers table + Row-Level Security.
-- Owned by the `papers` feature module.

create extension if not exists "pgcrypto";

create table if not exists papers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  title         text not null,
  authors       text[]      not null default '{}',
  year          int,
  venue         text,
  doi           text,
  arxiv_id      text,
  url           text,
  pdf_path      text,
  abstract      text,
  summary       text,
  status        text        not null default 'to_read'
                  check (status in ('to_read','reading','read','skimmed')),
  rating        int         check (rating between 1 and 5),
  read_at       date,
  bibtex        text,
  metadata      jsonb       not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Dedupe / lookup helpers (scoped per user).
create unique index if not exists papers_user_arxiv_uniq
  on papers (user_id, arxiv_id) where arxiv_id is not null;
create unique index if not exists papers_user_doi_uniq
  on papers (user_id, doi) where doi is not null;
create index if not exists papers_user_status_idx on papers (user_id, status);

-- Keep updated_at fresh.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists papers_set_updated_at on papers;
create trigger papers_set_updated_at
  before update on papers
  for each row execute function set_updated_at();

-- Row-Level Security: each user sees only their own rows.
alter table papers enable row level security;

drop policy if exists "papers_select_own" on papers;
create policy "papers_select_own" on papers
  for select using (auth.uid() = user_id);

drop policy if exists "papers_modify_own" on papers;
create policy "papers_modify_own" on papers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
