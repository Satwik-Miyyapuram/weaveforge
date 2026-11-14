# Documentation

Four folders, and which one a page belongs in is a question about who reads it.

## [Using WeaveForge](using/)

For somebody using the app.

- [Your account](using/account.md) — signing in, local mode, the privacy notice, password reset and invite links
- [Getting started](using/getting-started.md) — your first project, paper and note, in 10 minutes
- [The desktop and mobile apps](using/desktop.md) — installing on Windows, Mac, and Android, what an installed window can do, and working without an account
- [Projects and workspaces](using/workspaces.md) — project boundaries, switching, multi-pane editor, and organisation modes
- [The workspace folder](using/workspace-folder.md) — your notes as files on your own disk
- [Storage and sync](using/sync.md) — where your work lives, and what syncs when
- [Release notices](using/release-notices.md) — the what's-new banner after an update
- [Collaborative editing](using/collaborative-editing.md) — two people in one document
- [Organisations](using/organisations.md) — labs: create or join with an invite code, roles, who sees whom
- [Paste](using/paste.md) — what happens to what you paste in
- [The AI assistant](using/ai-assistant.md) — what it may read, what it may suggest, and how grants expire
- [Sharing](using/sharing.md) — share with one member, pick view, comment or edit, and how blanket shares work
- [The dashboard](using/dashboard.md) — the eleven cards, how the layout is saved, and what happens to an unknown card
- [Settings](using/settings.md) — appearance, your theme file, integration keys, and the disclaimer
- [The wiki](using/wiki.md) — the generated index, merging two pages, and what a merge keeps
- [Search](using/search.md) — one box over the workspace, typo recovery, acronyms, query filters, and how results are ranked
- [Papers](using/papers.md) — pasting a DOI, arXiv id or page, duplicate matching, and what the import refuses
- [Reader](using/reader.md) — opening a paper's PDF, annotating it, and following its citations
- [Notes](using/notes.md) — creating, importing, renaming and tagging notes, and deleting with Undo
- [Tags](using/tags.md) — adding tags to notes and papers, finding everything with one tag, and removing one
- [Handwriting](using/ink.md) — writing and drawing on a page, figures, recognition, printing and shortcuts
- [Reading lists](using/reading-lists.md) — grouping papers by theme, sublists, screening and comparison tables
- [Graph](using/graph.md) — relations between papers, finding citations, filters and export
- [Experiments](using/experiments.md) — creating one by hand, logging runs from Python, and comparing runs
- [Logbook](using/logbook.md) — daily entries, drafting one from your reading, and supervisor check-ins
- [Plan](using/plan.md) — milestones, target dates, dependencies and compute needs
- [Supervision](using/supervision.md) — students, check-ins, and what a supervisor sees
- [Review queue](using/review-queue.md) — approving, editing or rejecting what the assistant suggests
- [Git](using/git.md) — reading a connected repository's commits and tracking them as experiments
- [Citations, excerpts and Overleaf](using/citations-and-overleaf.md)
- [Reports](using/reports.md) — draft thesis sections, check the bibliography, convert Markdown to LaTeX
- [Integrations](using/integrations.md) — Zotero, git, MCP, the browser extension
- [Extending WeaveForge](using/extensions.md)

## [How it is built](building/)

For somebody changing the code.

- [How WeaveForge is put together](building/architecture-map.md) — where code lives and what runs offline
- [Core modules](building/core/README.md) — one page per Rust core module: what is in Rust, how the app calls it, what stays in TypeScript
- [The atlas](atlas.html) — the same map as one drawn page, every figure read off this commit
- [Developer guide](building/dev.md) — running it, the checks, the hygiene rules
- [Design principles](building/design.md)
- [Theming](building/themes.md)
- [MCP implementation](building/mcp.md)
- [Releasing](building/release.md)
- [How we write the docs](building/docs-style.md) — page outline, sentence rules, Rust as the source
- [Contributing](../CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md)

## [Running it yourself](running/)

For somebody hosting it.

- [Backend and hosting](running/backend.md) — which backend, and what each one costs
- [Postgres provider](running/postgres-provider.md)
- [The Oracle shift](running/oracle-shift.md)
- [Storage](running/storage/) — tiering, growth, and the R2 setup

## [internal/](internal/)

Working notes: plans, strategy, research, one-off engineering reports. Not
published on the site, not secret either — it is a public repository. It is
simply not documentation, and a reader looking for the manual should not have
to walk past a backlog to find it.

## Why the split

`CODE_OF_CONDUCT.md` and `SECURITY.md` stay at the top of
this folder rather than under `building/`: GitHub looks for them in the
repository root, `.github/`, or `docs/`, and nowhere else. Everything else is
sorted by its reader, which is also what decides whether it is published — the
site publishes these three folders and hides `internal/`, so a new document is
public or not by where it is saved, not by a list somebody has to remember to
edit.
