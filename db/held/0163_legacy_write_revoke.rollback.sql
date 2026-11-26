-- Undo 0163 — restores the direct write grants it recorded in
-- legacy_write_grants_0163 (exactly those held before the revoke, to
-- authenticated or PUBLIC), then drops the record table. Only needed if the
-- 0.9.4 release is rolled back.
-- Safe to run more than once: with no record table it does nothing.

do $$
declare
  r record;
begin
  if to_regclass('public.legacy_write_grants_0163') is not null then
    for r in select grantee, table_name, privilege from public.legacy_write_grants_0163 loop
      if to_regclass('public.' || r.table_name) is not null then
        execute format(
          'grant %s on public.%I to %s',
          r.privilege,
          r.table_name,
          case when r.grantee = 'public' then 'public' else quote_ident(r.grantee) end
        );
      end if;
    end loop;
    drop table public.legacy_write_grants_0163;
  end if;
end $$;

notify pgrst, 'reload schema';
