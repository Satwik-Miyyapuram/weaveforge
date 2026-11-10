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
- Wrapper `packages/wf-wasm/src/vault-search.ts`, typed through `VaultSearchFns` in `packages/core/src/shared/core-contract.ts`.
- `apps/shell/sidecar/src/vault-search.ts`: `walkVault` skips dot directories via `isSkippedDir`; `searchVault` filters with `isSearchFile` and cuts with `searchMatches`.
- `apps/shell/sidecar/src/vault-folder.ts`: `verifyRoot` and `workspaceRootFor` map the verdict through `rootVerdict` and `chooseRoot`; `writeFile` stages with `temporaryName`; `list` skips with `isTemporaryName`.

## What stays in TS

The folder walk and file reads in `vault-search.ts`. In `vault-folder.ts`: `stat`, `readdir`, `mkdir`, `realpath` containment (`assertInside`), the staged write itself, and `rootFingerprint` (SHA-256 of the resolved path; wf-core has no sha2 dependency, so it is not ported).
