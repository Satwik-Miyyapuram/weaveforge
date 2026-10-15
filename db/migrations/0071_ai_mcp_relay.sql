-- Opaque, short-lived browser relay for live MCP. The server never decrypts
-- request_enc or response_enc; encryption is between the local MCP client and
-- the unlocked browser using a per-session pairing secret.
create table if not exists ai_mcp_relay_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  request_enc jsonb not null,
  response_enc jsonb,
  status text not null default 'pending' check (status in ('pending', 'complete', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_mcp_relay_requests_owner_session_idx
  on ai_mcp_relay_requests (user_id, session_id, status, created_at);

alter table ai_mcp_relay_requests enable row level security;
grant select, insert, update on ai_mcp_relay_requests to authenticated;

drop policy if exists "ai_mcp_relay_requests_owner_select" on ai_mcp_relay_requests;
create policy "ai_mcp_relay_requests_owner_select" on ai_mcp_relay_requests
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "ai_mcp_relay_requests_owner_insert" on ai_mcp_relay_requests;
create policy "ai_mcp_relay_requests_owner_insert" on ai_mcp_relay_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "ai_mcp_relay_requests_owner_update" on ai_mcp_relay_requests;
create policy "ai_mcp_relay_requests_owner_update" on ai_mcp_relay_requests
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table ai_mcp_relay_requests is 'Short-lived opaque MCP relay envelopes. No plaintext workspace data or pairing secret is stored.';
