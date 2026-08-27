# Interop tiers, gated git, and metrics storage

Six items were left after the vault-folder branch merged. This is the plan for
all six, in the order dependency actually forces rather than the order they were
listed in.

## Order, and why

1. **Frontmatter reader** (`live-vault-folder.md`, Known risk) — underpins every
   read-back path, so it has to be settled before anything else reads the folder.
2. **Phase 5, gated git** — smallest, entirely local, and gives every later tier
   a way back from a bad write.
3. **Tier 2, local HTTP** — the routes `obsidian-local-rest-api` serves.
4. **Tier 3, MCP over the workspace** — Tier 2 makes Tier 3 small. The reverse
   order does not: an MCP server written first ends up carrying its own file
   access, and then Tier 2 is a second copy of it.
5. **Zotero annotations** — desktop-only, needs a SQLite dependency, and is the
   only item that touches somebody else's database.
6. **`experiment_metrics` storage** — gated on the OCI cutover, so it is checked
   before it is started and skipped if the cutover has not happened.

## 1. Frontmatter reader — done, doc stale

Commit `ae70b92` already made `readFrontmatter` read block lists (which is what
every outside editor writes) and skip nested maps rather than half-reading them,
and `unquote` already tolerates single-quoted YAML. No YAML dependency was
added, and `writeFrontmatter` still emits exactly what it emitted before.

Remaining work is the Known risk section, which still describes this as
outstanding.

## 2. Phase 5 — git, off by default

- A `vault-git` preference, default off, in the same store as `vault-root`.
- After a settled write (the mirror run, not each file), commit the folder.
- Off by default is not a nicety: a mirror folder placed inside somebody else's
  repository must never start making commits in it. The gate is checked at the
  point of commit, not only at the point the setting is rendered.
- No history model in the app. `GitPort` commits; nothing reads the log back.

## 3. Tier 2 — local HTTP

Routes, matching what `obsidian-local-rest-api` exposes so existing clients work:
file read/write/delete, the active note, tag queries, listing and running
commands, and text search.

The constraints ship with it, in the same commit, not after:

- Loopback only. `127.0.0.1`, never `0.0.0.0`.
- A token generated per install, shown once in settings, revocable there.
  Every route requires it; no route is exempt.
- Off by default.
- The same `safeWorkspacePath` guard the folder writer uses. A path that folds
  outside the vault is refused before any I/O.

## 4. Tier 3 — MCP over the workspace

Built on Tier 2's handlers, not beside them. Results go through `mcpReadResult`,
because the tool manifest already declares `resultsAreUntrusted` and a result
that skips the wrapper silently makes that declaration false.

What makes it worth having over a generic vault MCP: papers, annotations,
reading lists and the citation graph are first-class, not markdown files that
happen to be about papers.

## 5. Zotero annotations

Two halves, in order:

- Read-only import from a local Zotero SQLite library. Lowest risk, and it
  proves our anchors round-trip — we already store them in Zotero's
  `zoteroPosition` shape (`pageIndex`, rects, ink paths).
- Write-back behind an explicit action with a diff, exactly as folder import
  behaves. Zotero's database is not ours to write to without being asked.

Desktop only: it needs a native or wasm SQLite, and the browser has no library
to read.

## 6. `experiment_metrics` storage

`BACKLOG.md` §2 item 0 marks this "after the OCI cutover", because changing the
schema first breaks the migration's byte-identical verify. Check that before
touching a migration; if the cutover has not happened, this stays on the backlog
and the check is recorded rather than worked around.

Measured 439 B/row. A: composite PK plus a `metric_id` lookup, ~110 B. C:
downsample on write at the ingest route, which bounds growth. B: chunked
`float8[]`, ~10–15 B/point. Order matters — B reuses A's `metric_id` and
supersedes its row layout.
