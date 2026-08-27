# Live vault folder

**Status:** proposed
**Branch:** `feat/obsidian-vault-interop`

## The gap

`packages/core/src/workspace/` is 1,396 lines and almost none of it runs. A
grep for consumers outside the directory finds exactly one: the ZIP export in
`apps/web/src/features/export/application/export-user-data.ts`, which calls
`serializeWorkspace` and `workspaceSnapshotCounts`. Everything else —
`deserializeWorkspace` (172 lines), `snapshotDelta` (122), `FsPort` (73),
`GitPort` (87), `folderMirror` (94) — has no caller at all.

So the workspace folder is a download. You can export it, edit it anywhere,
and then have nowhere to put it back. The half of the design that made the
folder *the* representation was built and never wired.

This plan wires it: a real folder on disk that the desktop app keeps in step
with the database, editable from outside while the app is running.

## Why it is worth doing

It is the whole Obsidian interop story without an Obsidian API. Plugins for
Obsidian compile against `obsidian.d.ts` and run inside Obsidian's own
renderer against its `App`/`Vault`/`MetadataCache` singletons; hosting them
means reimplementing that surface and then chasing every plugin that reaches
past it into private internals. Making our folder a vault that Obsidian can
open costs a fraction of that and delivers the same thing to the user: their
tools, on our data.

It also reduces code rather than adding it. The new surface is a watcher, an
IPC channel and a reconciler; what it activates is five modules that already
exist, are already tested, and currently justify none of their weight.

## Phases

### Phase 1 — Filesystem IPC ✅
- [x] A folder picker behind `vaultChoose`. The renderer never names a path:
      it asks for a dialog, and the chosen root stays in the main process, so
      every later read and write is relative to something a person selected
- [x] `NodeWorkspaceFs` implements `IWorkspaceFs` against that root. Every
      path goes through `safeWorkspacePath` and then through a `realpath`
      containment check, so a symlink planted inside the folder cannot lead
      out of it either
- [x] `verifyRoot` refuses a folder that is neither empty nor already ours —
      `.weaveforge/` is the mark. Pointing this at `Documents/` would bury a
      person's files among a thousand of ours with no way to tell them apart
- [x] 18 tests in `apps/desktop/test/vault-folder.test.ts`

Not yet done in this phase: persisting the chosen root across restarts. The
`preference-store` allow list would need a `vault-root` name, and the question
of whether a remembered path is re-verified on launch (it should be) belongs
with Phase 2, where something actually writes.

### Phase 2 — Write-out ✅
`syncToFolder` in `apps/web/src/features/workspace/application/workspace-folder.ts`
already drove `mirrorWorkspace` against a browser-picked folder. This phase
gave it a third backing and the two things it was missing.

- [x] `DesktopWorkspaceFs` puts the desktop bridge behind `IWorkspaceFs`, beside
      the existing `BrowserWorkspaceFs`. Everything above the port — mirror,
      importer, git adapter — works against it unchanged
- [x] `previousPaths` — the list that tells the mirror which files have
      departed — was in-memory and died with the tab. It now persists in
      `.weaveforge/mirror.json` inside the folder, so it travels with the files
      it describes rather than with the browser that wrote them
- [x] `requestSync` debounces and coalesces, with `suspendSync` for Phase 3 to
      raise while a read-back is being applied, so the two directions cannot
      chase each other. A request landing mid-run is re-run afterwards rather
      than folded into a snapshot taken before the save happened
- [x] 25 tests in `apps/web/src/features/workspace/test/`

- [x] Settings -> Folder offers the shell's own dialog when there is a shell,
      and takes up the remembered root on mount so a folder survives a restart
      without a dialog nobody asked for

### Phase 2b — A change notification worth hanging things off ✅
- [x] `notifyWorkspaceChange` / `onWorkspaceChange` in `lib/workspace-changes.ts`
      is the one place that says the workspace changed. It carries a table name
      and nothing else: every listener re-reads what it needs anyway, and a
      richer event would be a second description of the data to keep true
- [x] Raised by `watchWrites`, which wraps the Supabase client once at its
      single creation site in `wire-supabase-backend.ts`. Roughly forty
      repositories reach for `db.from(table)` and none reach past it, so this
      covers all of them and edits none of them. The alternative -- a
      `notifyChanged()` per write -- is forty edits that every future repository
      must repeat, where forgetting one leaves the folder silently stale for
      exactly one kind of edit
- [x] Only successful writes report. PostgREST answers errors in the payload
      rather than by rejecting, so the check is on `error`; a failed write that
      reported would have the mirror re-read the whole workspace to discover
      nothing had happened. Reads are untouched
- [x] A listener that throws cannot fail the write that triggered it, and
      cannot stop the other listeners hearing about it
- [x] `requestSync` subscribes when a folder is opened, not when the module
      loads: a listener running with no folder would debounce, wake, find
      nothing, and sleep again on every edit for the rest of the session
- [x] Chosen over polling because the mirror's cost is the snapshot, not the
      write, and a poll pays that cost on every tick to usually find nothing
- [x] 9 tests in `apps/web/src/backend/test/watch-writes.test.ts`

Phase 2 is now complete: a desktop user picks a folder in Settings -> Folder,
and it keeps itself up to date from then on.

### Phase 3 — Read-back
- [ ] Watch the root; on an external change, `parseWorkspaceFolder` the
      affected file and apply it through the same use cases the UI calls
- [ ] Identity comes from `weaveforge-id`, so a file renamed in Finder renames
      the entity instead of forking it — this already works and is tested
- [ ] A file with no `weaveforge-id` is an import: create the entity, then
      write the id back into the file

### Phase 4 — Conflicts
- [ ] A body edited on disk while the in-app editor holds a Yjs document is
      the same conflict `offline-first-sync.md` already settled for the
      database. Reuse its three-way merge per field rather than inventing a
      second policy
- [ ] Anything that does not merge lands as a conflict record the user
      resolves, never a silent overwrite

### Phase 5 — Git (optional, gated)
- [ ] `GitPort` already exists. Commit the folder after each settled write, so
      the vault has file-level history without the app owning a history model
- [ ] Off by default; a folder inside someone else's repository must not start
      committing on its own

## Interop details already settled

- `aliases: [<title>]` in frontmatter, so `[[Title]]` resolves outside the app
  despite the `.note.md` kind suffix (shipped on this branch)
- Tags hyphenated in the mirror, because a space ends a tag in Obsidian's
  grammar (shipped on this branch)
- Folder-note convention for nested entities — a node with children is a
  directory holding a same-named file — which is what Obsidian does and what
  `treePaths` already emits

## Known risk

The frontmatter parser is deliberately narrow: scalars and flow lists, no YAML
library, no deserialization surface. That is right for a format we emit and
wrong for one an outside editor writes back. Phase 3 needs a reader that
tolerates nested maps and block lists without widening what we *write*, and
without acquiring a YAML dependency that can be talked into constructing
objects.
