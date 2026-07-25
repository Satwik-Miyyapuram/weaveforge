-- Encrypted, user-owned AI proposal lifecycle. Plaintext proposal payloads,
-- source links, and audit details stay inside content_enc.

create table if not exists ai_proposals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid,
  kind text not null,
  status text not null check (status in ('pending', 'accepted', 'rejected', 'conflicted')),
  resource_type text not null,
  resource_id uuid not null,
  expected_revision text,
  content_enc text not null,
  enc_epoch integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_proposals_owner_status_idx
  on ai_proposals (user_id, status, created_at desc);
create index if not exists ai_proposals_resource_idx
  on ai_proposals (user_id, resource_type, resource_id);

alter table ai_proposals enable row level security;
grant select, insert, update, delete on ai_proposals to authenticated;

create policy "ai_proposals_owner_select" on ai_proposals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_proposals_owner_insert" on ai_proposals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ai_proposals_owner_update" on ai_proposals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "ai_proposals_owner_delete" on ai_proposals
  for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists ai_audit_records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid,
  proposal_id uuid not null references ai_proposals(id) on delete cascade,
  action text not null check (action in ('accepted', 'rejected', 'conflicted')),
  content_enc text not null,
  enc_epoch integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists ai_audit_records_owner_created_idx
  on ai_audit_records (user_id, created_at desc);
create index if not exists ai_audit_records_proposal_idx
  on ai_audit_records (proposal_id);

alter table ai_audit_records enable row level security;
grant select, insert on ai_audit_records to authenticated;

create policy "ai_audit_records_owner_select" on ai_audit_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_audit_records_owner_insert" on ai_audit_records
  for insert to authenticated with check ((select auth.uid()) = user_id);

comment on table ai_proposals is 'AI proposals. Sensitive payload and sources are encrypted in content_enc.';
comment on table ai_audit_records is 'Immutable AI action audit records. Details are encrypted in content_enc.';
