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
- `workspace/sync_report.rs`: `describeSync`, the one line the panel shows after
  a folder sync. Counts and the commit outcome come in; a refused commit is said,
  not read as "up to date". The write and the commit stay in TypeScript.
- `sync/blob_links.rs` (`workspace_bodies`): which bodies can carry an image
  reference, vault page bodies first, then paper summaries.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`workspace_outside_edits.rs`,
`workspace_folder_diff.rs`, `asset_mime.rs`). The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are:

- Outside edits: `splitOutsideEdits`, `renamedOutsidePaths`.
- Folder diff: `renameSources`, `seenFiles`.
- Assets: `assetMimeType`, `assetExtension`, `workspaceBodies`.
- Sync report: `describeSync` (`workspace-sync-report.ts`). The app calls
  `readyCore().describeSync` from `workspace-folder.ts`.
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
- **The outside-edit flow.** `apps/web/src/features/workspace/application/parts-3.ts`
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

## More workspace modules

Each module lives in `crates/wf-core/src/workspace/<module>.rs`. Wasm exports
live in `crates/wf-wasm/src/workspace_<module>.rs`.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `auto_apply` | `auto_apply_timing` | `autoApplyTiming` | `apps/web/src/features/workspace/application/workspace-folder.ts` |
| `claim_import` | `plan_claim` | `planClaimImport` | `apps/web/src/features/workspace/application/parts-3.ts` |
| `coalescer` | `step` | `coalescerStep` | `apps/web/src/features/workspace/application/parts-3.ts` |
| `folder_report` | `triage_reported_paths` | `triageReportedPaths` | `apps/web/src/features/workspace/application/workspace-folder.ts` |
| `git_shim` | `normalize_repo_path` | `normalizeRepoPath` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `git_shim` | `git_status_state` | `gitStatusState` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `git_shim` | `unstage_action` | `unstageAction` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `git_shim` | `out_of_scope_strays` | `outOfScopeStrays` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `git_shim` | `dir_entry_names` | `dirEntryNames` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `git_shim` | `split_leaf` | `splitLeaf` | `apps/web/src/features/workspace/infrastructure/parts.ts` |
| `json_apply` | `plan_json_apply` | `planJsonApply` | `apps/web/src/features/workspace/application/parts-1.ts` |
| `mirror_manifest` | `manifest_text` | `mirrorManifestText` | `apps/web/src/features/workspace/application/parts-3.ts` |
| `mirror_manifest` | `same_manifest_ignoring_stamp` | `sameManifestIgnoringStamp` | `apps/web/src/features/workspace/application/parts-3.ts` |
| `preview_read` | `plan_preview_reads` | `planPreviewReads` | `apps/web/src/features/workspace/application/parts-2.ts` |
| `preview_read` | `plan_asset_reads` | `planAssetReads` | `apps/web/src/features/workspace/application/parts-2.ts` |
| `preview_read` | `admit_asset_bytes` | `admitAssetBytes` | `apps/web/src/features/workspace/application/parts-2.ts` |
| `project_rename` | `pick_renamed_folder` | `pickRenamedFolder` | `apps/web/src/features/workspace/application/parts-3.ts` |
| `settle_external` | `settle_external` | `settleExternal` | `apps/web/src/features/workspace/application/workspace-folder.ts` |
| `stored_pages` | `stored_digest` | `storedDigest` | `apps/web/src/features/workspace/application/parts-1.ts` |
| `stored_pages` | `stored_digests` | `storedDigests` | `apps/web/src/features/workspace/application/parts-1.ts` |
| `stored_pages` | `owned_storage` | `ownedStorage` | `apps/web/src/features/workspace/application/parts-1.ts` |
| `stored_pages` | `storage_path` | native only | — (called by `owned_storage`) |

Rules:

- `auto_apply`: the caller passes `debounceMs` and `maxWaitMs`; the delay is the
  debounce capped by the time left before the first ask's max wait, never negative.
  With no waiting ask, `firstAt` is `now`.
- `claim_import`: no write when the file already carries an id. Otherwise the
  digest is recorded against the stamped text so the next mirror removes the copy.
- `coalescer`: a request while `suspended` arms no timer. A run request while one
  is in flight sets `again`, and `RunSettled` re-runs once if owed and not suspended.
  `cancel` clears only the timer; a run in flight still finishes.
- `folder_report`: paths under the drafts folder set `drafts` and are not candidates.
  App-owned paths are dropped. With a non-empty `projectId`, a subfolder whose
  `--SUFFIX` (1 to 8 letters or digits) differs from the project's suffix is dropped.
- `git_shim`: `normalize_repo_path` strips leading and trailing `/` and maps `.` to
  `""`. `git_status_state` maps (head 0, workdir >0) to `added`, (head >0, workdir 0)
  to `deleted`, (head >0, workdir 2) to `modified`, else none. `unstage_action`
  keeps when stage equals head, removes when head is 0, else resets to HEAD.
  `dir_entry_names` sorts in UTF-16 order.
- `json_apply`: `unchanged` and `conflict` entries are skipped. `removed` becomes a
  remove step; anything else is a save. `relations` and `tags` route to their
  features, any other kind to reading list items.
- `mirror_manifest`: `MANIFEST_VERSION` is `3` (no wasm export). Paths are sorted by
  UTF-8 bytes and de-duplicated; digests and bases are kept only for listed paths.
  `same_manifest_ignoring_stamp` ignores only the `"writtenAt"` line.
- `preview_read`: with a project folder, notes and data files count only under the
  project root. `plan_asset_reads` marks an asset over `maxFileBytes` as `too-big`.
  `admit_asset_bytes` drops an over-file-cap asset without changing the total; a total
  over `maxTotalBytes` is an error.
- `project_rename`: returns the one directory ending with the tail; none or several
  give no pick.
- `settle_external`: without `only`, the list becomes the non-unchanged preview paths.
  With `only`, covered paths settle from the preview and other listed paths keep
  their old reasons.
- `stored_pages`: a stored digest is `digest_text(title + "\n" + body)`.
  `storage_path` drops the first two segments of an asset folder path
  (`assets/<scope>/<path>` becomes `<path>`).
