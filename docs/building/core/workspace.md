# Workspace core module

The `workspace` module holds the rules for files inside a workspace folder:
which relative paths are safe, how an outside edit is triaged, which new folder
paths are renames, how far an imported archive may expand, and which content
type an asset gets. It does no file I/O. The caller reads and writes the files
and passes in names, sizes and digests.

## What lives in Rust

- `workspace.rs`: `safe_workspace_path` and `is_safe_workspace_path` keep a path
  relative, normalized and inside the root.
- `workspace/outside_edits.rs`: triage for an edit made in the connected folder
  by another program. The edit is taken in without asking only when the folder
  alone changed that file since both sides last agreed, and the note is not open
  in an editor. A JSON data file is written whole or not at all. Everything else
  is held for review, with the first reason that holds it.
- `workspace/folder_diff.rs`: finds which new folder paths are renames of a
  note's old file, and what each folder file said when the two sides last agreed.
  Digests use the same hash as the mirror manifest.
- `workspace/archive_limits.rs`: limits on an imported archive: entry count,
  file size and total expansion. The limits are decided from names and sizes;
  the bytes stay with the caller.
- `workspace/asset_mime.rs`: the content type and file extension of an imported
  asset.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`workspace_outside_edits.rs`,
`workspace_folder_diff.rs`, `asset_mime.rs`). The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are:

- Outside edits: `splitOutsideEdits`, `renamedOutsidePaths`.
- Folder diff: `renameSources`, `seenFiles`.
- Assets: `assetMimeType`, `assetExtension`.
- Explorer rows: `rowSlots` (`crates/wf-core` `editor_workspace::explorer_window`).
  The app calls `readyCore().rowSlots(count, viewport, pinned, EXPLORER_ROW_METRICS)`
  from `editor-workspace/ui/explorer-panel.tsx`. The row metrics live in
  `editor-workspace/ui/explorer-window-constants.ts`. The old
  `application/explorer-window.ts` wrapper is gone (batch 7).

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`. Call `readyCore()` only after `loadCore()` has
resolved.

The folder-mirror helpers used by the import and manifest code (`jsonEditSince`,
`folderTitleFromPath`, `pickProjectFolder`) belong to the sync module. See
[Sync core](sync.md).

## What stays in TypeScript, and why

- **Reading and writing folder files.** Browser file handles and desktop file
  APIs are I/O. Rust sees names, sizes and digests, and the caller keeps the
  bytes.
- **The outside-edit flow.** `apps/web/src/features/workspace/application/outside-edits.ts`
  runs the triage, shows the review list and applies the choices. The rules
  come from Rust; the orchestration and its dialogs stay in TypeScript.
- **Keep-both titles and import limits in the app.** The title helper for a
  kept-both copy and the import size settings are app choices, not core rules.
- **The editor state.** Whether a note is open in an editor is an input to the
  triage. The editor itself stays in `apps/web`.

## Related

- [Sync core](sync.md)
- [Storage core](storage.md)
- [Vault core](vault.md)

Source: `crates/wf-core/src/workspace.rs`
