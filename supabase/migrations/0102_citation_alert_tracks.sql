-- Citation alert tracks: which library papers to watch for new citing papers.
-- Polling is browser-side (app open / manual refresh); this table stores
-- baseline + seen Semantic Scholar citing-paper ids for deduplication.

create table if not exists citation_alert_tracks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id       uuid not null references projects(id) on delete cascade,
  paper_id         uuid not null references papers(id) on delete cascade,
  tracked_at       timestamptz not null default now(),
  last_checked_at  timestamptz,
  seen_citing_ids  text[] not null default '{}',
  unique (project_id, paper_id)
);

create index if not exists citation_alert_tracks_user_project_idx
  on citation_alert_tracks (user_id, project_id);

alter table citation_alert_tracks enable row level security;

create policy citation_alert_tracks_own on citation_alert_tracks
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table citation_alert_tracks is
  'Per-project citation alert watches; seen_citing_ids dedupe Semantic Scholar citing papers.';
