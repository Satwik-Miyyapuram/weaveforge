-- Migration: organizations + Crockford invite codes (Teams-style lab join).
-- Three codes per org: professor, phd, masters. Multi-org membership supported.

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists organizations_owner_idx on organizations (owner_id);

create table if not exists org_memberships (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('professor','phd','masters')),
  supervisor_id uuid references auth.users(id) on delete set null,
  joined_at     timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists org_memberships_org_idx on org_memberships (org_id);
create index if not exists org_memberships_user_idx on org_memberships (user_id);

create table if not exists org_invite_codes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  target_role   text not null check (target_role in ('professor','phd','masters')),
  code_hash     text not null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  use_count     int not null default 0
);

create unique index if not exists org_invite_codes_hash_idx on org_invite_codes (code_hash);
create unique index if not exists org_invite_codes_active_role_idx
  on org_invite_codes (org_id, target_role)
  where revoked_at is null;

alter table profiles
  add column if not exists org_setup_complete boolean not null default true,
  add column if not exists active_org_id uuid references organizations(id) on delete set null;

-- Existing users keep access; only new signups must complete org setup.
update profiles set org_setup_complete = true;

alter table profiles alter column org_setup_complete set default false;

-- Lab root prefers org owner when user has a membership.
create or replace function lab_root(uid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select o.owner_id
       from org_memberships om
       join organizations o on o.id = om.org_id
      where om.user_id = uid
      order by om.joined_at desc
      limit 1),
    (with recursive up as (
       select user_id, supervisor_id, role from profiles where user_id = uid
       union all
       select p.user_id, p.supervisor_id, p.role
         from profiles p join up on up.supervisor_id = p.user_id
     )
     select user_id from up where supervisor_id is null
       order by (role = 'professor') desc limit 1),
    uid)
$$;

drop policy if exists "profiles_select_lab" on profiles;
create policy "profiles_select_lab" on profiles
  for select using (
    exists (
      select 1 from org_memberships mine
      join org_memberships peer on peer.org_id = mine.org_id
      where mine.user_id = auth.uid() and peer.user_id = profiles.user_id
    )
    or lab_root(user_id) = lab_root(auth.uid())
  );

alter table organizations enable row level security;
alter table org_memberships enable row level security;
alter table org_invite_codes enable row level security;

drop policy if exists "organizations_select_member" on organizations;
create policy "organizations_select_member" on organizations
  for select using (
    exists (
      select 1 from org_memberships om
      where om.org_id = organizations.id and om.user_id = auth.uid()
    )
    or app_role(auth.uid()) = 'admin'
  );

drop policy if exists "org_memberships_select_lab" on org_memberships;
create policy "org_memberships_select_lab" on org_memberships
  for select using (
    exists (
      select 1 from org_memberships mine
      where mine.org_id = org_memberships.org_id and mine.user_id = auth.uid()
    )
    or app_role(auth.uid()) = 'admin'
  );

-- Codes are server-only (service role); no client policies on org_invite_codes.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, email, full_name, role, org_setup_complete)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'masters',
    false
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.delete_user_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;

  delete from comments where author_id = p_user_id;
  delete from shares where owner_id = p_user_id or recipient_id = p_user_id;
  delete from blob_objects where user_id = p_user_id;
  delete from vault_pages where user_id = p_user_id;
  delete from org_invite_codes where org_id in (select id from organizations where owner_id = p_user_id);
  delete from org_memberships where user_id = p_user_id or org_id in (select id from organizations where owner_id = p_user_id);
  delete from organizations where owner_id = p_user_id;
  delete from projects where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
end;
$$;
