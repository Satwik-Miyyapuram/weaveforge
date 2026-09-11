-- Migration: a registry row must describe a path inside its owner's folder.
--
-- `blob_objects` has two keys that have to agree and did not: `user_id` is the
-- owner the row is filed under (and what every RLS policy checks), while
-- `unique (bucket, path)` is global across all users. The policies from `0023`
-- / `0088` bound only the first:
--
--   CREATE POLICY "blob_objects_insert_own" ON public.blob_objects
--     FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
--
-- A path is not opaque data. It is the key `storage.objects` is addressed by,
-- and the layout is `{ownerId}/{resourceId}/{file}` in every bucket the tiered
-- store writes (see `assertBlobPathOwned`, and the key builders in
-- `vault-asset-store`, `paper-image-store`, `report-image-store` and
-- `experiment-artifact-store`). That is also exactly how the bucket's own RLS
-- binds a path to its owner:
--
--   (storage.foldername(name))[1] = auth.uid()::text
--
-- so the registry was the weak copy of a rule the object store already enforced.
--
-- What the gap bought an attacker: insert one row claiming
-- `'<victim-uid>/<paperId>/fig.webp'` with `user_id` set to the attacker. The
-- global unique key then permanently blocks the victim's own registry insert
-- for the object they actually uploaded — their blob is in R2, but the registry
-- cannot record it, and the tiered read path resolves nothing. A one-request
-- denial, repeatable for any path the attacker can guess, and it needs no
-- sharing and no cooperation from the victim.
--
-- The fix is to make the insert policy assert what the object store asserts:
-- the first path segment is the caller. Both predicates are kept — the row's
-- owner is still the caller, *and* the row's key is inside the caller's folder.
--
-- Update is tightened too, and for the same reason as insert: without it the
-- path binding could be added to insert and simply walked around by inserting a
-- row under one's own key and then renaming it to the victim's.
--
-- Scope: every bucket this app writes uses a user-id prefix, so the check is
-- applied to the whole table rather than to an allowlist of buckets. A bucket
-- that ever needs a different layout has to be named here explicitly, in the
-- same shape as the `shared_as` map in `storage/server/blob-access.ts`, rather
-- than the rule being relaxed for everything.
--
-- Not done deliberately: the same rule as a table CHECK constraint. It would
-- also cover the service role, which is worth having, but it would fail on any
-- legacy row a pre-fix client managed to create — and a failing constraint
-- blocks the whole migration rather than the one bad row. RLS closes the
-- client-facing hole, which is the one that was reachable; a constraint needs a
-- data audit first.
--
-- Reversal: `supabase/migrations-rollback` has none for this one. To undo,
-- re-create the two policies with the `user_id` predicate alone, as `0088` has
-- them.

drop policy if exists "blob_objects_insert_own" on public.blob_objects;
create policy "blob_objects_insert_own" on public.blob_objects
  for insert with check (
    (select auth.uid()) = user_id
    and split_part(path, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "blob_objects_update_own" on public.blob_objects;
create policy "blob_objects_update_own" on public.blob_objects
  for update using (
    (select auth.uid()) = user_id
    and split_part(path, '/', 1) = (select auth.uid())::text
  )
  with check (
    (select auth.uid()) = user_id
    and split_part(path, '/', 1) = (select auth.uid())::text
  );
