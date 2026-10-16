-- Migration: private storage bucket for experiment artifacts (matplotlib figures,
-- plots, small checkpoints). Files live at <user_id>/<experiment_id>/<name>;
-- policies scope every operation to the caller's own top-level folder. The public
-- URL/signed link is appended to `experiments.artifacts`. Owned by the
-- `experiments` module — mirrors the `paper-images` bucket (0013).

insert into storage.buckets (id, name, public)
values ('experiment-artifacts', 'experiment-artifacts', false)
on conflict (id) do nothing;

drop policy if exists "experiment_artifacts_select_own" on storage.objects;
create policy "experiment_artifacts_select_own" on storage.objects
  for select using (
    bucket_id = 'experiment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "experiment_artifacts_insert_own" on storage.objects;
create policy "experiment_artifacts_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'experiment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "experiment_artifacts_delete_own" on storage.objects;
create policy "experiment_artifacts_delete_own" on storage.objects
  for delete using (
    bucket_id = 'experiment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
