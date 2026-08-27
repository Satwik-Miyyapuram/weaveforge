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
- [x] `createVaultWatch` in `apps/desktop/src/vault-watch.ts` collects
      filesystem events and reports them as one batch after things go quiet: a
      single save in Obsidian or VS Code arrives as a write, a rename, and a
      second write, and reporting each would be three reviews for one edit
- [x] Writes this process makes are noted before they happen, so the mirror's
      own output is not reported back as somebody else's change. An echo is
      forgiven once, not forever -- an editor saving over a file the mirror has
      just written is real news the second time
- [x] `fs.watch(root, { recursive: true })` in the main process, reaching the
      renderer on the `vaultChanged` channel via the same main -> renderer event
      pattern as `signIn`. Recursive watching works on Windows and macOS but not
      Linux; a native watcher would be a compiled dependency in an installer for
      a convenience, so Linux simply gets no notification
- [x] The renderer *reports*, and does not apply: `externalChanges()` and
      `onExternalChange` in `workspace-folder.ts`, surfaced by Settings ->
      Folder as a line above the actions. Applying blind would overwrite the
      workspace's copy with no way back, and the merge that would make it safe
      is Phase 4. The panel's contract already says pulling changes back is an
      explicit action with a diff shown first
- [x] 14 tests (9 desktop, 5 web)
- [x] Apply the affected file through the same use cases the UI calls, once
      Phase 4 exists to settle what happens when both sides changed:
      `applyFolderImport` goes through `manageVaultPage`, never the store
- [x] Identity comes from `weaveforge-id`, so a file renamed in Finder renames
      the entity instead of forking it — this already works and is tested
- [x] A file with no `weaveforge-id` is an import: create the entity, then
      write the id back into the file. `claimImportedFile` stamps the id and
      adds the path to the manifest, so the next mirror removes the hand-made
      copy once the entity is written out under its own name. Without both
      halves the same file imports again on every pass, and one note becomes
      two, then four

### Phase 4 — Conflicts
- [x] The mirror manifest is version 2 and records a digest of every file it
      left in the folder. That is the third side of the merge: without it an
      import can only see that two copies differ, and cannot tell an edit made
      out there from one made in here. Version 1 manifests still read, and yield
      no base, so those folders behave exactly as they did before
- [x] `changedSide` in `packages/core/src/workspace/change-origin.ts` reads the
      three digests and answers `folder`, `workspace`, `both`, `neither`, or
      `unknown`. `diffWorkspace` takes it as an optional `origin` and uses it:
      a folder edit is an update, a workspace edit is *not* something to import
      back, and both moving is a conflict named after the file
- [x] This closes a real hole. Before it, importing a folder whose note had
      been edited in the app since the last mirror carried the older copy over
      the newer one with nothing shown and no way back
- [x] Both sides arriving at the same text counts as agreement, not a conflict
- [x] 11 tests (8 core, 3 web)
- [x] A body edited on disk while the in-app editor holds a Yjs document is
      the same conflict `offline-first-sync.md` already settled for the
      database. Reuse its three-way merge per field rather than inventing a
      second policy. Done: `mergeRows` moved to `packages/core/src/shared/`,
      `merge-vault-page.ts` applies it to frontmatter, the manifest is version 3
      and carries a body digest per note, and `mergeBothChanged` turns a
      non-colliding pair of edits into an update instead of a prompt
- [x] Anything that does not merge lands as a conflict the user resolves, never
      a silent overwrite. Three ways out, per file: keep this app's copy (the
      default, and what an unsettled conflict does), take the folder's copy, or
      keep both -- which imports the folder's copy as a new note and leaves the
      workspace's alone. Keeping both is the only one that discards nothing, and
      is the fallback `offline-first-sync.md` already settled on
- [x] "Take the folder's copy" is not offered for a type mismatch, and is
      refused in the application layer as well as hidden in the UI: the id in
      the file names a paper or an experiment, so there is no note to write over
- [x] `settleConflict` holds the whole policy and does no I/O, so it is tested
      without an app container -- 6 tests

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
