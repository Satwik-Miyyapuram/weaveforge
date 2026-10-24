-- Migration: mark the showcase project, so resetting it cannot delete a user's
-- own project that happens to share its name (review 36-18).
--
-- The showcase seeder (apps/web/src/features/showcase/infrastructure/
-- seed-showcase.ts) replaced its project by deleting every project of the user
-- named "MSc Thesis (Showcase)". A user's own project with that name went too,
-- and with it every paper, note and log entry under it, by cascade. The seeder
-- now deletes and creates only rows with `is_showcase = true`.
--
-- Backfill: a row is taken for an earlier showcase project only when it has
-- both the showcase name and the showcase colour (#3b5b8c), which is what the
-- seeder always wrote. Wrongly flagging a user's project would let the next
-- reset delete it, while missing a seeded copy only leaves one stale demo
-- project beside the new one, which the user can delete. So the rule errs
-- towards not flagging.
--
-- Nullable on purpose, and null means "not the showcase". The desktop app runs
-- these migrations on its local database at launch, possibly before the server
-- has them, and the sync puller writes a pulled row with
-- `jsonb_populate_record`, which fills a column the server did not send with
-- null. A `not null` column would reject every project pulled from such a
-- server and stall sync.
--
-- Safe to run more than once. Rollback: db/migrations-rollback/0146_project_showcase_flag.sql.

alter table projects add column if not exists is_showcase boolean default false;

update projects
   set is_showcase = true
 where is_showcase is not true
   and name = 'MSc Thesis (Showcase)'
   and color = '#3b5b8c';
