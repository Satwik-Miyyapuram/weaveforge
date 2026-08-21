# Extending WeaveForge

WeaveForge is built as a **modular monolith**: domain logic lives in `@weaveforge/core`, infrastructure is swapped at the composition root, and the UI talks to **facades** — not Supabase, not repositories, not third-party SDKs.

That layering is the extension model. You extend the app by implementing a **port** (interface) and wiring it in one place — not by patching feature screens.

> **Deploy plugins (B–D):** register packages in [`weaveforge.config.ts`](../weaveforge.config.ts) at the repo root. Integration manifests live in `apps/web/src/integrations/manifests/`. See [`plugins/README.md`](../plugins/README.md).

---

## Abstraction layers (where to plug in)

```
┌─────────────────────────────────────────────────────────────────┐
│  UI (Next.js)          features/*/ui  →  getContainer().papers  │
├─────────────────────────────────────────────────────────────────┤
│  Facades               apps/web/src/container/facades/          │
├─────────────────────────────────────────────────────────────────┤
│  Application           packages/core  use-cases                 │
├─────────────────────────────────────────────────────────────────┤
│  Domain                entities + repository INTERFACES         │
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure        Supabase/Postgres repos, integrations  │
│                        wired in bootstrap.ts + wire-*.ts        │
└─────────────────────────────────────────────────────────────────┘
```

**Rule:** dependencies point inward. Domain never imports infrastructure. UI never imports `@supabase/*`.

**Composition roots** (the only places that know concrete classes):

| Client | File |
|--------|------|
| Web PWA | `apps/web/src/bootstrap.ts` |
| Backend selection | `apps/web/src/backend/wire-backend.ts` |
| Integrations | `apps/web/src/integrations/wire-integrations.ts` |
| Blob storage | `apps/web/src/storage/wire-storage.ts` |
| Python SDK | `python/weaveforge/container.py` |
| Python sync | `python/weaveforge/sync/registry.py` |

---

## Extension types (pick your seam)

| What you want | Best seam | Effort | Guide |
|---------------|-----------|--------|-------|
| Connect Zotero, GitLab, Mattermost, … | **Integration provider** | Low | [`integrations.md`](integrations.md) |
| Import papers from a new catalog | **Metadata / citation source** | Low | Below + `integrations.md` |
| Push metrics from training code | **Python sync source** | Low | [`CONTRIBUTING.md` § Python](CONTRIBUTING.md#adding-a-sync-source-the-extension-point) |
| New top-level screen (e.g. Timer) | **Feature module** | Medium | Below + [`dev.md`](dev.md) |
| Self-host on plain Postgres | **Backend provider** | High | [`backend.md`](backend.md) |
| S3/R2/MinIO blobs | **Storage provider** | Medium | [`storage/README.md`](storage/README.md) |

---

## 1. Integration providers (recommended first extension)

The closest thing to a “plugin” today. Env vars select the implementation at deploy time; feature UI stays unchanged.

**Ports** live in `packages/core/src/features/integrations/`:

- `IBibliographyIntegration` — Zotero sync
- `ICitationSource` — Semantic Scholar graph linking
- `INotificationIntegration` — Mattermost milestone alerts
- `ILogSyncIntegration` — push logbook entries externally
- `IGitClient` — read branches/commits

**Checklist** (full detail in [`integrations.md`](integrations.md)):

1. Implement the port in `@weaveforge/core` (or reuse an existing one).
2. Add a manifest under `apps/web/src/integrations/manifests/<name>.ts` (see `zotero.ts`).
3. Add the manifest under `apps/web/src/integrations/manifests/`. It reaches the app through `apps/web/src/deployment/generated-registry.ts`, which `npm run generate:deployment` writes — edit the generator's inputs, never the generated file.
4. Set `NEXT_PUBLIC_*_PROVIDER` env var to the manifest `id`.
5. Optional: `apps/web/src/app/api/<name>/route.ts` for CORS-safe browser calls.
6. Run `npm run check:solid`.

**Example:** `NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER=zotero` → `ZoteroBibliographyIntegration` is constructed in `wireIntegrations()` and injected into `PapersFacade`.

---

## 2. Metadata & citation sources

Paper import resolves metadata through a **chain of sources** — first `supports(ref)` wins.

| Port | Location | Wired in |
|------|----------|----------|
| `IMetadataSource` | `packages/core/.../metadata-source.ts` | `MetadataResolver` in `bootstrap.ts` |
| `ICitationSource` | `packages/core/.../citation-source.ts` | `wire-citations.ts` |

To add e.g. OpenAlex:

1. Implement `IMetadataSource` with `id`, `supports()`, `fetch()`.
2. Append to the resolver list in `bootstrap.ts` (after existing sources).
3. Unit-test the pure parsing; integration-test against the API if creds exist.

Bibliography providers may also export a metadata source (Zotero does both).

---

## 3. Python sync sources

For experiment tracking from training scripts — **no web changes required**.

```python
from weaveforge.sync.registry import default_registry
from weaveforge.sync.source import MetricSource

class CsvMetricSource:
    id = "my-csv"
    def available(self) -> bool: ...
    def read(self, ref: str) -> list: ...

default_registry.register(CsvMetricSource())
```

Then: `track(sync={"my-csv": "path/to/run"})`.

See `python/examples/custom_source.py` and [`python/README.md`](../python/README.md).

---

## 4. Feature modules (new UI domain)

A feature module is a vertical slice:

```
features/<name>/
├── domain/           # optional web-only types
├── application/      # Load*ScreenUseCase, commands
├── infrastructure/   # Supabase adapters (if not in backend/)
├── ui/               # screens, components
├── module.ts         # FeatureModule descriptor
└── index.ts          # public barrel — only import path for other features
```

### `FeatureModule` contract

Defined in `packages/core/src/shared/module.ts`:

```ts
export interface FeatureModule {
  id: string;
  title: string;
  navItems: NavItem[];
  routes: RouteDef[];      // documents intent; see routing note below
  migrations?: string[];   // SQL files this feature owns
}
```

### Touch-point checklist

Adding a feature today requires edits in **several** places (by design — explicit wiring, no magic):

| Step | File / location |
|------|-----------------|
| 1. Domain + ports | `packages/core/src/features/<name>/` |
| 2. Contract tests | `packages/core/src/testing/*-contract.ts` + `packages/core/test/` |
| 3. In-memory fake | `packages/core/src/testing/in-memory-*.ts` |
| 4. Supabase adapter | `apps/web/src/features/<name>/infrastructure/` or `backend/providers/supabase/` |
| 5. DB migration | `supabase/migrations/00NN_<name>.sql` |
| 6. Module descriptor | `apps/web/src/features/<name>/module.ts` |
| 7. Registry | `apps/web/src/registry.ts` — built-ins only; plugin modules come from config |
| 8. Nav group | `navGroup` on `FeatureModule` (no manual bucket edit) |
| 9. Next.js route | `app/<path>/page.tsx` — hand-written for built-ins; `npm run generate:routes` for plugins |
| 10. Nav icon | `apps/web/src/app/nav-icon.tsx` if using a new icon key |
| 11. Use-cases + wiring | `apps/web/src/bootstrap.ts` |
| 12. Facade | `apps/web/src/container/facades/` → `AppContainer` |

**Routing note:** `FeatureModule.routes` drives documentation and future auto-wiring; **today** Next.js App Router pages are created manually under `app/`. The registry builds **nav only**.

**UI access:** screens call `getContainer().<yourFacade>()` — never repositories. `npm run check:solid` enforces this in CI.

---

## 5. Backend & storage providers

| Layer | Env var | Wire file |
|-------|---------|-----------|
| Relational DB + auth | `NEXT_PUBLIC_BACKEND_PROVIDER` | `wire-backend.ts` |
| Object blobs | `BLOB_PROVIDER` | `wire-storage.ts` |

Implement repository interfaces from `@weaveforge/core`, pass the shared **contract test suite**, add a `case` in the wire switch.

Postgres self-hosting: [`backend/postgres-provider.md`](backend/postgres-provider.md).

---

## 6. Repository decorators

Cross-cutting persistence behaviour can wrap a repository without changing any
use-case: the decorator implements the same port and delegates.

There are no encryption decorators any more. `encryptRepo()`,
`wireEncryptedPapers()`, and `wireEncryptedReadingListItems()` were removed with
client-side E2EE — storage is plaintext through `PassthroughBlobStore` and
Row-Level Security is the access boundary. See [`SECURITY.md`](SECURITY.md).

The seam itself is still there and still the right place for caching, retries,
or instrumentation: implement the port, take the real repository as a
constructor argument, and swap it in at `bootstrap.ts`.

---

## 7. Settings & deployment descriptors

Integration Settings UI is **data-driven** from `apps/web/src/integrations/descriptors.ts`:

- `UserIntegrationDescriptor` — per-user API keys (Zotero, Semantic Scholar)
- `ProjectSyncDescriptor` — per-project connectors (GitHub, Mattermost)

Gated by `readIntegrationConfig()` so disabled providers never appear.

---

## Testing your extension

| Layer | How |
|-------|-----|
| Domain / use-cases | Unit tests with in-memory repos (`packages/core/test/`) |
| Repository | Shared contract suite — run against in-memory + Supabase |
| UI boundaries | `npm run check:solid` + `npm run check:dry` |
| Integrations | Adapter unit tests + optional live test with env creds |
| Python sync | `pytest` with fabricated rows (`tests/test_sync_sources.py`) |
| Full CI | `npm run test:core`, `npm test --workspace @weaveforge/web`, PR to `main` |

A module is done when contract tests pass on **both** in-memory and real backend implementations (Liskov).

---

## What is *not* supported yet

| Capability | Status |
|------------|--------|
| Install npm plugin without redeploy | Redeploy still required (compile-time bundle) |
| Dynamic `bootstrap.ts` / facade fields for plugins | UI-only plugin modules work; data plugins need manual wiring |
| Runtime `import()` marketplace | Phase E — deferred |
| Auto-generated Next.js routes for built-in features | Built-ins keep hand-written `app/*/page.tsx` |
| Plugin marketplace / sandbox | Explicit non-goal for v1 (`DESIGN.md` §7) |
| Python SDK backend swap | Supabase-only today |

---

## Related docs

| Doc | Topic |
|-----|-------|
| [`DESIGN.md`](DESIGN.md) | SOLID rubric, module shape, non-goals |
| [`dev.md`](dev.md) | Day-to-day dev, SOLID CI checks |
| [`integrations.md`](integrations.md) | Integration provider deep dive |
| [`backend.md`](backend.md) | Backend vs storage separation |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | PR checklist |
