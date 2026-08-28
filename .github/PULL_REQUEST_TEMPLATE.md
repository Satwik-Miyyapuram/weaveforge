## What & why

<!-- What changes, and what problem it solves. Link the issue: Closes #123 -->

## Component

- [ ] Web app (`apps/web`)
- [ ] PDF reader / annotations
- [ ] Core contracts (`packages/core`)
- [ ] Python SDK (`python/`)
- [ ] Database / migrations (`supabase/`)
- [ ] Docs / CI

## Checklist

<!-- CI already runs typecheck, lint, core + web tests, the SOLID/DRY boundary
     checks, and the build. Only what CI cannot see is listed here. -->

- [ ] Tests cover the new behaviour, and would fail without this change
- [ ] No secrets (Supabase keys, tokens, passwords) anywhere in the diff
- [ ] Docs / README / `CHANGELOG.md` updated if behaviour or setup changed
- [ ] Architecture holds: domain and application layers import no Supabase;
      wiring stays in the composition root (see `docs/building/design.md`)

## Database changes

<!-- Delete this section if the PR touches no migrations. -->

- [ ] Migration is **additive and forward-only** — no edits to an already-applied file
- [ ] RLS policies added or reviewed for every new table
- [ ] Says below whether it has been applied to the hosted database

## Breaking changes

<!-- Anything changing an API, a stored shape, or existing behaviour.
     Write "None" if there are none. -->

None.
