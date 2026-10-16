-- Migration: explicit sharing + comments (collaboration).
-- Owned by the `sharing` feature module. Builds on the org hierarchy (0015):
-- members auto-see their subtree's milestones/logs; this adds *user-chosen*
-- sharing of specific items (or all of a type) with specific people, plus a
-- lightweight comment thread so a supervisor can leave feedback.
--
-- Design: a generic `shares(owner, recipient, resource_type, resource_id, access)`
-- join table (resource_id NULL = "share everything of that type"), and SECURITY
-- DEFINER helpers OR'd into each table's SELECT via *additional* permissive
-- policies (Postgres ORs permissive policies), so existing owner-only / subtree
-- policies stay untouched. Writes remain owner-only everywhere.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists shares (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) default auth.uid(),
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  resource_type text not null
                  check (resource_type in
                    ('milestone','experiment','report_section','reading_list','paper')),
  resource_id   uuid,               -- NULL = every resource of this type owned by owner_id
  access        text not null default 'comment' check (access in ('view','comment')),
  created_at    timestamptz not null default now()
);
-- One grant per (owner, recipient, type, resource). COALESCE folds the NULL
-- "share everything" row into a stable key so it can't be duplicated.
create unique index if not exists shares_unique_idx on shares
  (owner_id, recipient_id, resource_type,
   coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists shares_recipient_idx on shares (recipient_id, resource_type);

create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references auth.users(id) default auth.uid(),
  resource_type text not null,
  resource_id   uuid not null,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists comments_resource_idx on comments (resource_type, resource_id, created_at);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: read the tables bypassing RLS to avoid
-- recursion, mirroring can_access() from 0015).
-- ---------------------------------------------------------------------------

-- The lab a member belongs to = the root of their supervisor chain (the top
-- professor). Everyone under the same professor is one lab.
create or replace function lab_root(uid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  with recursive up as (
    select user_id, supervisor_id, role from profiles where user_id = uid
    union all
    select p.user_id, p.supervisor_id, p.role
      from profiles p join up on up.supervisor_id = p.user_id
  )
  select coalesce(
    (select user_id from up where supervisor_id is null
       order by (role = 'professor') desc limit 1),
    uid)
$$;

-- Owner of a resource, resolved per type.
create or replace function resource_owner(rtype text, rid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select case rtype
    when 'milestone'      then (select user_id from milestones      where id = rid)
    when 'experiment'     then (select user_id from experiments     where id = rid)
    when 'report_section' then (select user_id from report_sections where id = rid)
    when 'reading_list'   then (select user_id from reading_lists   where id = rid)
    when 'paper'          then (select user_id from papers          where id = rid)
  end
$$;

-- Is this resource shared with the current user (per-item or a blanket grant)?
create or replace function shared_to_me(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from shares s
    where s.recipient_id = auth.uid()
      and s.resource_type = rtype
      and (s.resource_id = rid or s.resource_id is null)
      and s.owner_id = resource_owner(rtype, rid)
  )
$$;

create or replace function shared_to_me_can_comment(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from shares s
    where s.recipient_id = auth.uid()
      and s.resource_type = rtype
      and s.access = 'comment'
      and (s.resource_id = rid or s.resource_id is null)
      and s.owner_id = resource_owner(rtype, rid)
  )
$$;

-- Can the current user view / comment on a resource? Owners always can;
-- supervisors inherit view+comment on their subtree's milestones/logs (the
-- "prof helps student" case); otherwise it's governed by an explicit share.
create or replace function can_view_resource(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when resource_owner(rtype, rid) = auth.uid() then true
    when rtype in ('milestone') and can_access(resource_owner(rtype, rid)) then true
    else shared_to_me(rtype, rid)
  end
$$;

create or replace function can_comment_resource(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when resource_owner(rtype, rid) = auth.uid() then true
    when rtype in ('milestone') and can_access(resource_owner(rtype, rid)) then true
    else shared_to_me_can_comment(rtype, rid)
  end
$$;

-- ---------------------------------------------------------------------------
-- RLS: shares + comments
-- ---------------------------------------------------------------------------
alter table shares enable row level security;
drop policy if exists "shares_owner_all" on shares;
create policy "shares_owner_all" on shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "shares_recipient_select" on shares;
create policy "shares_recipient_select" on shares
  for select using (recipient_id = auth.uid());

alter table comments enable row level security;
drop policy if exists "comments_select_visible" on comments;
create policy "comments_select_visible" on comments
  for select using (can_view_resource(resource_type, resource_id));
drop policy if exists "comments_insert_allowed" on comments;
create policy "comments_insert_allowed" on comments
  for insert with check (author_id = auth.uid() and can_comment_resource(resource_type, resource_id));
drop policy if exists "comments_delete_own" on comments;
create policy "comments_delete_own" on comments
  for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Widen the directory: see everyone in your lab (to pick share recipients).
-- Added as an extra permissive SELECT policy (OR'd with profiles_select_visible).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_lab" on profiles;
create policy "profiles_select_lab" on profiles
  for select using (lab_root(user_id) = lab_root(auth.uid()));

-- ---------------------------------------------------------------------------
-- Sharing read access: one extra permissive SELECT policy per shareable table
-- (OR's with the existing owner/subtree policy — no existing policy touched).
-- ---------------------------------------------------------------------------
drop policy if exists "milestones_select_shared" on milestones;
create policy "milestones_select_shared" on milestones
  for select using (shared_to_me('milestone', id));

drop policy if exists "experiments_select_shared" on experiments;
create policy "experiments_select_shared" on experiments
  for select using (shared_to_me('experiment', id));

drop policy if exists "experiment_metrics_select_shared" on experiment_metrics;
create policy "experiment_metrics_select_shared" on experiment_metrics
  for select using (shared_to_me('experiment', experiment_id));

drop policy if exists "report_sections_select_shared" on report_sections;
create policy "report_sections_select_shared" on report_sections
  for select using (shared_to_me('report_section', id));

drop policy if exists "reading_lists_select_shared" on reading_lists;
create policy "reading_lists_select_shared" on reading_lists
  for select using (shared_to_me('reading_list', id));

drop policy if exists "papers_select_shared" on papers;
create policy "papers_select_shared" on papers
  for select using (shared_to_me('paper', id));
