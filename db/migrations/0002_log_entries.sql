-- Migration: log_entries (daily / weekly logbook)
-- Single source of truth for the log_entries table + Row-Level Security.
-- Owned by the `logbook` feature module.

create extension if not exists "pgcrypto";

create table if not exists log_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  entry_date    date        not null default current_date,
  kind          text        not null default 'daily'
                  check (kind in ('daily','weekly')),
  body          text        not null,
  links         jsonb       not null default '[]',
  created_at    timestamptz not null default now()
);

-- Lookup helpers (scoped per user).
create index if not exists log_entries_user_date_idx
  on log_entries (user_id, entry_date desc);
create index if not exists log_entries_user_kind_idx
  on log_entries (user_id, kind);

-- Row-Level Security: each user sees only their own rows.
alter table log_entries enable row level security;

drop policy if exists "log_entries_select_own" on log_entries;
create policy "log_entries_select_own" on log_entries
  for select using (auth.uid() = user_id);

drop policy if exists "log_entries_modify_own" on log_entries;
create policy "log_entries_modify_own" on log_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
