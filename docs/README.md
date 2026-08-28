# Documentation

Four folders, and which one a page belongs in is a question about who reads it.

## [Using WeaveForge](using/)

For somebody using the app.

- [The desktop app](using/desktop.md) — what an installed window can do, and working without an account
- [The workspace folder](using/workspace-folder.md) — your notes as files on your own disk
- [Collaborative editing](using/collaborative-editing.md) — two people in one document
- [Paste](using/paste.md) — what happens to what you paste in
- [Search](using/search.md)
- [Citations, excerpts and Overleaf](using/citations-and-overleaf.md)
- [Integrations](using/integrations.md) — Zotero, git, MCP, the browser extension
- [Extending WeaveForge](using/extensions.md)

## [How it is built](building/)

For somebody changing the code.

- [How WeaveForge is put together](building/architecture-map.md) — where code lives and what runs offline
- [The atlas](atlas.html) — the same map as one drawn page, every figure read off this commit
- [Developer guide](building/dev.md) — running it, the checks, the hygiene rules
- [Design principles](building/design.md)
- [Theming](building/themes.md)
- [MCP implementation](building/mcp.md)
- [Releasing](building/release.md)
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
