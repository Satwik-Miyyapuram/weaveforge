-- Migration: attach the existing `set_updated_at()` trigger to the tables that
-- declare an `updated_at` and never maintain it.
--
-- `0001` created `set_updated_at()` and attached it to `papers`; every table
-- added since that wanted a fresh timestamp attached it explicitly (`0096`,
-- `0106`, `0107`, `0110`, `0112`). Five tables declare the column and were
-- missed, so the value is whatever the client last sent — usually the row's
-- creation default, forever:
--
--   * `vault_pages` (0027)
--   * `user_settings` (0006)
--   * `project_integrations` (0010)
--   * `ai_proposals` (0070)
--   * `overleaf_connections` (0075)
--
-- The review named four of these plus `user_email_recovery_secrets` (0095). The
-- fifth is not fixed here because it no longer exists — `0099` dropped the whole
-- client-E2EE schema and `user_email_recovery_secrets` was in it — so it is
-- left out of the list below rather than kept as a no-op entry that would make
-- the array a lie about what is in the schema.
--
-- `overleaf_connections` is the review's omission and is fixed here: it has the
-- same shape as the others, and the omission is visible in the same file that
-- fixed its sibling — `overleaf_linked_reports` got the trigger in `0096` and
-- the connections table next to it did not.
--
-- Two of these carry a real consequence beyond a stale display value:
--
--   * `vault_pages.updated_at` is read by `listStamps()` for the delta read
--     that decides which pages a client refetches. A value the client supplies
--     can go *backwards* — a second device with a slow clock, or simply a
--     client echoing the timestamp it last read — and a page edited into the
--     past is invisible to the delta. `sync_change_feed` (0118) deliberately
--     does not use `updated_at` as a watermark for exactly that reason; the
--     timestamps that are *not* part of the sync contract should still be the
--     server's.
--   * `overleaf_connections` is ordered by `updated_at desc` (0075's index), so
--     an unchanged timestamp is an arbitrarily-ordered list.
--
-- The trigger is `before update` only, matching `papers`. A row's creation
-- timestamp is the column default, and letting a client set `updated_at` on
-- insert while the server owns it on update would be two rules for one column.
--
-- The companion half of this fix is client-side and in the same commit:
-- `features/vault/infrastructure/vault-page-rows.ts` no longer sends
-- `updated_at`, so the server's value is the only one. The other tables'
-- clients send the column but were not being overridden by anything at all;
-- with the trigger in place their value is ignored, which is what "the server
-- owns it" has to mean.
--
-- Idempotent: `drop trigger if exists` then `create trigger`, so re-running is
-- the same as running.
--
-- Reversal: `drop trigger if exists <table>_set_updated_at on <table>;` for the
-- five tables named above.

do $updated_at_triggers$
declare
  t text;
  -- Written out rather than derived, so the list is greppable and a table added
  -- later has to be added here on purpose.
  tables text[] := array[
    'vault_pages',
    'user_settings',
    'project_integrations',
    'ai_proposals',
    'overleaf_connections'
  ];
begin
  foreach t in array tables loop
    -- A table may have been renamed or dropped by a later migration; skipping
    -- rather than failing keeps a re-run of the whole file safe.
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    -- `public.` on the function: the executing role's search path must not
    -- decide which `set_updated_at` a trigger written here binds to.
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end
$updated_at_triggers$;
