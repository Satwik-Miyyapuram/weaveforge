-- Migration: organization hierarchy (professor -> phd supervisor -> masters)
-- Owned by the `org` feature module.
--
-- Adds a `profiles` table that gives every auth user a role and a link to their
-- supervisor (one level up in the tree). Visibility follows the tree: a member
-- can READ the data of everyone in their own subtree (their supervisees,
-- transitively); admins can read everyone. Writes stay owner-only — supervisors
-- get read-only visibility into their students' work, never edit rights.
--
-- Account creation is enforced server-side (see /api/admin/create-user), but
-- the RLS here is the ultimate gate on who can SEE what.
--
-- BOOTSTRAPPING THE FIRST ADMIN: no admin exists on a fresh database. After
-- running migrations, promote yourself once by hand (service role / SQL editor):
--     update profiles set role = 'admin' where email = 'you@university.edu';
-- From then on, admins provision professors, professors provision PhD
-- supervisors, and PhD supervisors provision masters students, all in-app.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, carrying role + place in the tree.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  role          text not null default 'masters'
                  check (role in ('admin','professor','phd','masters')),
  supervisor_id uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists profiles_supervisor_idx on profiles (supervisor_id);
create index if not exists profiles_role_idx on profiles (role);

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they read `profiles` bypassing RLS —
-- this is what lets RLS policies reference the tree without infinite recursion.
-- ---------------------------------------------------------------------------

-- The role of a given user (null if they have no profile yet).
create or replace function app_role(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where user_id = uid
$$;

-- True if the current user may access data owned by `owner`: it's their own
-- data, they are an admin, or `owner` sits somewhere in their supervisee
-- subtree. Mirrors accessibleMemberIds() in @thesis/core.
create or replace function can_access(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when owner is null then false
    when owner = auth.uid() then true
    when app_role(auth.uid()) = 'admin' then true
    else exists (
      with recursive subtree as (
        select auth.uid() as uid
        union all
        select p.user_id
          from profiles p
          join subtree s on p.supervisor_id = s.uid
      )
      select 1 from subtree where uid = owner
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- profiles RLS: read your own subtree; only admins mutate via the anon client
-- (the create-user API uses the service role, which bypasses RLS entirely).
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "profiles_select_visible" on profiles;
create policy "profiles_select_visible" on profiles
  for select using (can_access(user_id));

drop policy if exists "profiles_modify_admin" on profiles;
create policy "profiles_modify_admin" on profiles
  for all using (app_role(auth.uid()) = 'admin')
  with check (app_role(auth.uid()) = 'admin');

-- ---------------------------------------------------------------------------
-- Auto-provision a default (masters) profile whenever an auth user is created
-- (self-signup / OAuth). Privileged creation upserts the real role afterward.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'masters'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for any users that predate this migration.
insert into profiles (user_id, email, full_name, role)
  select id, email, coalesce(raw_user_meta_data->>'full_name', email), 'masters'
  from auth.users
  on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Broaden SELECT to the whole subtree for the two entities a supervisor is
-- meant to follow: milestones (the plan) and log_entries (the logbook). Nothing
-- else is broadened — papers, reading lists, relations, experiments, report
-- sections, projects, settings, and integrations all stay strictly owner-only.
-- Writes here are untouched (still owner-only via each table's `_modify_own`
-- policy), so supervisor visibility is read-only.
-- ---------------------------------------------------------------------------
drop policy if exists "log_entries_select_own" on log_entries;
create policy "log_entries_select_own" on log_entries
  for select using (can_access(user_id));

drop policy if exists "milestones_select_own" on milestones;
create policy "milestones_select_own" on milestones
  for select using (can_access(user_id));
