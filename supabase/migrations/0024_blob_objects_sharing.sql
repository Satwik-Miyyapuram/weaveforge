-- Migration: allow shared paper recipients to read blob registry rows for paper images.
-- Path format: paper-images → {ownerId}/{paperId}/{file} (see PaperImageStore).

create or replace function paper_id_from_image_path(p text)
returns uuid language plpgsql stable set search_path = public
as $$
declare
  seg text;
begin
  seg := split_part(p, '/', 2);
  if seg = '' then return null; end if;
  return seg::uuid;
exception when others then
  return null;
end;
$$;

-- Explicit recipient (server-side checks). shared_to_me() uses auth.uid().
create or replace function shared_to_user(rtype text, rid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from shares s
    where s.recipient_id = uid
      and s.resource_type = rtype
      and (s.resource_id = rid or s.resource_id is null)
      and s.owner_id = resource_owner(rtype, rid)
  )
$$;

create or replace function blob_shared_to_me(b text, p text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when b <> 'paper-images' then false
    when paper_id_from_image_path(p) is null then false
    else shared_to_me('paper', paper_id_from_image_path(p))
  end
$$;

drop policy if exists "blob_objects_select_shared" on blob_objects;
create policy "blob_objects_select_shared" on blob_objects
  for select using (blob_shared_to_me(bucket, path));
