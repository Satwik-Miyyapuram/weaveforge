# Sync core module

The `sync` module holds the rules that keep a workspace consistent across
devices and folders: which side wins a conflict, what changed since the last
agreed state, how a remote snapshot becomes a delta, which git push result to
report, and how ink and folder files are split and named. The rules are pure.
The app does the reads, writes, network calls and git commands, and passes the
results in.

## What lives in Rust

- `conflict_route.rs`: picks the route for an outbox operation that the server
  refused as stale, from the server's answer.
- `conflict_settle.rs`: decides how an open conflict settles when the server's
  row arrives.
- `conflict_resolve.rs`: the row or action that a reader's choice produces.
- `folder_merge.rs`: settles a file that both sides changed, and counts the
  import preview.
- `folder_mirror.rs`: the mirror manifest. `jsonEditSince` tells whether a JSON
  file was edited since the manifest recorded it.
- `folder_layout.rs`: folder names and paths. `folderTitleFromPath` gives a note
  title from a file path, and `pickProjectFolder` chooses a project folder. The
  TypeScript folder names in `packages/core/src/workspace/folder-layout.ts` stay
  in `packages/core`: that package has no wasm dependency, and the names are read
  when the workspace is loaded.
- `snapshot_delta.rs`: `planDelta` compares a remote snapshot with the held
  state, and `applyDelta` applies the plan.
- `change_origin.rs`: `digestText`, the hash used to detect changes.
- `git_gate.rs`: `decideVaultCommit` decides whether a vault commit should run.
- `git_remote.rs`: checks a remote URL, redacts secrets from messages, and
  describes a push result (`describePush`).
- `ink_note.rs`: `splitInkTextLayer` splits an ink note body into text layers.
- `stamp_workspace_id.rs`: `stampWorkspaceId` writes the `weaveforge-id` line
  into a hand-written file's frontmatter.
- `pglite_sql.rs`: SQL-text helpers for the local PGlite backend.
- `workspace_snapshot.rs`: the snapshot types and counts that the serializer
  reads.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`sync_folder_merge.rs` and
others). The TypeScript wrappers in `packages/wf-wasm/src` import the raw names
from `../pkg/wf_wasm.js` and re-export them. The main names are `digestText`,
`planDelta`, `applyDelta`, `stampWorkspaceId`, `decideVaultCommit`,
`describePush`, `redactSecret`, `splitInkTextLayer`, `jsonEditSince`,
`folderTitleFromPath` and `pickProjectFolder`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`. For example,
`apps/web/src/features/workspace/application/mirror-manifest.ts` calls
`readyCore().jsonEditSince`, `folder-import-apply.ts` calls
`readyCore().folderTitleFromPath`, and `remove-project-folder.ts` calls
`typedCore().pickProjectFolder`. `ink-host.tsx` calls
`typedCore().splitInkTextLayer`.

## What stays in TypeScript, and why

- **The outbox and conflict store.** The outbox writes and the conflict store
  calls stay in `apps/web/src/features/offline-sync`. Rust picks the route; the
  app carries it out.
- **The merge itself and file I/O.** `folder_merge.rs` decides the merge. The
  file reads and writes stay in `apps/web/src/features/workspace/application/folder-merge.ts`.
- **Git and network.** Running git and sending the push stay in TypeScript.
  Rust only checks the URL and describes the result.
- **The PGlite runtime.** `pglite_sql.rs` builds SQL text. The value encoding and
  the PGlite client stay in `apps/web/src/backend/providers/local/pglite-client.ts`.
- **Store reads.** `collectWorkspaceSnapshot` reads the stores and is not
  ported. Rust keeps only the fields the serializer reads.

## Related

- [Workspace core](workspace.md)
- [Search core](search.md)
- [Storage core](storage.md)

Source: `crates/wf-core/src/sync/`
