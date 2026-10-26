-- Undo 0152 — drop the folder flag from vault pages.
--
-- Pages that held pages still read as folders without it. Safe to run more
-- than once. Roll back clients first: a client that sends is_folder fails
-- every note write once the column is gone.

alter table vault_pages
  drop column if exists is_folder;
