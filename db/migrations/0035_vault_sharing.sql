-- Vault page sharing: extend shares, library pins, RLS, and vault-assets blob access.

alter table shares drop constraint if exists shares_resource_type_check;
alter table shares add constraint shares_resource_type_check
  check (resource_type in
    ('milestone','experiment','report_section','reading_list','paper','vault_page'));

alter table library_pins drop constraint if exists library_pins_resource_type_check;
alter table library_pins add constraint library_pins_resource_type_check
  check (resource_type in
    ('milestone','experiment','report_section','reading_list','paper','vault_page'));

create or replace function resource_owner(rtype text, rid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select case rtype
    when 'milestone'      then (select user_id from milestones      where id = rid)
    when 'experiment'     then (select user_id from experiments     where id = rid)
    when 'report_section' then (select user_id from report_sections where id = rid)
    when 'reading_list'   then (select user_id from reading_lists   where id = rid)
    when 'paper'          then (select user_id from papers          where id = rid)
    when 'vault_page'     then (select user_id from vault_pages     where id = rid)
  end
$$;

drop policy if exists "vault_pages_select_shared" on vault_pages;
create policy "vault_pages_select_shared" on vault_pages
  for select using (shared_to_me('vault_page', id));

-- vault-assets path: {ownerId}/{pageId}/{file}
create or replace function vault_page_id_from_path(p text)
returns uuid language plpgsql stable set search_path = public
as $$
declare seg text;
begin
  seg := split_part(p, '/', 2);
  if seg = '' then return null; end if;
  return seg::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "vault_assets_select_shared" on storage.objects;
create policy "vault_assets_select_shared" on storage.objects
  for select using (
    bucket_id = 'vault-assets'
    and vault_page_id_from_path(name) is not null
    and shared_to_me('vault_page', vault_page_id_from_path(name))
  );

create or replace function blob_shared_to_me(b text, p text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when b = 'paper-images' and paper_id_from_image_path(p) is not null
      then shared_to_me('paper', paper_id_from_image_path(p))
    when b = 'vault-assets' and vault_page_id_from_path(p) is not null
      then shared_to_me('vault_page', vault_page_id_from_path(p))
    else false
  end
$$;
