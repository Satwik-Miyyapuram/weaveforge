# Held migrations

Migrations that are written and reviewed but must not run yet, because a
release they depend on has not shipped. Nothing applies this folder: the
migration scripts read `db/migrations/` only.

Each file keeps a number that is free in `db/migrations/`
(`scripts/lib/test/migration-numbers.test.mjs` fails on a clash), and its
header says what it waits for.

## Promoting a held migration

1. Check that what the header waits for has happened.
2. If `db/migrations/` has since used the number, renumber the file (and its
   `.rollback.sql`) to the next free one.
3. Move both files into `db/migrations/` and add a line to its README.
4. Apply it like any migration: ask first, it is a production write.

| File | Waits for |
| --- | --- |
| `0163_legacy_write_revoke.sql` | The 0.9.4 release, with `SDK_INBOX=1` set on the relay first |
