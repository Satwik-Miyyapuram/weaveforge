# Files-first foundations (0.9.4, L0)

From 0.9.4 the files in the workspace folder are the source of truth. This page covers
the base layer every later lane builds on: safe writes, trash, the file index, the
per-device base store, the git allowlist and a pull that says what it changed.

This lane branches from `main`, not from `feat/091-gh-autosync` as the plan says,
because that branch is already merged into `main`.

## Safe writes

`Vault::write_text_checked` and `Vault::write_bytes_checked` (`crates/wf-store/src/checked_write.rs`)
write a file only if it still has the hash the caller read.

- The hash is SHA-256. For text it is taken over the canonical form (Unicode NFC, LF line
  endings), so a Windows editor that turns LF into CRLF does not count as a change. Binary
  files are hashed byte for byte.
- The write goes to a temp file, is flushed to disk, and the old file is kept as a
  `.wfprev` hard link (a copy where links fail) before the rename. After the rename the
  file is hashed again. If another program changed it before the old file was kept, its
  text is saved as a conflict copy. A write that lands between keeping the old file and the
  rename is replaced and not kept (a known window; closing it needs a no-replace swap that
  is not implemented yet), so "nothing is lost" holds only outside that window.
- The result is `Written { hash }`, or `Changed { disk_hash }` when the file moved on.
  Nothing is written in that case; the caller merges and tries again.
- A crash at any moment leaves the old or the new file, never half of one
  (`vault_crash.rs`).

## Trash and rename

- `delete_to_trash` moves a file to `.weaveforge/trash/<day>/<path>`. Two deletes of the
  same path on one day both stay; the second gets a suffix.
- `rename_checked` moves a file inside the workspace. If the target already exists, the
  old target is kept as a conflict copy.

## File format version

Files carry `wf: 3` in their frontmatter (`FORMAT_VERSION`). A file from a newer app
(`wf: 4` or more) opens read-only, so an old app never damages it.

## The file index

`wf_core::index` reads notes (`.md`), freeform pages (`.canvas`) and each project's
`.weaveforge/relations.json` into an in-memory `IndexStore`: id, path, kind, project,
title, tags, links, read-only and duplicate flags. Two files with the same id are both
marked duplicate and neither is written. The index lives in memory only; the shell
rebuilds it on first use after any file change.

## Base store

`.weaveforge/local/bases.sqlite` (`wf_store::bases`) keeps, per item, the text the app
last saw on disk plus a Yjs snapshot. The merge (L1) uses it as the common ancestor. It
is per device and never synced.

## What git syncs

Under the root `.weaveforge/` folder only `workspace.json`, `settings.json`, `tags.json`,
`fields.json`, `quotation-types.json` and `ai/` are synced (`git_policy::is_local_meta`).
Everything else there (the local database, backups, tokens, trash, bases) stays on the
device. `wf_store::files::gitfiles` adds missing `.gitignore` lines once and keeps the
user's own lines.

## Pull with paths

`pull_listing` (`crates/wf-store/src/git/remote.rs`) pulls like `pull` and also returns
the paths the pull wrote. This folder's own pending edits are committed first and are
not listed.

## Shell commands

`apps/shell/src/cmd_files.rs`:

| Command | Does |
| --- | --- |
| `file_write`, `file_write_bytes` | Checked write; returns `{ hash }` or `{ changed: { diskHash } }` |
| `file_delete` | Moves to trash; returns `{ trashedTo }` |
| `file_rename` | Checked rename |
| `base_get`, `base_set` | Read or store an item's base |
| `index_get`, `index_list` | One indexed file by id; all of one kind, optionally per project |
| `watcher_rescan` | Rebuilds the index and re-sends every path as `vault-changed` batches of 500 |
| `git_pull_now` | Pulls and emits one `pull-batch` event with the written paths |
| `git_file_history` | The commits that changed one file |

The folder watch ignores `.wfprev` links and this device's `.weaveforge/` files. When the
OS drops events it emits `vault-watch-overflow`; the page answers with `watcher_rescan`.
