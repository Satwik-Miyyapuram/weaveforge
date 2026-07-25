-- Migration: private storage bucket for paper images (figures, plots).
-- Files live at <user_id>/<paper_id>/<name>.webp; policies scope every
-- operation to the caller's own top-level folder. Owned by the `papers` module.

insert into storage.buckets (id, name, public)
values ('paper-images', 'paper-images', false)
on conflict (id) do nothing;

drop policy if exists "paper_images_select_own" on storage.objects;
create policy "paper_images_select_own" on storage.objects
  for select using (
    bucket_id = 'paper-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "paper_images_insert_own" on storage.objects;
create policy "paper_images_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'paper-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "paper_images_delete_own" on storage.objects;
create policy "paper_images_delete_own" on storage.objects
  for delete using (
    bucket_id = 'paper-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
