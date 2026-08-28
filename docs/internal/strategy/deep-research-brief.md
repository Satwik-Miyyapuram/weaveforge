# WeaveForge — Product brief for Deep Research

**Purpose of this document.** Give an external research model (e.g. Gemini Deep Research) a complete, accurate inventory of what WeaveForge already ships, how it works, and what constraints are non-negotiable — so it can compare us to other note / reference / writing / discovery / experiment tools and recommend concrete feature improvements without inventing capabilities we do not have.

**Product name.** The product is **WeaveForge**. The repository and Python SDK use the internal code name `weaveforge`. Refer to the product as WeaveForge throughout.

---

## 0. Disambiguation and negative constraints (READ FIRST)

A prior Deep Research run failed by retrieving an unrelated product with a similar name and presenting its architecture as ours. To prevent recurrence:

**We are NOT, and no claim about us may be sourced from:**

- Any **investment / financial** "thesis tracker" — investment theses, market-close jobs, Yahoo Finance or FRED pulls, price targets, trade confidence scores, "wins and losses" track records. Different product, same name. If a source discusses financial theses, it is not about us; discard it entirely.
- Anthropic's `weaveforge` **agent skill** listed in financial-services skill directories. Not our product.
- Any **Cloudflare Workers / edge SQLite / D1** architecture. We are Next.js on Vercel with Postgres via Supabase (§2).
- Any **Zod-validated autonomous MCP tool server with Bearer-token nightly cron writes**. Our MCP is browser-paired, fail-closed, proposal-only, default off (§6.16).

**Rules for this run:**

1. §1–§13 of this document are the **only** ground truth for what WeaveForge is and does. External sources may be used **only** for competitor and market claims, never for claims about WeaveForge.
2. Do **not** attempt to access, log into, or evaluate any live deployment. There is no staging URL or test account for this research. Do not write a UI/UX evaluation of screens you have not seen; evaluate the **specified** UX from §6 instead, and say so.
3. Before recommending any feature, **cite the §6 subsection** that shows we do not already have it. If §6 already describes it, the correct output is "already shipped — the gap is X" or nothing.
4. Any recommendation matching an item in **§11 non-goals** is auto-rejected. Do not include it, not even as a "consider later". If you believe a non-goal is strategically wrong, confine that to a single clearly-labelled "Challenges to stated non-goals" box of at most 200 words, with evidence — do not build roadmap items on it.
5. **Source quality.** Prefer primary sources: official product docs, changelogs, published benchmarks, peer-reviewed or first-party engineering writeups. Vendor marketing pages and SEO listicles may be cited at most once each and must be labelled `[vendor claim]`. Do not build a comparison matrix on a single blog post. Give the accessed date honestly; if a fetch fails, omit the source rather than citing a failed retrieval.
6. **Answer every question in §14 by its number.** If a question cannot be answered, print its number and `UNANSWERED — reason`. A report that silently skips questions is a failed deliverable.

**Audience for research.** Primary user = Master's / PhD researcher over months–years. Secondary = small academic lab (professor → PhD → masters supervision). Also usable fully standalone (no lab).

**License / distribution.** Open-source AGPL-3.0-only throughout (including the Python SDK and Codex MCP plugin); self-hostable; hosted WeaveForge access and usage limits are part of commercial planning.

---

## How to use this brief (instructions for the research model)

1. Treat §1–§13 as **ground truth** for what exists today. Prefer this over marketing copy that still mentions E2EE or logbook “hours/mood” — those are outdated.
2. Compare WeaveForge against: Obsidian (+ Zotero plugins), Notion, Logseq/RemNote, Zotero, Mendeley, Paperpile, EndNote, Citavi, LiquidWorkspace, LiquidText, Readwise Reader, ResearchRabbit / Litmaps / Connected Papers / Elicit / Semantic Scholar, wandb / MLflow / TensorBoard, Overleaf, Roam.
3. Recommend improvements that fit a **thesis OS** (literature ↔ notes ↔ plan ↔ experiments ↔ writing ↔ lab), not a general PKM or Word plugin.
4. Respect **explicit non-goals** in §11 and the negative constraints in §0.
5. Answer the research questions in §14 **by number**, with prioritized, concrete recommendations (steal / adapt / skip), UX patterns, and competitive gaps.

### Self-check before you output

Confirm each of these in a short preamble block. If any is `NO`, fix the report before returning it.

- [ ] Every WeaveForge claim traces to a §-number in this brief, not to an external source.
- [ ] No recommendation appears in §11 non-goals.
- [ ] No recommendation duplicates something already described in §6 without saying so.
- [ ] All of Q1–Q23 appear by number (answered or explicitly `UNANSWERED`).
- [ ] Comparison matrix covers ≥8 tools × the 11 dimensions in Q18.
- [ ] All five Q23 teardowns present, each following the fixed structure, each describing workflow mechanics rather than restating the matrix.
- [ ] Roadmap has explicit P0/P1/P2 with effort × impact.
- [ ] No source cited more than 3 times; vendor pages labelled `[vendor claim]`.

---

## 1. One-sentence product

**WeaveForge is a private research workspace that connects a thesis’s literature, notes, plan, experiments, writing outline, and lab collaboration in one modular PWA — plus a Python SDK that writes experiment runs into the same database.**

It is not “just” a note app, reference manager, task tracker, or MLOps tool. It is the **research map** that connects specialist tools (Zotero for PDFs/annotations, Git for code, Overleaf for LaTeX compile) without replacing them.

### Core mental model (seven connected areas)

| Area | Holds | Why it matters |
|------|--------|----------------|
| Library | Papers, metadata, tags, summaries, Zotero annotations, custom fields | What has been / must be read |
| Graph & lists | Citation/typed relations, concepts/tags, nested reading lists + extraction table | How literature fits together |
| Notes | Paper notes + Obsidian-like vault | What the researcher thinks |
| Plan & logbook | Milestones, deps, compute estimates; dated research log | What must happen / what happened |
| Experiments | Runs, metrics, artifacts, git pins (web + Python SDK) | What was tried and results |
| Report | Nested outline, status, word targets; Overleaf link/export | How research becomes a thesis |
| People & sharing | Labs, invite codes, supervision tree, shares, pins, comments, co-edit, share links | Discuss real objects, not screenshots |

Connectiveness is the product idea: a paper can sit in a list, appear on the graph, link to an experiment, show up in a log entry, and be cited from a report section.

---

## 2. Tech stack and architecture

### Stack

| Layer | Technology |
|-------|------------|
| Web PWA | Next.js 14, React 18, TypeScript, Serwist service worker, CodeMirror 6, KaTeX, Shiki, react-force-graph-2d / d3-force, react-grid-layout, Yjs + y-codemirror (collab), uPlot, fflate, isomorphic-git, libsodium |
| Domain | `@weaveforge/core` (`packages/core`) — entities, ports, use-cases; **no** React/Supabase |
| Database | Postgres via Supabase (default); migrations in `supabase/migrations/` (through `0105+`) |
| Auth | Supabase Auth (email + optional Google); JWT + **Postgres RLS** |
| Blobs | Supabase Storage buckets; pluggable `IBlobStore` (R2/S3/tiered planned) |
| Python SDK | `python/` — PyPI package `weaveforge`; httpx + supabase; Lightning/Keras/TensorBoard/wandb extras |
| MCP plugin | `plugins/weaveforge-research/` — Codex marketplace plugin; model-agnostic MCP client |
| Android | Trusted Web Activity wrapper (`apps/web/twa/`) |
| Deploy | Vercel + Supabase; self-host Postgres path documented |
| Quality | TDD; SOLID/DRY boundary lints; colocated API route tests; Playwright e2e |

### Architecture pattern

```
UI (features/*/ui)
  → Facades (container/facades/)   // ISP UI API
  → Use-cases (@weaveforge/core)
  → Repository ports
  → Supabase / Postgres adapters (infrastructure)
```

Composition roots: `bootstrap.ts`, `wire-backend.ts`, `wire-integrations.ts`, `wire-storage.ts`.

**Two clients, one schema:** Web PWA and Python SDK both use the same Postgres migrations. An experiment logged from a training script appears next to the paper it implements in the dashboard.

**API surface split (intentional):**

| Surface | Used for |
|---------|----------|
| **Next `/api/*`** | Server-key credentials, MCP/API tokens, blobs, org admin, Overleaf, MCP relay, SDK |
| **Supabase PostgREST + RLS** | Papers, vault, logbook, projects, sharing, comments, non-secret settings |

UI never calls `supabase.from()` directly — only via repositories through `getContainer()`.

### Modular deployment

`weaveforge.config.ts` + code generation can allowlist/strip features, integrations, and MCP at deploy time (hosted vs self-host profiles).

---

## 3. Privacy, security, and data model

### Current model (authoritative)

- Client-side **E2EE has been dropped**.
- Content is stored **server-side plaintext** with database encryption **at rest**.
- **Postgres Row-Level Security is the sole access boundary** (owner-or-shared).
- An operator with database access can technically read content. This is **not** zero-knowledge.
- Integration secrets (Zotero, GitLab, Semantic Scholar, Overleaf tokens) are sealed with a **server-held key** (`/api/settings/credentials`, `OVERLEAF_CREDENTIAL_KEY`). They are **never** exposed to the AI/MCP layer.
- External share links (`/link?t=…`) are view-scoped; treat URLs like passwords; redemption is rate-limited.

### Auth

- Supabase `auth.users`; browser session via anon key (anon key is public by design; RLS enforces access).
- Account deletion is OTP-gated.
- Admin can provision users via `/api/admin/create-user` (service role) for labs.
- Recovery routes exist (`/recover`, `/reset-password`); historical E2EE recovery docs remain but product model is RLS + at-rest.

---

## 4. Projects (workstreams)

Users can have **multiple projects** (thesis / paper / side track). Each project has:

- Color + switcher in the shell
- Scoped papers, reading lists, experiments, dashboard layout, graph settings
- Optional per-project **Zotero collection** binding
- Optional per-project **integrations** (GitHub/GitLab/Mattermost credentials bag)

Tables: `projects`, `project_zotero_collection`, `project_integrations`, `project_dashboard_layout`, `project_graph_settings`.

---

## 5. Organizations (labs), roles, supervision

### Concepts

| Concept | Detail |
|---------|--------|
| **Organization (lab)** | Named lab workspace |
| **Memberships** | User ↔ org with a role and optional `supervisor_id` |
| **Roles** | `professor` · `phd` · `masters` (+ `standalone` for no-lab use) |
| **Invite codes** | Three Crockford Base32 codes (one per role); hashed at rest; plaintext shown only at create/regenerate |
| **Supervision tree** | Masters → PhD → professor via `supervisor_id` |
| **Org switcher** | Multi-lab membership; `active_org_id` |
| **Standalone** | Continue without a lab (`/api/org/standalone`) |

### User-facing flows

- Settings → People / `/org`: create lab, join with code, leave, regenerate codes, org chart.
- Professors (and role-scoped flows) can provision accounts for the lab.
- **Supervision** (`/supervision`): read-only view of supervisees’ **milestones** and **log entries** along the org tree — not a full impersonation of their library.

### APIs

`/api/org/{create,join,leave,codes,mine,memberships,switch,standalone}`

### Tables

`organizations`, `org_memberships`, `org_invite_codes`, `profiles`

---

## 6. Feature catalog (exhaustive)

### 6.1 Papers / Library (`/papers`)

**What users do**

- Add papers via **URL**, **arXiv id**, **DOI**, **manual** entry, or **Zotero**.
- Track reading status: `to_read` | `reading` | `read` | `skimmed`.
- Rate 1–5; edit markdown **paper note** (summary) with `#hashtags`, `[[wikilinks]]`, KaTeX `$…$` / `$$…$$`.
- Attach figures (`paper-images` bucket).
- Layouts: **Cards | List | Board** (board columns = status).
- **Sync Zotero** (bidirectional papers; annotations pulled into cache).
- **Find related papers** (Semantic Scholar recommendations → citation-neighbor fallback): shows title, authors, year, **URL**, **citation count**; Open paper / Add to library; filters items already in library by DOI / arXiv / title.
- **Citation alerts** (bell on paper): needs DOI or arXiv; polls Semantic Scholar for new citing works; notifies via **logbook** entry + optional **Mattermost**; ≤ ~1 check/paper/day from app shell.
- **Custom fields** (project-scoped): kinds `text`, `number`, `select`, `multi_select`, `relation`, `rollup` (`count` / `values` / `sum` / `avg`). Inline edit on paper; Manage UI to add/rename/delete defs.
- **Zotero annotation cards** (read-only): quote, comment, page, colour, tags; **Copy quote + cite** (blockquote + `[[Paper]]`); **Pin to report section** (`annotation_pins` table — not vault notes).
- Source-note style layout: metadata block + sections for fields, annotations, related papers, etc.

**Tech notes**

- Table `papers` (+ `project_id`); unique per-user DOI/arXiv where set.
- `metadata` JSON holds annotations, citeKey, images paths, etc.
- `paper_field_defs` / `paper_field_values`; `annotation_pins`; `citation_alert_tracks`.
- Metadata providers: arXiv proxy `/api/arxiv`, Crossref, `/api/url-meta`, Zotero-by-key, Semantic Scholar `/api/s2/[...path]`.
- **PDFs are not stored in-product** — Zotero (or ZotMoov) remains PDF/annotation authority. Explicit non-goal: full in-app PDF annotator.

---

### 6.2 Tags / concepts

- First-class tag entities linked to papers via `paper_tags`.
- Provenance sources include `manual`, `summary` (from `#hashtags` in notes), `zotero_item`, `zotero_annotation`.
- Appear as **concept nodes** on the graph (with degree filters).
- Dashboard can show top tags.

---

### 6.3 Reading lists (`/lists`)

- Nested hierarchical lists (tree with expand/collapse).
- Items are **papers XOR vault notes** (optional per-item notes).
- Papers/notes can belong to many lists; inherited memberships supported historically.
- Shareable as a unit.
- View toggle per list: **Tree | Table**.
- **Extraction table**: flattens member papers (including nested sublists); column picker (built-ins + custom fields); inline cell edit; **Copy markdown** / **Copy CSV**.

Tables: `reading_lists`, `reading_list_items`.

---

### 6.4 Graph / relations (`/graph`)

- Force-directed graph of **papers**, **vault notes**, **tags/concepts**, **report sections**.
- Typed edges: `cites`, `extends`, `contradicts`, `similar`, `builds_on`, `uses_method` (source `manual` | `auto`).
- Auto citation linking via Semantic Scholar `ICitationSource`.
- Wikilinks in vault bodies, paper summaries, and section notes become edges.
- Project-scoped graph settings persisted.

Table: `paper_relations`, `project_graph_settings`.

---

### 6.5 Cite-while-writing, jump-to, Overleaf cite pipeline

In **Vault notes**, **paper notes**, and **report section notes**:

1. Type `[[` (title picker) or `@` after space/punctuation (author/year · title when available).
2. Insertion is always `[[Exact Title]]` (title match drives graph + LaTeX).
3. **Jump to** (`Ctrl/Cmd+K`): papers, notes, sections; empty query shows **recently opened** (project-scoped, browser-local).

**Overleaf / LaTeX export** (`/report/overleaf`):

- Local ZIP: `main.tex`, `references.bib`, figures — **does not auto-push** to Overleaf.
- `[[Paper Title]]` → `\cite{key}` when bibliography included.
- Cite key preference: `metadata.citeKey` → key in `bibtex` → Better BibTeX `Citation Key:` in Zotero extra → DOI / arXiv / id.
- Linked Overleaf projects use **server-encrypted** git tokens; linked content is **read-only** in-app.

Tables: `overleaf_connections`, `overleaf_linked_reports`.

---

### 6.6 Plan / milestones (`/plan`)

- Thesis milestones with status `planned` | `in_progress` | `done` | `blocked`.
- Deadlines, dependencies (`milestone` | `experiment` | `paper` | `external`), compute estimates `{resource, count, hours}`.
- Progress UI; optional **Mattermost** notification on change (best-effort).
- Supervisors can read along the org tree.

Table: `milestones`.

---

### 6.7 Logbook (`/log`)

- Dated markdown research log entries with `kind` (e.g. daily / weekly).
- Optional links to papers / experiments / report sections.
- Citation-alert notifications create log entries.
- Optional push to GitLab via `ILogSyncIntegration` (must not block local write).
- **Note:** Some older README copy mentions “hours” and “mood”; the current domain model is date / kind / body / links — do not assume hours/mood fields exist.

Table: `log_entries`.

---

### 6.8 Report outline (`/report`)

- Nested section tree; status `not_started` | `drafting` | `review` | `done`.
- Word targets, deadlines, progress.
- Section markdown notes with cite/wikilink/equation support.
- **Pinned annotations** pane (from paper pins): Insert / Copy / Unpin into section draft.
- Shareable sections.
- **Hard exclusion for AI:** MCP/AI **cannot** read or write report content.

Table: `report_sections`.

---

### 6.9 Vault / Notes (`/notes`, alias `/vault`)

Obsidian-like nested markdown pages:

- Unique titles; hierarchy via parent.
- Wikilinks, backlinks, block refs, equations, images (`vault-assets`).
- Import ZIP / folder (Obsidian-style vault import).
- Share, comment, pin into library; **co-edit** when share access is `edit` (Yjs CRDT → `crdt_updates`, plaintext post-E2EE drop).

Table: `vault_pages`.

---

### 6.10 Experiments + Python SDK + tokens (`/experiments`)

**Web UI**

- Experiment entities: status `planned` | `running` | `done` | `failed` | `abandoned`.
- Config JSON, summary metrics, step curves (`experiment_metrics`), artifacts (`experiment-artifacts` bucket).
- Git branch/commit pin; link to related paper; compare view (table + overlaid charts).
- Stale-running detection (~2 minutes without heartbeat/update).

**Python SDK (`weaveforge` on PyPI)**

- Auth: personal access tokens `tt_…` created in **Settings → Python SDK / API tokens**; hashed at rest; shown once; same RLS as the user.
- Env: `WEAVEFORGE_TOKEN`, `WEAVEFORGE_API_URL`, `WEAVEFORGE_PROJECT` or `…_PROJECT_ID`.
- `@track_experiment` / context manager: creates run, logs metrics, uploads figures, sets status on exit.
- Framework callbacks: Lightning, Keras.
- Import: TensorBoard, wandb, or custom `MetricSource` (Open/Closed).
- CLI: `weaveforge list`, `import-tb`, `import-wandb`.

**SDK HTTP APIs:** `/api/sdk/{whoami,projects,experiments,metrics,artifacts}`

Tables: `experiments`, `experiment_metrics`, `api_tokens`.

---

### 6.11 Dashboard (`/dashboard`)

Customizable react-grid-layout of cards:

- Reading / report / plan progress
- Experiments summary
- Needs attention (unread, overdue, upcoming)
- Recent log, library snapshot, top tags
- Role-gated team cards: team roster, team attention, supervisee snapshot

Persisted per project: `project_dashboard_layout`.

---

### 6.12 Sharing, comments, pins, share links (`/shared`, `/link`)

**Shareable types:** paper, vault_page, reading_list, report_section, experiment, milestone (item or whole type).

**Access levels:** `view` | `comment` | `edit`.

**Behaviors**

- Share with labmates; recipients see **Shared with me** inbox with native cards.
- **Pin** shared items into own library index (`library_pins`) — “Add to library” without copying ownership of the source of truth where designed as pin.
- Comment threads on resources.
- External **share links** with hashed token, optional expiry, view-only redeem at `/link?t=…`; rate limits on redemption.
- Writes generally remain **owner-only** except where collab edit is explicitly granted.

Tables: `shares`, `comments`, `library_pins`, `share_links`, `share_link_rate_limits`.

---

### 6.13 Collaborative editing

- Real-time co-edit via Yjs + CodeMirror when share access is `edit`.
- Persistence: `crdt_updates` (plaintext after E2EE removal).
- Supabase Realtime auth for channel access.

---

### 6.14 Sync / Git / Mattermost (`/git`, Settings → Connections)

| Integration | Direction | Scope | Behavior |
|-------------|-----------|-------|----------|
| GitHub | Read | Project | Branch/commit browser; track commit as experiment |
| GitLab | Read (+ log sync write) | Project | Same + optional log push |
| Mattermost | Write | Project | Milestone changes + citation alerts |
| Zotero | Bi-dir papers; annotations in | User (+ per-project collection) | Browser-direct API |
| Semantic Scholar | Read | User (optional API key) | Graph auto-link, related papers, citation alerts |

Env knobs can disable providers (`NOTIFICATION_PROVIDER`, `LOG_SYNC_PROVIDER`, `GIT_READ_PROVIDERS`, etc.). Browser talks **directly** to providers where possible (CORS required for self-hosted GitLab/Mattermost) — no credential proxy for those flows.

---

### 6.15 Settings (`/settings`)

Sections typically include:

- Account
- Appearance / themes (Catppuccin latte/frappe/mocha, amoled, control size — see `docs/building/themes.md`)
- **AI & MCP** access (opt-in sources, session duration, MCP tokens, pairing)
- **API tokens** for Python SDK
- Integrations credentials (Zotero, Semantic Scholar, …) via server-key seal
- Project connections (GitHub/GitLab/Mattermost)
- Full-account **ZIP export** (domain JSON + vault/paper blobs)
- Privacy notice / disclaimer acceptance
- Delete account (OTP)

Table: `user_settings` (integrations bag, appearance, `aiAccess`, disclaimer version).

---

### 6.16 AI assistant / MCP (no in-app chat)

**Product stance:** Model-agnostic MCP research assistant. First client = Codex plugin. **Not** an in-app chatbot. **Not** a server-side model proxy. Default **off**.

#### Connection model

1. User enables AI & MCP, selects allowed **source categories**, starts a **time-limited browser session** (15 minutes → one week).
2. Creates a revocable **MCP token** (shown once) + receives **session id** + **pairing secret**.
3. Local plugin encrypts tool calls with the pairing secret and posts opaque envelopes to the **relay**.
4. Only the unlocked browser claims, decrypts, permission-checks, executes, encrypts, and returns results.
5. Direct `/api/mcp` stays **fail-closed (503)** by design; clients use `/api/mcp/relay` (+ browser claim endpoints).

#### Read-only tools

- `search_workspace`
- `get_source_excerpt`
- `get_workspace_outline`

Operate only on **granted** sources among: paper metadata/notes, Zotero annotations/notes, reading lists, vault notes, logbook, experiments, milestones.

#### Draft-only proposal tools (never silent write)

Examples: append paper note (append-only); create vault note or log entry; change paper metadata / reading lists / relations; import Zotero item; create milestone or experiment follow-ups.

Each action creates a **pending proposal**. User approves only on `/ai-review`. Browser-local typed executors perform normal app writes after approval; audit records outcome.

#### Hard exclusions

- No PDFs / attachments
- No **report** content
- No settings / credentials / API keys to MCP
- No autonomous deletes
- No silent autonomous writes
- Credentials stay server-key sealed; Zotero calls (when approved) go browser → Zotero, not through MCP plaintext

Plugin docs: `plugins/weaveforge-research/README.md`. Plan: `docs/internal/plans/completed/AI_MCP_PLAN.md`. Live contract: `docs/building/mcp.md` (some historical “E2EE” wording may lag the plaintext entity model — relay envelopes still use pairing-secret encryption).

Tables: `ai_proposals`, `ai_audit_records`, `ai_mcp_relay_requests`, MCP token storage.

---

### 6.17 Storage / blobs / PWA

**Buckets (private):** `paper-images`, `vault-assets`, `experiment-artifacts`.

**Registry:** `blob_objects` (+ sharing-aware access). APIs: `/api/blobs/{upload,content,remove,signed-urls}`.

**PWA:** Serwist service worker; installable; screen cache + revalidation. Android TWA optional.

**Planned:** R2/S3 and hot/cold tiering (`docs/storage/*`).

---

### 6.18 Auth / legal / export / startup

- Landing / auth gate; first-run org onboarding (create/join lab or standalone).
- Privacy disclaimer acceptance versioned in settings.
- Full user data ZIP export.

---

## 7. Background / sync behavior (no server cron workers)

| Job | Trigger | Behavior |
|-----|---------|----------|
| Citation alerts | App shell | Check ≤ once per paper per day |
| MCP browser relay | Live AI session | Poll claim → decrypt → execute → respond |
| Collab CRDT | Editor | Debounced persist |
| Zotero sync | Manual UI | Pull library + annotations; optional push |
| Log → GitLab | On log write if configured | Best-effort |
| Milestone → Mattermost | On milestone change | Best-effort |
| SW revalidation | Navigation | Cache hashed assets |

---

## 8. App routes (pages)

| Route | Feature |
|-------|---------|
| `/` | Landing / auth |
| `/dashboard` | Home cards |
| `/papers` | Library |
| `/graph` | Knowledge / citation graph |
| `/lists` | Reading lists |
| `/plan` | Milestones |
| `/log` | Logbook |
| `/report` | Report outline |
| `/report/overleaf` | Overleaf link + ZIP export |
| `/notes` / `/vault` | Vault |
| `/experiments`, `/experiments/[id]` | Experiments |
| `/git` | Git browser (if providers enabled) |
| `/shared` | Shared-with-me |
| `/supervision` | Supervisor view |
| `/org` | Lab / people |
| `/settings` | Settings |
| `/link?t=…` | External share redeem |
| `/ai-review` | Approve/reject AI proposals |
| `/recover`, `/reset-password` | Auth recovery |

---

## 9. Database tables (product-facing)

`papers`, `paper_relations`, `tags`, `paper_tags`, `reading_lists`, `reading_list_items`, `report_sections`, `log_entries`, `milestones`, `experiments`, `experiment_metrics`, `projects`, `project_integrations`, `project_zotero_collection`, `project_dashboard_layout`, `project_graph_settings`, `user_settings`, `profiles`, `organizations`, `org_memberships`, `org_invite_codes`, `shares`, `comments`, `library_pins`, `share_links`, `share_link_rate_limits`, `vault_pages`, `blob_objects`, `api_tokens`, `citation_alert_tracks`, `annotation_pins`, `paper_field_defs`, `paper_field_values`, `overleaf_connections`, `overleaf_linked_reports`, `ai_proposals`, `ai_audit_records`, `ai_mcp_relay_requests`, `crdt_updates`

---

## 10. What makes WeaveForge unusual vs typical note apps

1. **Reference manager + PKM + thesis outline + experiment tracker + lab org** in one schema.
2. **Python SDK** writes the same DB as the PWA (not a siloed wandb).
3. **Supervisor/lab hierarchy** with invite codes and tree-scoped read access.
4. **Share + pin** into recipient library + external share links.
5. **CRDT co-edit** on shared notes when granted.
6. **MCP research assistant** that is fail-closed, browser-paired, **proposal-only** (no silent agent writes; no in-app chat).
7. **Zotero ↔ notes ↔ report ↔ Overleaf** cite pipeline (`[[Title]]` → `\cite`).
8. **Citation alerts** into log + Mattermost; related-paper discovery with URL + citation counts.
9. **Notion-like custom fields + rollups** on papers + list extraction tables.
10. **Modular SOLID monolith** with env-swappable integrations and deploy-time feature stripping.
11. Honest privacy model: **RLS + at-rest**, not faux zero-knowledge.

---

## 11. Explicit non-goals (do not recommend these as core)

- Full in-app PDF annotator (Zotero owns PDFs/annotations).
- AI access to **report** content or credentials.
- In-app chat UI as the primary AI product.
- Silent autonomous agent writes / deletes.
- Becoming a general PKM marketplace (Obsidian plugin ecosystem).
- Infinite canvas as primary UX.
- Word / Google Docs Cite-While-You-Write add-in as the center of gravity (LaTeX/Overleaf path preferred).
- Reintroducing client-side E2EE as the default model.

---

## 12. Competitive context already internalized

Internal scan lives in `docs/internal/strategy/competitive-scan.md`. High-level takeaways already decided:

| Steal direction | Examples |
|-----------------|----------|
| Mid-layer reading → writing | Excerpt/annotation as first-class; pin to outline (Citavi-like); copy quote+cite |
| Layer before reading | Related papers, citation alerts, S2 graph (ResearchRabbit/Litmaps-class discovery, lighter) |
| Source-note discipline | Obsidian/ZotFlow-style templated paper notes (scaffold shipping) |
| Project binder feel | LiquidWorkspace-like cohesion across Papers/Notes/Report (jump-to, shared recents) |

**Skip:** infinite canvas primary UX; Theme Studio sprawl; NVivo-depth coding; Word-centric product.

Library knowledge loop (annotation cards, pins, custom fields, extraction table, relation/rollup, source-note layout) is largely **shipped** on the feature branch / backlog item; AI-assisted column fill still deferred.

---

## 13. Known gaps / deferred (honest)

Use these as improvement opportunities, not as shipped features:

- AI-assisted fill of extraction-table / custom field columns.
- Deeper Pandoc / CSL / multi-style cite for non-LaTeX exports.
- Stronger “open excerpt / jump to PDF locus” if a viewer ever exists (page already cached when Zotero provides it).
- Quotation types (direct / paraphrase / comment) as first-class.
- Citavi-style compile: section + queued excerpts → draft body.
- Overleaf Git bridge / import / MCP for Overleaf (local ZIP + linked read-only exist).
- Annotation provenance in an AI answer UI (no in-app answer UI yet).
- Hosted pricing, quotas, storage tiering (planned docs exist).
- Some README / product-brief lines still mention E2EE or vault “encryption” — **ignore those**; security model is RLS + at-rest.

### 13.1 Three candidates already on our table (evaluate, don't re-invent)

These came out of a prior research pass and survived internal review. We want them **stress-tested**, sized, and ranked against alternatives — not restated as discoveries.

**A. Typst/WASM as an additional authoring target (not a replacement).**
Client-side compile via `typst.ts`; `[[Exact Title]]` would map to a Typst citation the same way it maps to `\cite` today (§6.5). Overleaf/LaTeX remains the primary submission path — §11 stands. Open questions: quality and fidelity of Typst→LaTeX export for journals that mandate `.tex`; bibliography interop with our cite-key precedence chain (§6.5); bundle size of a WASM compiler in a PWA that must stay offline-capable (§6.17); whether split-pane live preview is worth it when the report module is AI-excluded (§6.8) and outline-shaped rather than document-shaped. Treat published compile-speed figures from Typst-adjacent vendors as `[vendor claim]` and seek independent benchmarks.

**B. Traceable-provenance rendering for AI output.**
Every AI-asserted claim renders a clickable locus that opens the exact source excerpt. Maps to the deferred "annotation provenance in an AI answer UI" gap. **Constraint the design must respect:** our AI surface is the proposal-review page `/ai-review` (§6.16), not a chat pane — §11 forbids in-app chat as the primary AI product. So the pattern must work for *reviewing a proposed write* ("here is the evidence behind this drafted note"), not for *reading a chat answer*. Compare how Elicit, Ponder, Scite, and Semantic Scholar surface claim-level provenance, then adapt to a review queue.

**C. Coordinate-level deep-link URI schema.**
A stable locus format (page + selection rectangle or text anchor) stored alongside Zotero annotations so a citation in a note or report section jumps to the exact locus. We already cache page numbers when Zotero provides them (§6.1). This must work **without** an in-app PDF viewer — §11 forbids building one; the link may hand off to Zotero, ZotMoov, or the OS viewer. Open questions: what a durable anchor looks like when the PDF is not ours to store, and whether text-anchor matching beats coordinates for resilience.

---

## 14. Research questions for Gemini Deep Research

Please produce a structured report that answers:

### A. Positioning

1. Against Obsidian+Zotero, Notion, Citavi, LiquidWorkspace, Zotero alone, and Overleaf alone: what is WeaveForge’s clearest differentiated value prop in one paragraph?
2. Which 3–5 competitor capabilities most threaten WeaveForge if ignored for 12 months?
3. Which WeaveForge capabilities are **under-marketed** relative to uniqueness (esp. SDK+thesis, lab tree, MCP proposal model, extraction table)?

### B. Literature → writing loop

4. Best UX patterns to turn Zotero annotations into durable knowledge objects without becoming a PDF app (Citavi / LiquidText / Obsidian ZotFlow / EndNote Cite-from-PDF).
5. How should custom fields + extraction tables evolve vs Notion databases / Airtable / RemNote?
6. Cite-while-writing: what should come after `[[Title]]` + Overleaf `\cite` (Pandoc, CSL, author-year palette, Better BibTeX workflows)?

### C. Discovery

7. Compare ResearchRabbit, Litmaps, Connected Papers, Elicit, S2: which discovery UX should WeaveForge copy next given we already have related papers (URL + citation count) and citation alerts?
8. How should alerts present “should I read this?” signals (citations, abstract, venue, open PDF link) without overwhelm?

### D. Notes / vault

9. Obsidian/Logseq parity checklist for WeaveForge vault: what is still worth shipping vs skip?
10. How to strengthen backlinks, daily notes, templates, and source-note templates without plugin marketplace complexity?

### E. Experiments & SDK

11. Compare wandb / MLflow / TensorBoard / Sacred: what thesis-specific experiment UX would make WeaveForge preferable for ML PhDs without competing on full MLOps?
12. Token UX, project scoping, and artifact/compare improvements that researchers actually need.

### F. Labs & supervision

13. Compare LabArchives, OSF, Notion team spaces, Slack: what should a **lightweight** academic lab model add next (without becoming LMS/HR)?
14. Privacy-preserving supervision patterns that beat screenshot culture.

### G. AI / MCP

15. Evaluate the browser-paired, proposal-only MCP design vs Cursor/Codex native tools, ChatGPT connectors, Notion AI, Elicit: strengths, risks, missing user-visible trust UX.
16. Which **safe** AI assists fit (field fill, related-work summaries, milestone suggestions) without violating report exclusion and non-autonomy?

### H. Prioritized roadmap

17. Produce a **90-day roadmap** (must / should / could) with effort vs impact, mapped to competitor “steal” lists.
18. Produce a **comparison matrix** (WeaveForge vs 8–10 tools) across: library, PDF/annotations, notes, cite, discovery, outline/writing, experiments, collab, AI, self-host, privacy model.
19. Call out any feature WeaveForge has that competitors lack and should be **productized/demoed** harder.

### I. The three standing candidates (§13.1)

20. **Typst.** Should WeaveForge add Typst/WASM as a second authoring target alongside the existing Overleaf ZIP path? Give the honest case against, sized: export fidelity to `.tex` for journals that mandate it, bibliography interop, PWA bundle cost, and whether an outline-shaped report module benefits from live preview at all. Independent benchmarks only.
21. **Provenance UI.** What is the best claim-level provenance pattern for a **proposal-review queue** (not a chat pane)? Compare Elicit, Ponder, Scite, Semantic Scholar, Consensus. Describe the `/ai-review` screen in words.
22. **Deep links.** What locus/anchor format is most durable for PDFs we do not store — page+rect, text-anchor/quote-selector, W3C Web Annotation selectors, or something else? Who has solved handoff to an external viewer well, and how do they degrade when the anchor no longer matches?

### J. Per-app teardown

23. Q1–Q22 slice the market by **dimension**. Now slice it by **app**. Produce a one-page teardown for each of these five, in this order:

    a. **Obsidian + Zotero** (with the Zotero Integration / ZotFlow / Dataview / PDF++ plugin stack as the realistic configuration a researcher actually runs)
    b. **Notion**
    c. **Citavi**
    d. **ResearchRabbit** (with Litmaps as a secondary reference point)
    e. **Weights & Biases**

    Each teardown uses this fixed structure:

    - **Who it is for and the job it wins** — 2–3 sentences, no marketing language.
    - **The actual end-to-end workflow** — walk a researcher from finding a paper to a cited sentence in a draft (or, for W&B, from a training run to a figure in a chapter). Name the friction points and the setup cost.
    - **Where it beats WeaveForge** — concrete, cite our §-number for the weaker capability.
    - **Where WeaveForge beats it** — concrete, cite our §-number.
    - **Steal / adapt / skip** — 2–4 specific mechanics, each tagged with the §6 subsection proving we lack it, and each checked against §11 non-goals.
    - **Switching cost and lock-in** — what a researcher would lose migrating to us, and what our importers (§6.9 vault ZIP import, §6.1 Zotero sync) already cover.
    - **Threat horizon** — is this app moving toward our position, and how fast? Evidence from changelogs or roadmaps, not speculation.

    Do not repeat the comparison matrix in prose. This section is about *workflow mechanics*, not feature checkmarks.

### Output format request

Produce **all** of the following. A missing section is a failed deliverable.

1. **Self-check block** (the checklist under "How to use this brief").
2. **Executive summary** (≤1 page).
3. **Comparison matrix** — WeaveForge vs ≥8 named tools across: library · PDF/annotations · notes · cite · discovery · outline/writing · experiments · collab · AI · self-host · privacy model. One table.
4. **Numbered answers Q1–Q23.** Every number present; unanswerable ones marked `UNANSWERED — reason`.
5. **Five per-app teardowns** (Q23), one page each, in the fixed structure given.
6. **Steal / adapt / skip lists** with rationale, each item tagged with the §6 subsection proving it is not already shipped. Consolidate the per-teardown steal lists here — do not leave them scattered.
7. **Prioritized roadmap** — P0/P1/P2, effort (S/M/L) × impact (low/med/high), mapped to the steal list.
8. **Concrete UX sketches in words** (no code) for the top 3 P0 items.
9. **Risks and anti-patterns.**
10. **Optional:** one "Challenges to stated non-goals" box, ≤200 words, evidence-backed.
11. **Source list** with honest access dates; vendor pages labelled `[vendor claim]`.

---

## 15. Key internal docs (for humans; optional for the model)

| Doc | Contents |
|-----|----------|
| `README.md` | Pitch, quick start (verify against this brief if conflict) |
| `docs/building/design.md` | Architecture / SOLID |
| `docs/SECURITY.md` | RLS + at-rest model |
| `docs/using/integrations.md` | Provider ports |
| `docs/building/mcp.md` | Live MCP contract |
| `docs/internal/plans/README.md` | Plan index (current / working / future / completed) |
| `docs/internal/plans/completed/AI_MCP_PLAN.md` | Full AI design |
| `docs/using/citations-and-overleaf.md` | Cite / pin / export UX |
| `docs/internal/strategy/competitive-scan.md` | Prior competitive notes |
| `docs/internal/future-work/BACKLOG.md` | Shipped vs deferred |
| `docs/internal/plans/completed/library-knowledge-loop-plan.md` | Fields / annotations track |
| `python/README.md` | SDK |
| `plugins/weaveforge-research/README.md` | Codex plugin setup |
| `docs/internal/plans/completed/hosting-and-cost-plan.md` | Hosted pricing thinking |
| `docs/internal/plans/completed/modular-deployment-plan.md` | Feature stripping |

---

## 16. One-page cheat sheet (pasteable)

**WeaveForge** = thesis OS: Papers (+ Zotero + S2 related/alerts + custom fields + annotation pins) · Graph · Nested reading lists + extraction table · Vault notes (wikilinks, equations, import, co-edit) · Plan milestones · Logbook · Report outline → Overleaf ZIP `\cite` · Experiments web UI + **Python SDK tokens** · Dashboard · Labs (invite codes, supervision tree) · Share/comment/pin/share-links · **Opt-in MCP** (browser relay, proposal review at `/ai-review`, no report/PDF/creds, no in-app chat) · Privacy = **RLS + encryption at rest** (not E2EE) · Self-host AGPL-3.0-only throughout.

**Ask Deep Research to:** compare to note/reference/discovery/MLOps/lab tools; recommend the next mid-layer (reading→writing) and pre-reading (discovery) improvements; respect non-goals; return a 90-day prioritized roadmap and comparison matrix.

**Not us:** investment/financial thesis trackers · Cloudflare Workers or edge SQLite · autonomous cron-writing AI agents. See §0.

---

## 17. Deep Research prompt (paste this alongside the brief)

> You are producing a competitive strategy report for **WeaveForge**, a research workspace for Master's/PhD researchers. The attached document `DEEP_RESEARCH_PRODUCT_BRIEF.md` is the complete and only authoritative description of the product.
>
> **Before anything else, read §0 of the brief.** It lists products that share our internal code name but are unrelated to us. A previous run of this task failed by retrieving an investment-thesis tracking product and a Cloudflare-Workers architecture and presenting them as WeaveForge. If a source describes financial theses, market-close jobs, price targets, edge SQLite, or autonomous cron-writing AI agents, it is not about us — discard it and do not cite it for any claim about WeaveForge.
>
> **Hard rules:**
> 1. Every statement about what WeaveForge is or does must trace to a §-number in the brief. External sources are for competitor and market claims only.
> 2. Do not attempt to access any live deployment. There is no staging URL or test account. Evaluate the *specified* UX from §6 and say that is what you are doing.
> 3. Before recommending a feature, cite the §6 subsection showing we lack it. If §6 already covers it, say "already shipped — the remaining gap is X" instead of recommending it.
> 4. §11 lists explicit non-goals. Any recommendation matching one is auto-rejected. You may push back once, in a single labelled box of ≤200 words with evidence, but do not build roadmap items on a non-goal.
> 5. §13.1 lists three candidates we already have on the table (Typst as a second authoring target, claim-level provenance UI for a proposal-review queue, durable deep-link anchors for PDFs we do not store). Stress-test, size, and rank these — do not restate them as new discoveries.
> 6. Prefer primary sources: official docs, changelogs, published benchmarks, first-party engineering writeups. Vendor marketing and SEO listicles may be cited at most once each and must be labelled `[vendor claim]`. Do not base the comparison matrix on a single blog post. Report access dates honestly; omit failed retrievals rather than citing them.
> 7. Answer **all** of Q1–Q23 in §14, by number. Mark any you cannot answer as `UNANSWERED — reason`. Silently skipping questions is a failed deliverable.
> 8. **Q23 is not optional and not a summary.** It asks for five per-app teardowns (Obsidian+Zotero, Notion, Citavi, ResearchRabbit, Weights & Biases), one page each, in the fixed structure given. Describe how a researcher actually moves through each tool end to end — finding a paper through to a cited sentence in a draft — including setup cost and friction. Do not restate the comparison matrix in prose.
>
> Deliver exactly the eleven sections listed under "Output format request" in §14, starting with the self-check block.

---
