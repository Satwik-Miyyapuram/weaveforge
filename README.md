# WeaveForge

[![CI](https://github.com/Satwik-Miyyapuram/weaveforge/actions/workflows/ci.yml/badge.svg)](https://github.com/Satwik-Miyyapuram/weaveforge/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](python/)

**One workspace for your whole research project** — papers, reading lists, citation graph, plan, logbook, report outline, experiments, vault notes, and lab collaboration. A nine-month thesis, a four-year PhD, or a postdoc that outlives both. Open-source and self-hostable under AGPL-3.0-only; hosted WeaveForge access and usage limits are part of the pricing plan.

Most research tools split the job: Zotero for papers, Notion for notes, wandb for runs, Google Docs for the write-up. WeaveForge keeps the **literature**, **plan**, **experiments**, and **writing** in one modular PWA, with optional Zotero sync, git integration, and supervisor sharing — so your advisor sees real objects, not screenshots.

---

## Two products, one database

| | **Web app** (`apps/web`) | **Python SDK** (`python/`) |
|---|--------------------------|----------------------------|
| **What** | Next.js PWA — library, graph, plan, log, report, experiments, vault, sharing | Push runs, curves, and figures from training scripts |
| **Install** | `npm install` + Supabase project | `pip install -e python` |
| **Best for** | Day-to-day research in the browser | `@track_experiment`, Lightning/Keras callbacks, TensorBoard/wandb import |
| **Docs** | [Quick start ↓](#quick-start) · [Features ↓](#features) | [Python SDK ↓](#python-sdk) · [`python/README.md`](python/README.md) |

Both talk to the **same Postgres schema** (`supabase/migrations/`). Log a run in Python → compare it in the dashboard next to the paper it implements.

---

## Why you use it as a researcher

- **Papers + graph + lists** — import from URL, arXiv, DOI, or Zotero; force-graph citations and `#tags`; nested reading lists.
- **Plan + logbook** — milestones with dependencies and compute estimates; markdown daily log; supervisor read access along the org tree.
- **Experiments tied to code** — branch/commit pinning, metric curves, artifact uploads, compare view for sweeps.
- **Report + vault** — nested report sections with progress; Obsidian-style vault pages for long-form notes.
- **Your notes as files** — mirror the workspace to a folder of plain Markdown that opens as an Obsidian vault, edit it out there, and pull the changes back with a diff shown first ([`docs/using/workspace-folder.md`](docs/using/workspace-folder.md)).
- **Collaboration** — share papers, experiments, sections, vault notes, or whole types with labmates; **pin shared items into your library**; comment threads and **co-editing** where granted.
- **Privacy model** — data stored server-side with encryption at rest; Postgres RLS is the access boundary (owner-or-shared); external **view links** (`/link?t=…`) with optional expiry. Not end-to-end encrypted.
- **Labs without IT** — professors create a lab and share three invite codes (professor / PhD / masters); join with a code or run **standalone**.

Built **TDD + SOLID**: framework-agnostic core (`@weaveforge/core`), repository contracts with shared test suites, feature facades for the UI, env-driven integrations (Zotero, GitHub, GitLab, Mattermost, Semantic Scholar).

---

## Quick start

**Prerequisites:** Node.js 22+, a [Supabase](https://supabase.com) project (or self-hosted Postgres — see [`docs/running/backend.md`](docs/running/backend.md)).

```bash
git clone https://github.com/Satwik-Miyyapuram/weaveforge.git
cd weaveforge
npm install
npm run build:core
npm run test:core          # 900+ domain tests, no network
```

1. Copy `apps/web/.env.local.example` → `apps/web/.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Apply schema: `supabase link --project-ref <ref> && supabase db push` (or paste migrations in the SQL editor — see [`supabase/migrations/README.md`](supabase/migrations/README.md)).
3. `npm run dev` → http://localhost:3000 — sign in, create a project, start adding papers.

Full setup (Auth providers, integrations, deploy): sections below and [`docs/building/dev.md`](docs/building/dev.md).

---

## Features

| Module | What you get |
|--------|----------------|
| **Papers** | Import, Zotero sync, summaries, `#tags`, annotations, figures, and Semantic Scholar citation alerts |
| **Graph** | Obsidian-style force graph — papers, tags, typed citation edges, auto-link via Semantic Scholar |
| **Reading lists** | Nested lists; papers can belong to many lists |
| **Plan** | Milestones, dependencies, compute fields, progress bar, Mattermost notifications |
| **Logbook** | Dated entries, hours, mood, markdown |
| **Report** | Nested outline, per-section status and word targets |
| **Experiments** | Runs, metrics, curves, git pins, compare table + overlaid charts |
| **Vault / Notes** | Wiki-style pages with asset attachments; collaborative editing |
| **Shared** | Inbox with native card UI; deep links; **Add to library** pins into Papers / etc. |
| **People** | Create/join lab with invite codes; org chart; role-scoped account creation; standalone mode |
| **Git** | Live branch/commit browser; track commit as experiment |
| **Settings** | Privacy panel, API tokens (Python SDK), Zotero, GitHub/GitLab, Mattermost, themes, delete account |

---

## Python SDK

**Experiment tracking that lives next to your thesis** — not a separate silo.

```bash
cd python && pip install -e '.[all,dev]'
```

```python
from weaveforge import track_experiment

@track_experiment(name="ablation lr=1e-4", sync={"tensorboard": "runs/exp1"})
def train(run):
    for step in range(1000):
        run.log_metric("val_loss", loss, step=step)
    run.log_figure(fig, name="samples")
    return {"val_acc": 0.91}

train()
```

- **Decorator or context manager** — creates experiment, logs curves to `experiment_metrics`, uploads artifacts, sets status on exit.
- **Framework callbacks** — `weaveforge.integrations.lightning`, `.keras`.
- **Import existing runs** — TensorBoard, wandb, or custom `MetricSource` (Open/Closed).
- **CLI** — `weaveforge list`, `import-tb`, `import-wandb`.

Generate a token in **Settings → Python SDK access tokens**, then configure:

```bash
export WEAVEFORGE_TOKEN=tt_...
export WEAVEFORGE_API_URL=http://localhost:3000
export WEAVEFORGE_PROJECT="My Thesis"   # or WEAVEFORGE_PROJECT_ID=<uuid>
```

Details: [`python/README.md`](python/README.md).

---

## Architecture

```
packages/core/     Domain entities, repository interfaces, use-cases (no React/Supabase)
apps/web/          Next.js PWA — features/{domain,application,infrastructure,ui}
                   bootstrap.ts = composition root; facades/ = UI API (ISP)
python/            Same contracts for experiment push + sync sources
supabase/          SQL migrations — single schema source of truth
```

- **Dependency inversion** — UI and scripts depend on interfaces; Supabase/Postgres adapters live in infrastructure.
- **Feature modules** — `registry.ts` builds nav; extend via ports + composition root (see [`docs/using/extensions.md`](docs/using/extensions.md)).
- **RLS everywhere** — anon key in the browser is fine; Postgres policies enforce access. Sharing adds read/comment; writes stay owner-only.

Deep dive: [`docs/building/design.md`](docs/building/design.md) · [`docs/using/extensions.md`](docs/using/extensions.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) (SOLID PR checklist) · `npm run check:solid` · `npm run check:dry`

---

## Documentation

Ordered the way you meet the project: use it, host it, then build on it. The
same split is the folder layout — [`docs/README.md`](docs/README.md) is the
index, and `docs/internal/` holds the working notes that are not a manual.

### 1 — Using WeaveForge

| Doc | Contents |
|-----|----------|
| [`docs/using/citations-and-overleaf.md`](docs/using/citations-and-overleaf.md) | Reading → notes → report → LaTeX: citations, excerpts, Overleaf export |
| [`docs/using/search.md`](docs/using/search.md) | One search box over papers, notes, experiments, PDF text and annotations |
| [`docs/using/paste.md`](docs/using/paste.md) | What happens to text pasted from a PDF, terminal, spreadsheet, or chat |
| [`docs/using/collaborative-editing.md`](docs/using/collaborative-editing.md) | Two people in one note, live cursors, no overwrite prompt |
| [`docs/using/desktop.md`](docs/using/desktop.md) | The desktop app — same account, own window |
| [`docs/using/workspace-folder.md`](docs/using/workspace-folder.md) | A folder of plain Markdown that mirrors your workspace, and reads your edits back |
| [`python/README.md`](python/README.md) | Python SDK — push ML runs into the same dashboard |
| [`docs/building/mcp.md`](docs/building/mcp.md) | MCP relay for driving WeaveForge from an AI assistant |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history (whole project) |

### 2 — Hosting WeaveForge

| Doc | Contents |
|-----|----------|
| [`docs/running/backend.md`](docs/running/backend.md) | Choosing a backend: Supabase or self-hosted Postgres |
| [`docs/running/postgres-provider.md`](docs/running/postgres-provider.md) | What the `postgres` backend provider actually selects |
| [`docs/running/oracle-shift.md`](docs/running/oracle-shift.md) | Start-to-finish move onto Oracle Cloud free tier |
| [`docs/running/storage/README.md`](docs/running/storage/README.md) | Blob storage as its own composition layer (R2, tiering, growth) |
| [`docs/internal/strategy/self-host-roadmap.md`](docs/internal/strategy/self-host-roadmap.md) | What is delivered vs still to provision for self-hosting |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Vulnerability reporting, RLS scope, data protection model |
| [`docs/using/integrations.md`](docs/using/integrations.md) | Zotero, Git, Mattermost — provider setup and env vars |
| [`docs/building/release.md`](docs/building/release.md) | The two release tracks: Python SDK (PyPI) and Android TWA |

### 3 — Developing WeaveForge

| Doc | Contents |
|-----|----------|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Start here — PR checklist, dev workflow, sign-off |
| [`docs/building/dev.md`](docs/building/dev.md) | Adding features and integrations, testing hooks, **enforced source hygiene** |
| [`docs/building/design.md`](docs/building/design.md) | Architecture, SOLID boundaries, module pattern |
| [`docs/using/extensions.md`](docs/using/extensions.md) | Extension seams — integrations, modules, backend, Python sync |
| [`docs/building/themes.md`](docs/building/themes.md) | CSS-variable theming, light/dark, card accent palette |
| [`docs/internal/strategy/ui-spec.md`](docs/internal/strategy/ui-spec.md) | Inventory of every screen, control, and state in the web app |
| [`docs/internal/reports/privacy-test-matrix.md`](docs/internal/reports/privacy-test-matrix.md) | Privacy guarantees mapped to the tests that prove them |
| [`docs/internal/plans/README.md`](docs/internal/plans/README.md) | Plan index — completed plans and where in-flight work would go |
| [`docs/internal/future-work/BACKLOG.md`](docs/internal/future-work/BACKLOG.md) | Proposed work not started |

---

## Install & configure (detailed)

### Monorepo layout

```
apps/web/         Next.js PWA
apps/pitch/       Static export of the pitch site (GitHub Pages)
apps/desktop/     Electron shell around the web app (see apps/desktop/README.md)
packages/core/    @weaveforge/core — shared domain + use-cases
supabase/         Migrations 0001…0117 (see supabase/migrations/README.md)
python/           weaveforge SDK
docs/             using/ building/ running/, and internal/ working notes
```

### Supabase project

1. [supabase.com](https://supabase.com) → **New project**.
2. **Settings → API** — copy Project URL and anon key into `.env.local`.
3. **Authentication** — enable Email (and optional Google). Add `http://localhost:3000` to redirect URLs.

### Environment (`apps/web/.env.local`)

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# Server-only, required for linked Overleaf reports; never expose to the browser.
# Use a stable long random value so stored credentials remain decryptable.
# OVERLEAF_CREDENTIAL_KEY=...
# Optional: NEXT_PUBLIC_BACKEND_PROVIDER=supabase | postgres
# Optional integration overrides — see docs/using/integrations.md
```

### Database

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Apply the full chain with `supabase db push`. Notable groups: org hierarchy (`0015`), sharing (`0018`), vault (`0027`), invite codes (`0028`), library pins (`0029`), share links (`0047`–`0049`), API tokens (`0061`), standalone role (`0064`), Overleaf linked reports (`0075`–`0077`), database hardening (`0078`–`0088`), and experiment metric chunks (`0115`). `0037`–`0041` and `0089`–`0095` created the client-side E2EE key tables; that feature was dropped and nothing reads them, but no migration removes them. Full list: [`supabase/migrations/README.md`](supabase/migrations/README.md).

### Collaboration

- **Share** individual items or whole types with labmates; recipients use **Shared with me** and can **pin** into their library.
- **Co-editing** — vault notes and logbook entries are live multi-user documents: peer cursors, presence, no save button and no overwrite. Backed by a Yjs CRDT over Realtime, durable in `crdt_updates`. See [Collaborative editing](docs/using/collaborative-editing.md).
- **Labs** — Settings → People → create/join lab or continue standalone. Professors get three invite codes.
- **Supervisor view** — read-only access to supervisees' milestones and log entries along the org tree.

On first sign-in, complete org setup in **Settings → People** (create/join a lab or continue standalone). Professors receive three invite codes for provisioning accounts.

---

## Scripts

**Before opening a PR, run one command:**

```bash
npm run check:all
```

That is the same gate CI runs — typecheck across every workspace, lint,
`check:boundaries`, the core / web / desktop suites, and a production Next.js
build. Everything below is a piece of it, useful when you want a faster loop.

```bash
npm run dev              # web app @ :3000
npm run build:core       # compile @weaveforge/core
npm run test:core        # domain + contract tests
npm run test:web         # web unit suite
npm run test:integration:web
npm run typecheck        # all workspaces
npm run lint
npm run check:boundaries # every architectural check below, in one go
npm run check:solid      # boundary lint (UI ↔ facades, no cross-feature /ui imports)
npm run check:dry        # DRY lint (pin/share/owner-label patterns centralised in core)
npm run check:hygiene    # source hygiene — see docs/building/dev.md
npm run dev --workspace @weaveforge/pitch     # pitch site @ :3300
npm run build --workspace @weaveforge/pitch   # static export -> apps/pitch/out
```

---

## Deploy

- **Web** → Vercel (or any Node host): root `apps/web`, set `NEXT_PUBLIC_SUPABASE_*`, add production URL to Supabase Auth redirects.
- **Database** → Supabase hosted or self-hosted Postgres per [`docs/running/backend.md`](docs/running/backend.md).
- **Pitch site** → GitHub Pages, built from `apps/pitch` by
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
  `main` that touches it. See [The pitch site ↓](#the-pitch-site).

Self-hosting has no WeaveForge subscription fee; infrastructure providers may
still charge for compute, storage, email, backups, and bandwidth. Hosted
WeaveForge pricing and usage limits are planned separately.

---

## The desktop app

`apps/desktop` is an Electron window that loads the web app — the same Next.js
build a browser loads — and adds only what a browser genuinely cannot do. Like
the pitch site, it is **not a copy**: three small files, and the two things it
adds import the web app's own modules rather than restating them.

Today that is fetching a pasted link's title and downloading a pasted image
address, both of which a browser has to route through our server because of
CORS. The desktop app does them directly, through the same address guard, by
importing the same `fetch-for-paste` module the API route uses.

```bash
npm run dev --workspace @weaveforge/web       # the app, on :3000
npm start --workspace @weaveforge/desktop     # a window pointed at it
```

Adding a capability without writing it twice — declare it on `DesktopBridge`,
give it a browser implementation beside the desktop one, pick between them at
the call site — is written up in `apps/desktop/README.md`.

## The pitch site

A public product page lives at `/pitch` in the app and is published to GitHub
Pages as a static site.

It is **not a copy**. `apps/pitch` is a second Next app with exactly one route,
which re-exports the same page component the app serves — so every card on the
marketing page is the product's own `<EntityCard>`, painted by the same
`apps/web/src/app/styles/` and themed by the same tokens in `apps/web/src/app/themes/`. Change a card in the product
and the published page changes with it.

It exists as a separate app because the product cannot be statically exported:
it has 35 API routes and a runtime that expects a server. The pitch has neither.

```bash
npm run dev --workspace @weaveforge/pitch      # :3300
npm run build --workspace @weaveforge/pitch    # -> apps/pitch/out
```

**Publishing** needs two things set once in the repository:

1. **Settings → Pages → Source: GitHub Actions.** Without this the deploy step
   has nowhere to publish to.
2. **An `APP_URL` repository variable** pointing at the deployed app — it is
   where the page's "Open the app" buttons go. Without one they fall back to
   this repository rather than looping visitors back to the pitch page.

The workflow sets `BASE_PATH` to the repository name so assets resolve under
`user.github.io/<repo>/`; set it to empty for a custom domain at the apex. It
also writes `.nojekyll`, because Jekyll silently drops the `_next/` directory
that every stylesheet and script lives in.

---

## License

**[AGPL-3.0-only](LICENSE)** — the entire repository, including the Python SDK and the MCP plugin. No permissive carve-outs.

WeaveForge is open source for the researchers who use it, and the copyleft is what keeps it that way. If you modify WeaveForge and make it available over a network, AGPL-3.0 section 13 requires that you offer your users the corresponding source of your version. You may not take this work private.

Using or self-hosting WeaveForge places no obligations on you. Self-hosting has no subscription fee.

[`LICENSE`](LICENSE) · [`NOTICE`](NOTICE) · [`CONTRIBUTORS.md`](CONTRIBUTORS.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)
