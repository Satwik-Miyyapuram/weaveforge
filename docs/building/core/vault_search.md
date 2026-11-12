# vault_search

Rust home: `crates/wf-core/src/vault_search.rs`.

## What it owns

- `is_search_file(path)`: a markdown file by its exact lowercase `.md` extension.
- `is_skipped_dir(path)`: the last segment starts with a dot.
- `search_matches(text, query)`: lines containing `query` ignoring case, split on `\n` with a `\r` before it dropped, at most 5, each cut to 120 UTF-16 units.
- `root_verdict(is_dir, entries, meta_dir)`: `notADirectory`, `existing`, `empty` or `notEmpty`. Dotfiles do not count as files.
- `choose_root(verdict)`: `use`, `nest` or `refuse`.
- `temporary_name(target, pid, seq)` and `is_temporary_name(name)`: the staged-write name `<target>.<pid>.<seq>.wftmp`.

## Where it is called

- wasm exports `searchMatches`, `isSearchFile`, `isSkippedDir`, `rootVerdict`, `chooseRoot`, `temporaryName` and `isTemporaryName` in `crates/wf-wasm/src/vault_search.rs`.
- No TS wrapper; typed through `rust()` in `packages/core/src/shared/rust.ts`.
- `apps/shell/src/vault_search.rs`: `walk_vault` and `search_vault`, the native walk and search.
- `apps/shell/src/cmd_vault.rs`: `pick_folder` and the vault read/write/list commands.

## What stays in TS

The folder walk and file reads in `vault-search.ts`. In `vault-folder.ts`: `stat`, `readdir`, `mkdir`, `realpath` containment (`assertInside`), the staged write itself, and `rootFingerprint` (SHA-256 of the resolved path; wf-core has no sha2 dependency, so it is not ported).
