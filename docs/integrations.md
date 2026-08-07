# Web integrations & plugins

WeaveForge wires third-party services through a **plugin-style integration layer** at the composition root. Feature code and UI depend on **ports** (interfaces in `@weaveforge/core`) and **facades** — never on Zotero, GitLab, Mattermost, or Semantic Scholar directly.

Swapping a provider (e.g. Zotero → Mendeley) means: implement the port, add a manifest under `integrations/manifests/`, wire via `wire-integrations.ts`, set an env var. No edits to papers/plan/logbook screens.

> **Manifests:** built-in providers register via `integrations/manifests/` + `builtin.ts`. `descriptors.ts` aggregates Settings UI metadata from manifests.

> **Not the Python SDK.** `python/weaveforge/integrations/` is a separate extension system for experiment-tracking callbacks (TensorBoard, wandb, Keras). See [CONTRIBUTING.md § Python SDK](CONTRIBUTING.md#adding-a-sync-source-the-extension-point).
>
> **Broader extension map:** [`extensions.md`](extensions.md)

---

## Architecture at a glance

```
packages/core/                         apps/web/src/
├── integration-ports.ts             ├── integrations/
│   IBibliographyIntegration           │   config.ts          ← env provider selection
│   INotificationIntegration         │   wire-integrations.ts
│   ILogSyncIntegration              │   wire-citations.ts
├── citation-source.ts (ICitationSource)│   descriptors.ts     ← Settings UI metadata
├── metadata-source.ts (IMetadataSource)│   credentials.ts
└── user-integration-credentials.ts  │   providers/<name>/   ← concrete adapters
                                     ├── bootstrap.ts        ← composition root
                                     └── container/facades.ts ← UI entry points
```

### Two credential scopes

| Scope | Storage | Examples |
|-------|---------|----------|
| **User** | `user_settings` (`integrations` JSON bag + legacy columns) | Zotero API key, Semantic Scholar key |
| **Project** | `project_integrations` table | GitHub/GitLab tokens, Mattermost bot + channel |

User credentials are edited in **Settings → Integrations**. Project connectors are edited in **Settings → Connections** (per active project).

### Zotero + writing surfaces

- Bibliography sync pulls library items and PDF annotations.
- Annotations upsert vault excerpt notes under `Excerpts/` (`sync-annotation-excerpts.ts`); optional `page` + `report_section_id` frontmatter.
- Overleaf export maps `[[Paper Title]]` → `\cite{key}` (`markdown-to-latex` + `build-overleaf-export`). Prefer `metadata.citeKey` / bibtex key when set.
- **Find related papers** (paper note) calls Semantic Scholar recommendations / references; adds via `addPaper.addManual`. User guide: [`usage-cite-and-excerpts.md`](usage-cite-and-excerpts.md).

### Runtime flow

1. **`readIntegrationConfig()`** reads `NEXT_PUBLIC_*` env vars (deployment-time plugin selection).
2. **`wireIntegrations()`** / **`wireCitationSources()`** construct concrete adapters (or noops).
3. **`bootstrap.ts`** injects ports into use-cases and exposes them via **facades** (`getContainer().papers.syncBibliography()`, etc.).
4. **`descriptors.ts`** drives Settings UI; entries are **gated** so disabled providers never appear.

UI components must use facades only — `npm run check:solid` blocks `getContainer().*Repository` in `features/**/ui/**`.

---

## Integration kinds

| Kind | Core port | Wire function | User vs project creds | Env var |
|------|-----------|---------------|-------------------------|---------|
| **Bibliography** | `IBibliographyIntegration`, `IProjectBibliographyCollectionStore` | `wireIntegrations()` | User + per-project collection | `NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER` |
| **Citation** | `ICitationSource` | `wireCitationSources()` | User (optional API key) | `NEXT_PUBLIC_CITATION_PROVIDER` |
| **Notification** | `INotificationIntegration` | `wireIntegrations()` | Project | `NEXT_PUBLIC_NOTIFICATION_PROVIDER` |
| **Log sync** | `ILogSyncIntegration` | `wireIntegrations()` | Project | `NEXT_PUBLIC_LOG_SYNC_PROVIDER` |
| **Git read** | `IGitClient` + `IIntegrationsStore` | `wireGitRead()` in `wire-integrations.ts` | Project | `NEXT_PUBLIC_GIT_READ_PROVIDERS` |

**Metadata import** (arXiv, Crossref, URL, Zotero-by-key) uses a separate `IMetadataSource` list in `MetadataResolver`. Bibliography providers may register an extra metadata source (Zotero does).

---

## Deployment configuration

Add to `apps/web/.env.local` (all optional — defaults match the stock deployment):

```ini
# Bibliography / reference manager (default: zotero)
NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER=zotero          # zotero | none

# Plan milestone notifications (default: mattermost)
NEXT_PUBLIC_NOTIFICATION_PROVIDER=mattermost      # mattermost | none

# Logbook push to git (default: gitlab)
NEXT_PUBLIC_LOG_SYNC_PROVIDER=gitlab              # gitlab | none

# Citation auto-linking (default: semantic-scholar)
NEXT_PUBLIC_CITATION_PROVIDER=semantic-scholar    # semantic-scholar | none

# Git tab: which hosts to offer (default: github,gitlab)
NEXT_PUBLIC_GIT_READ_PROVIDERS=github,gitlab      # comma-separated | none
```

- Set a provider to `none` to disable that port (noop adapter + hidden Settings rows).
- Set `NEXT_PUBLIC_GIT_READ_PROVIDERS=none` to hide the **Git** nav tab entirely.
- User/project tokens are **never** in env — they are entered in-app (RLS-isolated).

---

## Adding a bibliography provider

Example: Mendeley as a Zotero replacement.

### 1. Implement the port

Create `apps/web/src/integrations/providers/mendeley/bibliography-integration.ts`:

```ts
import type { IBibliographyIntegration, Paper } from "@weaveforge/core";

export class MendeleyBibliographyIntegration implements IBibliographyIntegration {
  readonly providerId = "mendeley";
  // syncLibrary, pullAnnotations, pushPaper, removeRemotePaper, listCollections
}
```

If the provider supports import-by-ref, also implement `IMetadataSource` (see Zotero's `zotero-metadata-source.ts`).

### 2. Wire helper

Create `wire-mendeley-bibliography.ts` assembling sync/export/annotation sub-adapters (mirror `providers/zotero/wire-zotero-bibliography.ts`).

Use `createCredentialReader(manageSettings)` for API keys — never read Supabase from the adapter.

### 3. Register in config

In `integrations/config.ts`:

```ts
export type BibliographyProviderId = "zotero" | "mendeley" | "none";
// add "mendeley" to PROVIDERS.bibliography
```

### 4. Switch case

In `integrations/wire-integrations.ts`:

```ts
case "mendeley": {
  const mendeley = wireMendeleyBibliography(deps);
  bibliography = mendeley.integration;
  bibliographyMetadataSource = mendeley.metadataSource;
  projectBibliographyCollection = mendeley.projectCollection;
  break;
}
```

### 5. Descriptor (Settings UI)

In `integrations/descriptors.ts`, add to `USER_INTEGRATION_DESCRIPTORS`:

```ts
{
  providerId: "mendeley",
  title: "Mendeley",
  description: "Two-way paper sync",
  color: "#a70805",
  runtimeGate: { kind: "bibliography", providerId: "mendeley" },
  fields: [
    { id: "apiKey", label: "API key", type: "password" },
    { id: "library", label: "Library id", type: "text" },
  ],
},
```

Field `id` values must match what `getUserIntegrationField(settings, "mendeley", fieldId)` expects.

### 6. Legacy credential bridge (optional)

If migrating from flat `user_settings` columns, extend `LEGACY_FIELD_MAP` in `packages/core/.../user-integration-credentials.ts`.

### 7. API proxy (if needed)

Browser CORS usually requires a server route: `apps/web/src/app/api/mendeley/route.ts` (mirror `api/zotero/route.ts`).

### 8. Project collection store

Implement `IProjectBibliographyCollectionStore` or return `NoopProjectBibliographyCollectionStore` if N/A.

### 9. Deploy

```ini
NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER=mendeley
```

No facade or papers-screen changes required.

---

## Adding a citation provider

Example: OpenCitations.

### 1. Implement `ICitationSource`

```ts
// features/relations/infrastructure/opencitations-citation-source.ts
export class OpenCitationsCitationSource implements ICitationSource {
  readonly id = "opencitations";
  supports(ref: PaperRef): boolean { /* ... */ }
  references(ref: PaperRef): Promise<PaperRef[]> { /* ... */ }
}
```

### 2. Config + wire

```ts
// config.ts — add to CitationProviderId + PROVIDERS.citation
// wire-citations.ts
case "opencitations":
  sources.push(new OpenCitationsCitationSource(() => readCred("opencitations", "apiKey")));
  break;
```

`LinkCitationsUseCase` already accepts an array of sources — no use-case edits.

### 3. Descriptor + credentials

Add to `USER_INTEGRATION_DESCRIPTORS` with `runtimeGate: { kind: "citation", providerId: "opencitations" }`.

### 4. Deploy

```ini
NEXT_PUBLIC_CITATION_PROVIDER=opencitations
```

---

## Adding a notification provider

Example: Slack for milestone posts.

### 1. Implement `INotificationIntegration`

```ts
export class SlackNotificationIntegration implements INotificationIntegration {
  readonly providerId = "slack";
  async notifyMilestone(event, milestone) {
    const cfg = await this.integrations.get(this.projectId(), "slack");
  }
}
```

Read project config via `IIntegrationsStore.get(projectId, "slack")`.

### 2. Low-level notifier + API route

Mirror `MattermostNotifier` + `app/api/mattermost/route.ts`.

### 3. Config, wire, noop

```ts
// wire-integrations.ts
case "slack":
  notifications = new SlackNotificationIntegration({ ... });
  break;
```

`NoopNotificationIntegration` is used when env is `none`.

### 4. Descriptor (project-scoped)

Add to `PROJECT_SYNC_DESCRIPTORS`:

```ts
{
  provider: "slack",
  title: "Slack — plan updates",
  description: "Post when milestones change.",
  repoLabel: "Webhook URL",      // reuse Integration.repo
  branchLabel: "Channel",        // reuse Integration.branch
  tokenPlaceholder: "xoxb-…",
  runtimeGate: { kind: "notifications", providerId: "slack" },
  // ...
},
```

### 5. Schema + types

- Extend `SyncProvider` in `features/sync/domain/integration.ts`.
- Migration: add `"slack"` to `project_integrations.provider` check constraint.

### 6. Deploy

```ini
NEXT_PUBLIC_NOTIFICATION_PROVIDER=slack
```

`PlanFacade.notifyMilestone()` already delegates to the wired port.

---

## Adding a log-sync provider

Example: push logbook entries to a GitHub repo.

### 1. Implement `ILogSyncIntegration`

```ts
export class GitHubLogSyncIntegration implements ILogSyncIntegration {
  readonly providerId = "github-log"; // distinct from git-read "github"
  async pushLog(entry) { /* ... */ }
  async removeLog(entry) { /* ... */ }
}
```

### 2. Exporter + API route

Mirror `GitLabLogExporter` + `app/api/gitlab/route.ts`.

### 3. Config, wire, descriptor

Same pattern as notification; `runtimeGate: { kind: "logSync", providerId: "..." }`.

### 4. Deploy

```ini
NEXT_PUBLIC_LOG_SYNC_PROVIDER=github-log
```

---

## Adding a git-read provider

Git read is wired via `wireGitRead()` inside `wire-integrations.ts` (same registry as bibliography/notifications/logSync).

### 1. Extend config

```ts
export type GitReadProviderId = "github" | "gitlab" | "bitbucket";
```

### 2. Extend `SyncProvider` + DB constraint

### 3. Update `GitClient`

Add host mapping and proxy path in `features/sync/infrastructure/git-client.ts`.

### 4. API proxy

`app/api/bitbucket/route.ts`

### 5. Descriptor

```ts
runtimeGate: { kind: "gitRead", providerId: "bitbucket" }
```

### 6. Git screen

`git-screen.tsx` reads `getContainer().integrationConfig.gitRead` — no hardcoded provider list.

### 7. Deploy

```ini
NEXT_PUBLIC_GIT_READ_PROVIDERS=github,bitbucket
```

`SyncFacade.git` receives `registry.gitRead` from `wireIntegrations()` — not from `bootstrap.ts` directly.

### GitLab: two ports, one credential row

GitLab can power **git read** (Git tab) and **log sync** (logbook push) at once. Both use the same `project_integrations` row (`provider = "gitlab"`). When both ports are enabled in env, Settings shows one merged descriptor (`gitlab-combined`). When only one is enabled, you get `gitlab-git-read` or `gitlab-log-sync`.

### Project connector field mapping

`Integration` stores `token`, `repo`, and `branch` for all providers. Use `features/sync/domain/integration-fields.ts` in infrastructure:

| Provider | `token` | `repo` | `branch` |
|----------|---------|--------|----------|
| GitHub / GitLab | API token | repo path | branch |
| Mattermost | bot token | server URL | channel id |

Descriptors map UI labels via `fields[].key`. Do not read `.repo` / `.branch` with implicit meaning in adapters.

---

## Adding a metadata source (paper import)

Metadata sources are **not** env-selected individually — they are always registered in `bootstrap.ts`:

```ts
const metadataResolver = new MetadataResolver([
  new ArxivMetadataSource(),
  new CrossrefMetadataSource(),
  new UrlMetadataSource(),
  // bibliography provider may add: wiredIntegrations.bibliographyMetadataSource
]);
```

To add a new import resolver:

1. Implement `IMetadataSource` (`id`, `supports`, `fetch`).
2. Register in `bootstrap.ts` (or return from a bibliography wire helper).
3. No Settings descriptor needed unless the source requires a user API key — then add a `USER_INTEGRATION_DESCRIPTORS` entry gated on a new `runtimeGate` kind (extend `descriptors.ts` if needed).

---

## File checklist (quick reference)

| Step | Bibliography | Citation | Notification | Log sync | Git read |
|------|:---:|:---:|:---:|:---:|:---:|
| Core port | ✓ (exists) | ✓ (exists) | ✓ (exists) | ✓ (exists) | `IGitClient` |
| Provider class | ✓ | ✓ | ✓ | ✓ | `GitClient` |
| `config.ts` id | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wire switch | `wire-integrations` | `wire-citations` | `wire-integrations` | `wire-integrations` | `wire-integrations` (`wireGitRead`) |
| Descriptor | user | user | project | project | project |
| API route | often | often | often | often | often |
| DB migration | maybe | — | ✓ | ✓ | ✓ |
| Env var | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Testing

- **Config parsing:** `apps/web/src/integrations/test/read-integration-config.test.ts`
- **Credential helpers:** `packages/core/test/user-integration-credentials.test.ts`
- **Contract tests:** implement in-memory fakes for new ports if logic is non-trivial
- **Manual:** configure provider in Settings, exercise the feature (sync, link citations, post milestone, push log, Git tab)

Run before opening a PR:

```bash
npm run build:core
npm test -w @weaveforge/core
npm run build --workspace @weaveforge/web
npm test -w @weaveforge/web
npm run check:solid
```

---

## Conventions

- **Best-effort side effects:** `pushLog`, `notifyMilestone`, and bibliography sync failures must not block local writes. UI catches and surfaces errors; use-cases complete the primary operation first.
- **Credential reader:** all user keys flow through `createCredentialReader(manageSettings)` — adapters never import the Supabase SDK for settings.
- **Noops:** when env is `none`, wired noops satisfy the port so facades never null-check.
- **Nav gating:** `buildModuleRegistry(integrationConfig)` hides modules (e.g. Git) when no providers are enabled.
- **Legacy columns:** `applyUserIntegrationFields` keeps `zoteroApiKey` etc. in sync with the `integrations` bag for existing DB rows.

---

## Related docs

- [DESIGN.md](DESIGN.md) — SOLID principles, `IMetadataSource`, composition root
- [dev.md](dev.md) — feature modules, registry, facades
- [README.md §8](../README.md#8-integrations-settings) — end-user setup guide
