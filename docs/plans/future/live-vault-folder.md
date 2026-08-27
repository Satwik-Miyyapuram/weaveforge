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
- [x] `createMirrorRunner` collects a snapshot and hands it to
      `mirrorWorkspace`, which content-compares before every write, so an
      unchanged workspace produces no filesystem churn
- [x] Debounced and coalesced, with a `suspended` flag Phase 3 raises while a
      read-back is being applied, so the two directions cannot chase each
      other. A request landing mid-run is re-run afterwards rather than folded
      into a snapshot taken before the save happened
- [x] `previousPaths` — the list that tells the mirror which files have
      departed — persists in `.weaveforge/mirror.json` inside the folder, so
      it travels with the files it describes
- [x] `DesktopVaultFs` puts the desktop bridge behind `IWorkspaceFs`; 12 tests
      in `apps/web/src/features/vault-mirror/test/`

Not yet wired into the save path: choosing a folder still needs a UI
affordance, which is where this picks up next.

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
