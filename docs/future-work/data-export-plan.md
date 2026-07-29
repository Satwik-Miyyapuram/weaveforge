# Full data export plan

**Status:** Future work — not a current priority (target: coming months)  
**Priority:** Low — revisit after E2EE soak, external link sharing, and other near-term items  
**Branch target:** `feat/data-export` (when scheduled)  
**Related:** [`e2ee-progress.md`](e2ee-progress.md)

> This document is a design reference only. No implementation is planned in the immediate roadmap.

---

## Goals

| Goal | Detail |
|------|--------|
| **Complete** | Everything `delete_user_account_data` would remove, plus blobs and optional metadata |
| **Same shape as the app** | One folder per feature module / project, domain JSON (not raw SQL) |
| **E2EE-safe** | Server returns ciphertext; export use-case decrypts via existing `EntityEncryptor` + blob stores |
| **Portable** | Stable `manifest.json` + version for future import |
| **User-controlled** | Settings → “Download my data”, requires sign-in + unlocked keyring |

---

## Non-goals (v1)

- Re-import / restore from ZIP (design for it, ship export first)
- Exporting **other people’s** shared content you can view (optional toggle later)
- Exporting org-wide data you don’t own
- Server-side ZIP generation (violates E2EE; also heavy on R2 egress)

---

## Architecture

```
Settings UI  →  ExportUserDataUseCase  →  Collect (repos + blob registry)
                                       →  Decrypt (EntityEncryptor + EncryptedBlobStore)
                                       →  Assemble archive tree
                                       →  ZipWriter (fflate / JSZip)
                                       →  Browser saveAs .zip
```

**All work runs in the browser.** Pattern: extend `MigrateProjectEntitiesToE2eeUseCase` + `PrefetchProjectUseCase` — iterate projects, call wired repos, decrypt, write files.

**Prerequisite:** `CryptoProvider` phase = `ready` (keyring unlocked).

Key references:

| Area | Path |
|------|------|
| Composition root | `apps/web/src/bootstrap.ts` |
| Prefetch (single project) | `apps/web/src/application/prefetch-project.use-case.ts` |
| Entity migration loop | `packages/core/src/features/crypto/application/migrate-project-entities.use-case.ts` |
| Blob decrypt | `apps/web/src/storage/encrypted-blob-store.ts` |
| Account deletion (inverse scope) | `apps/web/src/features/settings/ui/delete-account-panel.tsx` |
| Delete RPC tables | `supabase/migrations/0028_org_invite_codes.sql` (`delete_user_account_data`) |

---

## ZIP layout (mirrors website structure)

Top-level name: `thesis-tracker-export-{iso-date}/`

```
thesis-tracker-export-2026-07-12/
├── manifest.json                 # schema version, export metadata, checksums
├── README.txt                    # human-readable index
│
├── account/
│   ├── profile.json              # Member / profile
│   └── settings.json             # user_settings (Zotero/S2 keys — user's own secrets)
│
├── org/
│   └── membership.json           # org + role (if member)
│
├── sharing/
│   ├── outgoing-shares.json      # shares where ownerId = me
│   └── comments.json             # comments I authored (listAll)
│
├── projects/
│   └── {project-slug}/           # slug from project.name, fallback to id
│       ├── project.json          # Project record + zotero_collection, dashboard_layout
│       ├── integrations.json     # project_integrations (git/mattermost)
│       │
│       ├── papers/
│       │   ├── index.json        # array of Paper domain objects
│       │   └── images/
│       │       └── {paperId}/
│       │           └── {filename}   # decrypted bytes, original content-type ext
│       │
│       ├── graph/
│       │   ├── relations.json    # paper_relations
│       │   └── tags.json         # tags + paper_tags
│       │
│       ├── reading-lists/
│       │   └── tree.json         # lists + items (getTree)
│       │
│       ├── logbook/
│       │   └── entries.json      # LogEntry[]
│       │
│       ├── report/
│       │   └── sections.json     # tree from getTree()
│       │
│       ├── vault/
│       │   ├── pages.json        # tree from getTree(); body = resolved markdown (not CRDT bytes)
│       │   └── assets/
│       │       └── {pageId}/
│       │           └── {filename}
│       │
│       ├── experiments/
│       │   ├── index.json        # Experiment[]
│       │   └── {experimentId}/
│       │       ├── metrics.json  # MetricPoint[] per experiment
│       │       └── artifacts/    # from blob_objects + decrypt (if any)
│       │
│       └── plan/
│           └── milestones.json   # Milestone[]
│
└── crypto/                       # OPTIONAL — see Crypto policy below
    ├── user-keys.json            # public keys + kek_source only (no secret keys)
    └── resource-index.json       # resource_type/id list + epochs (no wrapped DEKs)
```

This matches nav/feature modules: **papers, graph, reading-lists, experiments, plan, logbook, vault, report**, plus **projects**, **sharing**, **settings**, **org**.

---

## `manifest.json` (contract for future import)

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-07-12T19:55:00.000Z",
  "appVersion": "0.1.0",
  "userId": "uuid",
  "encryption": {
    "exportedDecrypted": true,
    "e2eeEnabled": true
  },
  "projects": [
    { "id": "…", "slug": "thesis-main", "name": "Thesis Main" }
  ],
  "files": [
    { "path": "projects/thesis-main/papers/index.json", "sha256": "…", "bytes": 1234 }
  ],
  "stats": {
    "papers": 42,
    "blobs": 18,
    "comments": 7
  }
}
```

- **`schemaVersion`** — bump when layout changes
- **`files[]`** — optional integrity checks
- Domain types = existing `@thesis/core` interfaces serialized as JSON (camelCase, same as repos return after decrypt)

---

## Collection phases

### Phase 0 — Global (no project context)

| Source | Call | Output path |
|--------|------|-------------|
| Projects | `projectRepository.list()` | drives project loop + slugs |
| Profile | `memberRepository.getMine()` | `account/profile.json` |
| Settings | `manageSettings.get()` | `account/settings.json` |
| Outgoing shares | `shareRepository` list by owner | `sharing/outgoing-shares.json` |
| Comments | `commentRepository.listAll()` | `sharing/comments.json` |
| Org | org API / membership | `org/membership.json` |

### Phase 1 — Per project

Set `projectContext.projectId`, then (same as `PrefetchProjectUseCase` + extras):

| Feature | Calls | Notes |
|---------|-------|-------|
| Papers | `paperRepository.list()` | decrypt via wired repo |
| Graph | `paperRelationRepository.getGraph()`, `tagRepository.listWithCounts()` | |
| Reading lists | `readingListRepository.getTree()` | |
| Logbook | `logEntryRepository.list()` | |
| Report | `reportSectionRepository.getTree()` | |
| Vault | `vaultPageRepository.getTree()` | resolve body (see Phase 3) |
| Experiments | `experimentRepository.list()` + `metricRepository.history(id)` | |
| Plan | `milestoneRepository.list()` | SUP_p decrypt needs project context |
| Integrations | `integrationsStore.get(projectId, …)` | |
| Dashboard | `dashboardLayoutRepository.get(projectId)` | merge into `project.json` |
| Library pins | `libraryPinRepository.list()` | under `project.json` or `library/pins.json` |

### Phase 2 — Blobs

For each `blob_objects` row where `user_id = me`:

1. Resolve resource ref (`packages/core/src/features/crypto/domain/blob-resource.ts`)
2. `EncryptedBlobStore.fetchDecrypted(bucket, path)`
3. Write under the feature folder above (paper images, vault assets, experiment artifacts)
4. Strip `pdfPath` / internal storage paths from JSON or replace with **relative archive paths** in export copies

Concurrency: pool of ~4–6 parallel fetches; backoff on 429.

### Phase 3 — Collab body resolution (vault / report / log)

For resources with CRDT collab:

1. Prefer **decrypted repo body** (already merged in DB bag or LWW)
2. If body is Yjs snapshot (`format: yjs-snapshot`), export **rendered markdown/plain text** via existing collab decode path
3. Do **not** export raw `crdt_updates` in v1 (noise; import would re-create anyway)
4. Optional `collab/` debug folder behind dev flag

---

## Crypto / keys policy

| Include in export? | Rationale |
|--------------------|-----------|
| **Decrypted entity fields** | Yes — core user ask |
| **Decrypted blobs** | Yes |
| **UMK, box/sign secret keys** | **No** — never export secret key material |
| **Wrapped DEKs / key wraps** | **No** in v1 — export is for human portability, not backup-restore |
| **Public keys + fingerprint** | Optional in `crypto/user-keys.json` |

If import is added later, a separate “encrypted backup” mode could export ciphertext + wrapped keys for same-account restore.

---

## Core implementation (suggested)

### 1. `packages/core`

```
features/export/
  domain/
    export-manifest.ts      # types + schemaVersion
    export-archive.ts       # pure tree builder (no I/O)
  application/
    export-user-data.use-case.ts   # orchestration interface + progress events
```

Progress event shape:

```typescript
type ExportProgress =
  | { phase: "collect"; projectId?: string; done: number; total: number }
  | { phase: "blobs"; done: number; total: number }
  | { phase: "zip"; percent: number }
  | { phase: "done"; bytes: number }
  | { phase: "error"; message: string };
```

Use-case depends on **ports** (list functions), not Supabase — mirrors migration pattern.

### 2. `apps/web`

```
features/export/
  application/
    browser-export-user-data.use-case.ts  # wires container, project loop, blob registry query
  infrastructure/
    zip-writer.ts                         # fflate
    download-file.ts                      # trigger save
  ui/
    export-data-panel.tsx                 # Settings screen
```

Wire in `bootstrap.ts` → `SettingsFacade` or `CryptoFacade`.

### 3. UI (`settings-screen.tsx`)

- Section: **“Your data”** (above delete-account danger zone)
- Button: **“Download all data (decrypted ZIP)”**
- Disabled until unlocked; tooltip if locked
- Progress modal: project name, blob count, cancel token
- Success: auto-download `thesis-tracker-export-{date}.zip`
- Copy: warn that ZIP contains **plaintext secrets** (settings keys, paper notes)

---

## Security & privacy

1. **ZIP is sensitive** — treat like a password export; suggest OS full-disk encryption
2. **No logging** — don’t log manifest contents server-side
3. **Rate limit** — optional client debounce; blob fetches already authenticated
4. **Shared content** — v1: owned only; v2 toggle “Include shared-with-me copies”
5. **Supervisor read-only data** — exclude supervisee milestones/logs unless explicitly owned
6. **Settings export** — include integration API keys; show confirmation checkbox

---

## Performance estimates

| User size | Rough time | Mitigation |
|-----------|------------|------------|
| Small (<500 entities, <50 blobs) | 10–30 s | single pass |
| Medium | 1–3 min | parallel blobs, streaming ZIP |
| Large | 5+ min | resumable export job (Phase 2 deferral) |

Use **streaming ZIP** (`fflate` zip stream) so the whole archive isn’t held in RAM.

---

## Implementation phases

| Phase | Scope | Effort |
|-------|--------|--------|
| **A — Skeleton** | manifest schema, use-case ports, empty ZIP + Settings button | ~1 day |
| **B — Entity export** | All project entities decrypted → JSON tree | ~2 days |
| **C — Blobs** | Registry scan + decrypt + relative path rewrite | ~1–2 days |
| **D — Collab bodies** | Vault/report/log resolved text | ~1 day |
| **E — Polish** | Progress UI, cancel, README, manifest checksums, tests | ~1 day |
| **F — Hardening** | Large-account streaming, shared-with-me toggle, audit doc | defer |

**Suggested order:** A → B → C → D → E, after E2EE branch is merged and migrations applied.

---

## Testing

1. **Unit:** manifest builder, slug sanitization, path rewriting, tree shape vs domain types
2. **Integration:** seed users a/b — export a, assert JSON matches repo list counts, images openable
3. **E2EE:** export only when unlocked; legacy plaintext rows still export cleanly
4. **Edge cases:** empty project, project with no blobs, milestone SUP_p across projects, duplicate slugs
5. **Manual:** unzip, open `papers/index.json`, verify title matches UI; open image files

---

## Open decisions (pick before build)

1. **Slug collisions** — `{slug}-{shortId}` when two projects sanitize to the same name?
2. **Shared-with-me** — v1 exclude or optional include?
3. **Experiment Python artifacts** — include if in `blob_objects`, or skip until web lists them?
4. **Import** — design manifest for v2 import, or export-only forever?

---

## Relation to account deletion

`delete-account-panel.tsx` is the inverse scope list. Export should cover at least:

`projects` (+ all FK children), `user_settings`, `profiles`, `shares`, `comments`, `blob_objects` (+ storage bytes), `library_pins`, crypto tables (metadata only unless backup mode).

---

## Bottom line

One client-side `ExportUserDataUseCase` that loops projects like migration, reads through **wired decrypted repos**, fetches blobs through **EncryptedBlobStore**, writes a **feature-aligned folder tree**, and streams a ZIP from Settings. No new server decrypt path; structure matches how users think about the app (papers, vault, logbook, etc.), not database tables.
