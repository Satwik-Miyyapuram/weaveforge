-- Undo 0146 — drop the showcase marker on projects.
--
-- Lossless for user data: the column only marks which project the showcase
-- seeder owns. Reverting brings back review 36-18: a showcase reset deletes
-- every project of the user's with the showcase name. Deploy a seeder that does
-- not write `is_showcase` before running this, or seeding fails.
--
-- Safe to run more than once.

alter table projects drop column if exists is_showcase;
