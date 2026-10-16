-- Migration: library_pins — recipient UX index for shared resources.
-- Pins do not grant access; shares + RLS do. Pins surface shared items in native lists.

create table if not exists library_pins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id    uuid not null references projects(id) on delete cascade,
  resource_type text not null
                  check (resource_type in
                    ('milestone','experiment','report_section','reading_list','paper')),
  resource_id   uuid not null,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (user_id, project_id, resource_type, resource_id)
);

create index if not exists library_pins_user_project_idx
  on library_pins (user_id, project_id, resource_type);

alter table library_pins enable row level security;

drop policy if exists library_pins_own on library_pins;
create policy library_pins_own on library_pins
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
