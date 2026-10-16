-- Migration: vault_pages (Obsidian-like notes) + vault-assets storage bucket.
-- Markdown bodies live in Postgres; embedded images use the `vault-assets` bucket
-- via the tiered blob layer. Owned by the `vault` feature module.

create table if not exists vault_pages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  project_id  uuid references projects(id) on delete cascade,
  parent_id   uuid references vault_pages(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists vault_pages_user_idx on vault_pages (user_id);
create index if not exists vault_pages_project_idx on vault_pages (project_id);
create index if not exists vault_pages_parent_idx on vault_pages (parent_id);

alter table vault_pages enable row level security;

drop policy if exists "vault_pages_select_own" on vault_pages;
create policy "vault_pages_select_own" on vault_pages
  for select using (auth.uid() = user_id);

drop policy if exists "vault_pages_modify_own" on vault_pages;
create policy "vault_pages_modify_own" on vault_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for embedded vault images: <user_id>/<page_id>/<file>
insert into storage.buckets (id, name, public)
values ('vault-assets', 'vault-assets', false)
on conflict (id) do nothing;

drop policy if exists "vault_assets_select_own" on storage.objects;
create policy "vault_assets_select_own" on storage.objects
  for select using (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vault_assets_insert_own" on storage.objects;
create policy "vault_assets_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vault_assets_delete_own" on storage.objects;
create policy "vault_assets_delete_own" on storage.objects
  for delete using (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Account deletion helper: purge vault pages for the user.
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
  delete from projects where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
end;
$$;
