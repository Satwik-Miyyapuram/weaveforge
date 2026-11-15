# The interop surface

Research round, 2026-08-27. The question was whether WeaveForge should aim for
backward compatibility with Obsidian plugins, and what else in that direction
would make the product meaningfully better.

## The short answer on Obsidian plugins

Hosting them is not achievable, and not for want of effort. There is no
compatibility layer, and the ecosystem has not produced one, because an Obsidian
plugin is not a document-processing function: it is handed the live `App`
object and reaches into the workspace, the editor, the settings registry, and
in many cases Obsidian's bundled Electron internals. Reimplementing enough of
that to run arbitrary plugins means reimplementing Obsidian, and doing it
closely enough that plugin authors' assumptions hold — a moving target owned by
someone else, with no version contract offered to us.

What the ecosystem actually converged on instead is a *local HTTP surface*. The
Local REST API community plugin is how browser extensions, scripts, AI clients,
and MCP servers reach a vault today, and it is the thing those tools are written
against. That is the compatibility worth having, and it is compatibility we can
provide directly rather than by emulation.

So the goal restates cleanly: **not to run Obsidian's plugins, but to be
addressable by the tools those plugins made popular.**

## Three tiers, cheapest first

### Tier 1 — The folder. Done.

Already shipped on this branch. A WeaveForge folder resolves as a vault
elsewhere: `weaveforge-id` frontmatter, Obsidian-shaped aliases and tags,
wikilinks, and a layout another editor can open without being told anything.

This alone buys more plugin compatibility than any emulation would: every
Obsidian plugin that works by reading and writing vault files — which is most of
the useful ones — already works, because the user runs it inside Obsidian,
against our folder. We do not host the plugin. We host the data it expects.

### Tier 2 — The local HTTP surface (shipped)

Serve the same routes `obsidian-local-rest-api` serves, from the desktop shell,
on loopback with a token. File CRUD, the active note, tag queries, command
listing and execution, text search.

Why this and not an API of our own design: an API of our own design has no
clients. This one has clients already written, and the cost of matching an
existing route shape is close to the cost of inventing one.

Constraints this must ship with, not after:
- Loopback only, never `0.0.0.0`. A note-taking app that binds a writable file
  API to every interface on a café network is a different kind of product.
- A token generated per install, shown once in settings, revocable there.
- Off by default. The feature is a door; the user opens it.
- The same `safeWorkspacePath` guard the workspace port already uses. The
  network surface must not be the one path into the folder that skips it.

### Tier 3 — MCP (shipped, locally)

Expose the workspace as an MCP server. "Knowledge & Memory" is the largest
category in the MCP ecosystem and reportedly its largest unmet demand, and the
Obsidian MCP servers that exist are wrappers over the Tier 2 surface — which
means Tier 2 makes Tier 3 small, and doing them in the other order does not.

This is also the tier where WeaveForge has something Obsidian does not: the
workspace is not only notes. Papers, annotations, reading lists, and the
citation graph are all first-class here, so an agent addressing this server can
ask questions no vault-backed server can answer.

## The differentiator: Zotero annotations

This is the finding worth acting on beyond interop housekeeping.

Zotero keeps PDF annotations in its own database rather than in the PDF, which
is why they sync cleanly and why they are invisible to every other reader. The
consequence is a real, current gap: as of 2026 there is no working way to create
PDF annotations programmatically such that they appear in Zotero's reader. It is
an open request, not a shipped feature, and it blocks exactly the workflows
people now want — AI-assisted reading, and sync with other readers.

WeaveForge already stores annotation anchors in Zotero's position shape
(`zoteroPosition`, with `pageIndex`, rects, and ink paths). The work to become
the tool that reads and writes a Zotero library's annotations faithfully is
therefore much smaller for us than for a reader starting cold, and the resulting
claim is concrete and checkable: *annotate here, open Zotero, your highlights
are there.* Nothing else currently offers that.

Order of work, if taken up:
1. Read-only import from a local Zotero SQLite library. Lowest risk, immediately
   useful, and it validates that our anchors really do round-trip.
2. Write-back behind an explicit action with a diff, matching how folder import
   already behaves. Zotero's database is someone else's source of truth and must
   be treated as one.

## What was deliberately not proposed

- **Running Obsidian plugins.** Covered above.
- **A sync protocol of our own.** Supabase plus the offline outbox already
  covers this, and the folder covers portability. A third mechanism would be a
  third thing to keep correct.
- **Editing PDFs in place to carry annotations.** It is the interoperable-
  looking option and the wrong one: it rewrites the user's source file on every
  highlight, and Zotero's reasoning for avoiding it applies to us unchanged.

## Prerequisite shared with the folder work

Tier 2 and Tier 3 both need to know when the workspace changed, and so does
`requestSync` — see Phase 2b in `live-vault-folder.md`. Three consumers for one
missing seam is the argument for building it properly rather than per-caller.

## Build order, status and constraints

Order follows what each step depends on, not the order they were listed in:
frontmatter reader, gated git, Tier 2, Tier 3, Zotero annotations, then
`experiment_metrics` storage. Tier 3 comes after Tier 2 because the reverse
makes the MCP server carry its own file access, leaving Tier 2 as a second copy.

- **Frontmatter reader (Tier 1): done.** Commit `ae70b92` reads block lists and
  skips nested maps; `unquote` handles single-quoted YAML. No YAML dependency.
  The Known risk section of `live-vault-folder.md` still calls it outstanding.
- **Gated git (Phase 5): off by default.** A `vault-git` preference in the same
  store as `vault-root`. The app commits the folder after a settled write (the
  mirror run, not each file). The gate is checked at commit time, not only when
  the setting is shown, because a mirror folder inside someone else's repository
  must never commit there. No history model: `GitPort` commits and nothing reads
  the log back.
- **Tier 2 constraints:** loopback only (`127.0.0.1`); a token generated per
  install, shown once in settings, revocable there, required on every route;
  off by default; the same `safeWorkspacePath` guard as the folder writer, so a
  path that resolves outside the vault is refused before any I/O.
- **Tier 3:** built on the Tier 2 handlers. Results go through `mcpReadResult`,
  because the tool manifest declares `resultsAreUntrusted`, and a result that
  skips the wrapper would make that declaration false.
- **Zotero: read path shipped, write-back not.** Not SQLite: a SQLite
  dependency is a compiled module in the installer (Electron 33 runs Node 20.18,
  which has no `node:sqlite`), and Zotero locks the file while open. Zotero 7
  serves a read-only Web API at `http://127.0.0.1:23119/api` with no key, so the
  pager, annotation parser and attachment join work unchanged. A plain-HTTP
  loopback request from an `app://` document is blocked as mixed content, so
  the shell has one guarded proxy (`apps/desktop/src/zotero-local.ts`). It
  accepts only Zotero's own local API URLs; a general fetch channel would forward
  requests for anything on the machine. Papers match on their existing
  `zoteroKey`, so the import adds annotations and never creates papers. Write-back
  needs the cloud path (`ZoteroApiAnnotationWriteBack`, via `api.zotero.org`)
  and an API key, because the local API is read-only.
- **`experiment_metrics` storage: gated on the OCI cutover.** `BACKLOG.md` §2
  item 0 defers it, because a schema change breaks the migration's byte-identical
  verify. Check the cutover before touching a migration; if it has not happened,
  leave it on the backlog and record the check. Measured cost is 439 B/row.
  Options: A, a composite primary key plus a `metric_id` lookup (~110 B);
  C, downsample on write at the ingest route (bounds growth); B, chunked
  `float8[]` (~10-15 B/point). A comes before B, since B reuses A's `metric_id`
  and supersedes its row layout.
