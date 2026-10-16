-- Overleaf-linked reports are intentionally outside the E2EE content path.
-- Tokens are encrypted by the server before storage and are never exposed to
-- the browser or MCP relay. Content is fetched on demand from the provider.

create table if not exists overleaf_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  token_ciphertext   text not null,
  token_prefix       text,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists overleaf_connections_user_idx
  on overleaf_connections (user_id, updated_at desc);

create table if not exists overleaf_linked_reports (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  connection_id       uuid not null references overleaf_connections(id) on delete cascade,
  title               text not null,
  overleaf_project_id text not null,
  entry_file          text not null default 'main.tex',
  external_url        text,
  enabled             boolean not null default true,
  last_fetched_at     timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, overleaf_project_id, entry_file)
);

create index if not exists overleaf_linked_reports_user_idx
  on overleaf_linked_reports (user_id, project_id, updated_at desc);

alter table overleaf_connections enable row level security;
alter table overleaf_linked_reports enable row level security;

drop policy if exists "overleaf_connections_select_own" on overleaf_connections;
create policy "overleaf_connections_select_own" on overleaf_connections
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "overleaf_connections_modify_own" on overleaf_connections;
create policy "overleaf_connections_modify_own" on overleaf_connections
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "overleaf_linked_reports_select_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_select_own" on overleaf_linked_reports
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "overleaf_linked_reports_modify_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_modify_own" on overleaf_linked_reports
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
