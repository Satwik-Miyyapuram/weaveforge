# Thesis Tracker

[![CI](https://github.com/Satwik-Miyyapuram/thesis_tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Satwik-Miyyapuram/thesis_tracker/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](python/)

**One workspace for your whole thesis** — papers, reading lists, citation graph, plan, logbook, report outline, experiments, vault notes, and lab collaboration. Open-source and self-hostable under AGPL-3.0-only; hosted WeaveForge access and usage limits are part of the pricing plan.

Most thesis tools split the job: Zotero for papers, Notion for notes, wandb for runs, Google Docs for the write-up. Thesis Tracker keeps the **literature**, **plan**, **experiments**, and **writing** in one modular PWA, with optional Zotero sync, git integration, and supervisor sharing — so your advisor sees real objects, not screenshots.

---

## Two products, one database

| | **Web app** (`apps/web`) | **Python SDK** (`python/`) |
|---|--------------------------|----------------------------|
| **What** | Next.js PWA — library, graph, plan, log, report, experiments, vault, sharing | Push runs, curves, and figures from training scripts |
| **Install** | `npm install` + Supabase project | `pip install -e python` |
| **Best for** | Day-to-day thesis work in the browser | `@track_experiment`, Lightning/Keras callbacks, TensorBoard/wandb import |
| **Docs** | [Quick start ↓](#quick-start) · [Features ↓](#features) | [Python SDK ↓](#python-sdk) · [`python/README.md`](python/README.md) |

Both talk to the **same Postgres schema** (`supabase/migrations/`). Log a run in Python → compare it in the dashboard next to the paper it implements.

---

## Why you use it as a researcher

- **Papers + graph + lists** — import from URL, arXiv, DOI, or Zotero; force-graph citations and `#tags`; nested reading lists.
- **Plan + logbook** — milestones with dependencies and compute estimates; markdown daily log; supervisor read access along the org tree.
- **Experiments tied to code** — branch/commit pinning, metric curves, artifact uploads, compare view for sweeps.
- **Report + vault** — nested report sections with progress; Obsidian-style vault pages for long-form notes.
- **Collaboration** — share papers, experiments, sections, vault notes, or whole types with labmates; **pin shared items into your library**; comment threads and **co-editing** where granted.
- **Privacy model** — data stored server-side with encryption at rest; Postgres RLS is the access boundary (owner-or-shared); external **view links** (`/link?t=…`) with optional expiry. Not end-to-end encrypted.
- **Labs without IT** — professors create a lab and share three invite codes (professor / PhD / masters); join with a code or run **standalone**.

Built **TDD + SOLID**: framework-agnostic core (`@thesis/core`), repository contracts with shared test suites, feature facades for the UI, env-driven integrations (Zotero, GitHub, GitLab, Mattermost, Semantic Scholar).

---

## Quick start

**Prerequisites:** Node.js 20+, a [Supabase](https://supabase.com) project (or self-hosted Postgres — see [`docs/backend.md`](docs/backend.md)).

```bash
git clone https://github.com/Satwik-Miyyapuram/thesis_tracker.git
cd thesis_tracker
npm install
npm run build:core
npm run test:core          # 170+ domain tests, no network
```

1. Copy `apps/web/.env.local.example` → `apps/web/.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Apply schema: `supabase link --project-ref <ref> && supabase db push` (or paste migrations in the SQL editor — see [`supabase/migrations/README.md`](supabase/migrations/README.md)).
3. `npm run dev` → http://localhost:3000 — sign in, create a project, start adding papers.

Full setup (Auth providers, integrations, deploy): sections below and [`docs/dev.md`](docs/dev.md).

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
| **Vault / Notes** | Wiki-style encrypted pages with asset attachments; collaborative editing |
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
from thesis_tracker import track_experiment

@track_experiment(name="ablation lr=1e-4", sync={"tensorboard": "runs/exp1"})
def train(run):
    for step in range(1000):
        run.log_metric("val_loss", loss, step=step)
    run.log_figure(fig, name="samples")
    return {"val_acc": 0.91}

train()
```

- **Decorator or context manager** — creates experiment, logs curves to `experiment_metrics`, uploads artifacts, sets status on exit.
- **Framework callbacks** — `thesis_tracker.integrations.lightning`, `.keras`.
- **Import existing runs** — TensorBoard, wandb, or custom `MetricSource` (Open/Closed).
- **CLI** — `thesis-tracker list`, `import-tb`, `import-wandb`.

Generate a token in **Settings → Python SDK access tokens**, then configure:

```bash
export THESIS_TRACKER_TOKEN=tt_...
export THESIS_TRACKER_API_URL=http://localhost:3000
export THESIS_TRACKER_PROJECT="My Thesis"   # or THESIS_TRACKER_PROJECT_ID=<uuid>
```

Details: [`python/README.md`](python/README.md).

---

## Architecture

```
packages/core/     Domain entities, repository interfaces, use-cases (no React/Supabase)
apps/web/          Next.js PWA — features/{domain,application,infrastructure,ui}
                   bootstrap.ts = composition root; facades.ts = UI API (ISP)
python/            Same contracts for experiment push + sync sources
supabase/          SQL migrations — single schema source of truth
```

- **Dependency inversion** — UI and scripts depend on interfaces; Supabase/Postgres adapters live in infrastructure.
- **Feature modules** — `registry.ts` builds nav; extend via ports + composition root (see [`docs/extensions.md`](docs/extensions.md)).
- **RLS everywhere** — anon key in the browser is fine; Postgres policies enforce access. Sharing adds read/comment; writes stay owner-only.

Deep dive: [`docs/DESIGN.md`](docs/DESIGN.md) · [`docs/extensions.md`](docs/extensions.md) · [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) (SOLID PR checklist) · `npm run check:solid` · `npm run check:dry`

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Architecture, SOLID, module pattern |
| [`docs/extensions.md`](docs/extensions.md) | **How to extend** — integrations, modules, Python sync |
| [`docs/dev.md`](docs/dev.md) | Adding features, integrations, caching |
| [`docs/release.md`](docs/release.md) | **Python SDK releases** (PyPI); web ships on `main` |
| [`docs/integrations.md`](docs/integrations.md) | Zotero, Git, Mattermost, providers |
| [`docs/backend.md`](docs/backend.md) | Supabase vs self-hosted Postgres |
| [`docs/themes.md`](docs/themes.md) | Light/dark themes |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Vulnerability reporting, RLS scope, data protection model |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | PR checklist, dev workflow |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Python SDK release history |
| [`docs/self-host-roadmap.md`](docs/self-host-roadmap.md) | Self-hosted Postgres + tiered blobs |
| [`docs/plans/README.md`](docs/plans/README.md) | Plan index — current / working / future / completed |
| [`docs/plans/future/hosting-and-cost-plan.md`](docs/plans/future/hosting-and-cost-plan.md) | Hosted access, usage limits, pricing planning, and self-hosting |
| [`docs/plans/completed/modular-deployment-plan.md`](docs/plans/completed/modular-deployment-plan.md) | Configurable feature, integration, MCP, backend, and storage boundaries |

---

## Install & configure (detailed)

### Monorepo layout

```
apps/web/         Next.js PWA
packages/core/    @thesis/core — shared domain + use-cases
supabase/         Migrations 0001…0088 (see supabase/migrations/README.md)
python/           thesis-tracker SDK
docs/             Design, dev guide, integrations
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
# Optional integration overrides — see docs/integrations.md
```

### Database

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Apply the full chain with `supabase db push`. Notable groups: sharing (`0018`), org hierarchy (`0015`), vault (`0027`), invite codes (`0028`), library pins (`0029`), E2EE crypto (`0037`–`0041`), share links (`0047`–`0049`), API tokens (`0061`), standalone role (`0064`), epoch consolidation (`0066`), Overleaf linked reports (`0075`–`0077`), and database hardening (`0078`–`0088`). Full list: [`supabase/migrations/README.md`](supabase/migrations/README.md).

### Collaboration

- **Share** individual items or whole types with labmates; recipients use **Shared with me** and can **pin** into their library.
- **Labs** — Settings → People → create/join lab or continue standalone. Professors get three invite codes.
- **Supervisor view** — read-only access to supervisees' milestones and log entries along the org tree.

On first sign-in, complete org setup in **Settings → People** (create/join a lab or continue standalone). Professors receive three invite codes for provisioning accounts.

---

## Scripts

```bash
npm run dev              # web app @ :3000
npm run build:core       # compile @thesis/core
npm run test:core        # domain + contract tests
npm run test:integration:web
npm run typecheck        # all workspaces
npm run check:solid      # boundary lint (UI ↔ facades, no cross-feature /ui imports)
npm run check:dry        # DRY lint (pin/share/owner-label patterns centralised in core)
```

---

## Deploy

- **Web** → Vercel (or any Node host): root `apps/web`, set `NEXT_PUBLIC_SUPABASE_*`, add production URL to Supabase Auth redirects.
- **Database** → Supabase hosted or self-hosted Postgres per [`docs/backend.md`](docs/backend.md).

Self-hosting has no WeaveForge subscription fee; infrastructure providers may
still charge for compute, storage, email, backups, and bandwidth. Hosted
WeaveForge pricing and usage limits are planned separately.

---

## License

**[AGPL-3.0-only](LICENSE)** — the entire repository, including the Python SDK and the MCP plugin. No permissive carve-outs.

WeaveForge is open source for the researchers who use it, and the copyleft is what keeps it that way. If you modify WeaveForge and make it available over a network, AGPL-3.0 section 13 requires that you offer your users the corresponding source of your version. You may not take this work private.

Using or self-hosting WeaveForge places no obligations on you. Self-hosting has no subscription fee.

[`docs/licensing.md`](docs/licensing.md) · [`NOTICE`](NOTICE) · [`CONTRIBUTORS.md`](CONTRIBUTORS.md) · [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
