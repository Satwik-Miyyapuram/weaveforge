# Contributing

Thanks for your interest in improving Thesis Tracker. It's AGPL-3.0-only licensed throughout — see [LICENSE](../LICENSE) — and
designed to be reused and extended.

## Ground rules

- **Follow the design doc.** `docs/DESIGN.md` defines the modular + SOLID structure.
  New features arrive as new *feature modules* (`features/<name>/{domain,application,infrastructure,ui}`),
  not as edits scattered across existing ones.
- **Read the extension guide.** [`docs/extensions.md`](docs/extensions.md) lists every seam you can plug into today
  (integrations, metadata sources, feature modules, backend/storage, Python sync) and what still requires a PR.
- **Depend on interfaces, not implementations.** Domain and application code must not
  import the Supabase SDK or any concrete infrastructure. Wire concrete adapters only
  in the composition root.
- **Every repository implementation must pass the shared contract tests** for its
  interface (both the in-memory and the Supabase implementation).

## SOLID PR checklist

Before opening or merging a PR, confirm:

- [ ] **No Supabase in UI** — `apps/web/src/features/**/ui/**` must not import
      `@supabase/*` or call the Supabase SDK directly. Data access goes through the
      composition root (`bootstrap.ts`) via use-cases or repository interfaces.
- [ ] **No cross-feature `ui/` imports** — feature code must not import another
      feature's `ui/` folder. Use the feature's public `index.ts` (or shared types in
      `packages/core`) instead.
- [ ] **New repo has contract test** — every new repository interface gets a shared
      contract suite in `packages/core/src/testing/` and a test file under
      `packages/core/test/` run against the in-memory implementation (and Supabase
      when integration creds are available).
- [ ] **Business logic not in bootstrap/components** — orchestration and rules live
      in use-cases / application services. `bootstrap.ts` wires dependencies only;
      React components handle presentation and local UI state.

See `docs/DESIGN.md` §4 for the full SOLID rubric.

## Development prerequisites

Apply pending Supabase migrations before testing dashboard or tag features locally:

- `0019_reading_list_inherited.sql`
- `0020_tags_normalized.sql`
- `0021_project_dashboard_layout.sql`
- `0022_user_settings_integrations.sql`
- `0023_blob_registry.sql` (when using `BLOB_PROVIDER=tiered`)
- `0024_blob_objects_sharing.sql` (shared paper images for tiered blobs)
- `0026_user_privacy_account_delete.sql` (privacy disclaimer + account deletion RPC)
- `0027_vault_pages.sql` (vault pages + assets bucket)
- `0028_org_invite_codes.sql` (organizations, invite codes, org memberships)
- `0029_library_pins.sql` (shared library pin index)
- `0030_profiles_self_select.sql` (profile self-select RLS + legacy backfill)
- `0031_profiles_complete_org_setup.sql` (`complete_org_setup()` RPC for standalone onboarding)
- `0032_org_rls_recursion_fix.sql` (org RLS helper functions)
- `0033_org_rls_helper_grants.sql` (REVOKE/GRANT on org RLS helpers)
- `0034_org_switcher.sql` (org switcher RPC + `lab_root` alignment)
- `0035_vault_sharing.sql` (vault page sharing + shared vault-assets access)

For E2EE, sharing links, API tokens, and standalone onboarding, apply the full chain through the latest file in [`supabase/migrations/`](supabase/migrations/) (see [`supabase/migrations/README.md`](supabase/migrations/README.md)).

Self-hosted-only SQL is in [`supabase/migrations-self-hosted-postgres/`](supabase/migrations-self-hosted-postgres/) — see [`supabase/README.md`](supabase/README.md).

**Smoke acceptance** after migrations:

- Dashboard (Home) loads with widget cards visible on desktop.
- `tags` and `paper_tags` tables exist and RLS policies are active.

## Adding a feature module

**Full checklist:** [`docs/extensions.md`](extensions.md) §4 (registry, bootstrap, facades, routes).

1. Create `features/<name>/` with the standard sub-layers.
2. Define the entity and repository interface in `packages/core`.
3. Provide an in-memory implementation (for tests) and a Supabase implementation.
4. Add a DB migration under `supabase/migrations/`.
5. Export a `FeatureModule` descriptor and register it in `apps/web/src/registry.ts` (`ALL_MODULES`).

## Web backend (`apps/web/src/backend/`)

Persistence and auth are env-selected at the composition root — same pattern as integrations.

**Full guide:** [`docs/backend.md`](docs/backend.md)

Default is Supabase (`NEXT_PUBLIC_BACKEND_PROVIDER=supabase`). To self-host: implement repository adapters against the existing Postgres schema and wire a new provider in `wire-backend.ts`.

## Web storage (`apps/web/src/storage/`)

Object/blob storage (paper images, experiment artifacts, vault assets) is a **separate layer** from relational backend — env-selected via `BLOB_PROVIDER`.

**Full guide:** [`docs/storage/README.md`](docs/storage/README.md)

Default is Supabase Storage (`BLOB_PROVIDER=supabase`). Tiered R2 + OCI MinIO uses `BLOB_PROVIDER=tiered` on the server and `NEXT_PUBLIC_BLOB_PROVIDER=tiered` in the browser. See [`docs/storage/migration-plan.md`](docs/storage/migration-plan.md).

## Web integrations (`apps/web/src/integrations/`)

The PWA wires third-party services through env-selected providers at the composition root. Feature UI depends on **facades**, not concrete SDKs.

**Full guide:** [`docs/integrations.md`](docs/integrations.md)

To add or swap a provider (bibliography, citation, notification, log sync, git read):

1. Implement the port in `@thesis/core` (or reuse an existing one).
2. Add an adapter under `integrations/providers/<name>/`.
3. Register in `integrations/config.ts`, the wire switch (`wire-integrations.ts` or `wire-citations.ts`), and `integrations/descriptors.ts`.
4. Add an API proxy route if the browser needs CORS help (`app/api/<name>/route.ts`).
5. Extend `project_integrations.provider` (migration) for project-scoped connectors.
6. Document the `NEXT_PUBLIC_*` env var; defaults keep stock behavior.

Run `npm run check:solid` — UI must not import repositories or Supabase directly.

## Python SDK (`python/`)

The SDK mirrors the same modular shape (`features/<name>/{domain,application,infrastructure}`
+ `container.py` composition root). Domain/application must not import `supabase`;
only `infrastructure/` and `container.py` do.

```bash
cd python
pip install -e '.[dev]' ruff mypy
pytest          # offline; the Supabase integration test auto-skips without creds
ruff check thesis_tracker tests
mypy
```

### Adding a sync source (the extension point)

You don't edit the SDK to support a new logger — you add a class and register it:

1. Implement the `MetricSource` protocol (`id`, `available()`, `read(ref)`) and/or
   `ArtifactSource` (`collect(ref)`) — see `thesis_tracker/sync/source.py`.
2. Import your heavy dependency lazily (inside the method) and raise
   `MissingDependencyError` if it's absent, so the source stays
   registered-but-unavailable until installed.
3. `default_registry.register(YourSource())`.
4. Keep the parsing in a pure function and unit-test it with fabricated rows
   (see `tests/test_sync_sources.py`); add an optional-dependency extra in
   `pyproject.toml` if it needs one.

`run.sync("your-id", ref)` and `track(sync={"your-id": ref})` then drive it —
no changes to `Run` or the use-case.

## Commits

Conventional-commit style is appreciated: `feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`.

## Workflow

- **Never push directly to `main`.** Open a branch, push, open a pull request, wait for CI (`build-and-test`, `python-sdk`), then merge.
- Branch protection applies to **admins** too (`enforce_admins`).
- **Python SDK releases:** see [`release.md`](release.md) — bump `python/thesis_tracker/__init__.py`, update [`CHANGELOG.md`](CHANGELOG.md), merge via PR, then tag `vX.Y.Z` and create a GitHub Release (triggers PyPI).

## License of contributions

By contributing you agree your contributions are licensed under AGPL-3.0-only. This applies to the entire repository including `python/` and `plugins/thesis-tracker-research/` — there are no carve-outs. Note
significant changes you make to existing files, per the license.
