-- External share links foundation (LINK_SHARE_PLAN.md).

create table if not exists share_links (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  resource_type text not null,
  resource_id   uuid not null,
  token_hash    bytea not null,
  access        text not null default 'view' check (access in ('view')),
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists share_links_token_hash_idx on share_links (token_hash);

alter table share_links enable row level security;

drop policy if exists "share_links_owner_all" on share_links;
create policy "share_links_owner_all" on share_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Realtime LWW invalidation channel uses existing private broadcast (0044);
-- no extra migration required for proj:{projectId} beyond client wiring.
