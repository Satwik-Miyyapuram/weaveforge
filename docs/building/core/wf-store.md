# Native store (`wf-store`)

`crates/wf-store` is the native I/O crate: the workspace folder, git history, remote sync and on-device embeddings. It is never built for wasm (`crates/wf-store/src/lib.rs` says so), so it has no wasm export column. The app reaches it from `apps/shell` (Tauri) only.

| Module | Purpose | Main pub items | Who calls it |
| --- | --- | --- | --- |
| `embed` (feature `embeddings`) | Native sentence embeddings on `ort` and `tokenizers`, matching transformers.js q8 models | `Encoder`, `Profile`, `profile_for`, `prepare`, `EmbedKind`, `MODEL_FILES`, `MAX_TOKENS`, `BATCH`, `pool_cls`, `pool_mean`, `normalize`, `pad_rows` | `apps/shell/src/embed.rs` |
| `git::policy` | Which workspace paths may enter folder history, and whether a folder may be committed to | `decide_path`, `decide_commit`, `is_under_ignored_folder`, `RepoState`, `CommitAction`, `SkipReason`, `GIT_OFF`, `MAX_FILE_BYTES`, `IGNORED_DIRS`, `IGNORED_FILES`, `IGNORED_EXTENSIONS` | `apps/shell/src/git.rs`, `apps/shell/src/vault_sync.rs` |
| `git::repo` | The folder repository itself, via `git2`: probe, init, status, commit, log, read-back | `FolderRepo`, `probe`, `commit_vault`, `commit_all`, `status`, `log`, `read_at`, `Commit`, `CommitOutcome`, `FileChange`, `Author`, `RepoError`, `MIRROR_AUTHOR`, `DEFAULT_BRANCH`, `STALE_LOCK_SECS`, `MAX_READ_BYTES` | `apps/shell/src/git.rs`, `apps/shell/src/vault_sync.rs`, `apps/shell/src/overleaf_links.rs` |
| `git::remote` | Sync a folder repo with one https remote: status, pull, push | `remote_status`, `pull`, `pull_resolving`, `push`, `describe_pull`, `describe_push`, `redact_secret`, `redact_secret_for`, `token_may_go_to`, `rejection_reason`, `RemoteConfig`, `RemoteStatus`, `PullOutcome`, `PushOutcome`, `PullChoice`, `SYNC_REMOTE`, `SYNC_BRANCH` | `apps/shell/src/vault_sync.rs`, `apps/shell/src/overleaf_links.rs` |
| `root` | Choosing the folder a workspace lives in; telling our folder from a stranger's | `verify_root`, `workspace_root_for`, `RootState`, `RootError`, `RootChoice`, `WORKSPACE_SUBDIR` | `apps/shell/src/vault.rs` |
| `vault` | File operations inside the workspace folder, confined to its root even through links | `Vault`, `Entry`, `EntryKind`, `VaultError`, `TEMP_SUFFIX`, `WALK_DEPTH_MAX` | `apps/shell/src/vault.rs`, `apps/shell/src/vault_watcher.rs` (`TEMP_SUFFIX` only) |
| `workspace_fs` | `impl WorkspaceFs for Vault`: maps vault results and errors onto the `wf-core` port | none (trait impl only) | No `wf_store::` import outside the crate. Used as `dyn WorkspaceFs` in `crates/wf-store/tests/vault_crash.rs` |

Cargo features (`crates/wf-store/Cargo.toml`):

- `default = ["git-https", "embeddings"]`.
- `git-https` enables `git2/https`, `git2/ssh` and `git2/vendored-openssl`.
- `embeddings` enables the optional `ort` and `tokenizers` dependencies, and gates `pub mod embed` in `lib.rs`.
- `apps/shell/Cargo.toml` uses the default features on desktop. Its phone target (`cfg(any(target_os = "android", target_os = "ios"))`) uses `default-features = false`, so neither feature is on. Phones embed in the page, and git over https is off there.

Rules:

- `vault`: the root check and the file action are two steps, so a link swapped in between can still escape. Writes rename a temp file over the target with no fsync. Crash leftovers end in `.wftmp` (`TEMP_SUFFIX`), hidden from listings but not swept.
- `vault`: `WALK_DEPTH_MAX` is 64. A file name near the filesystem's length limit cannot get a temp sibling.
- `root`: `verify_root` refuses a folder that has the user's own files and no `.weaveforge` mark. Dot-files do not count as files. `workspace_root_for` nests a chosen folder with someone's files into `WeaveForge/` inside it instead of refusing.
- `git::policy`: `MAX_FILE_BYTES` (25 MiB) is the size cap for a path entering history. Ignored folders, files and extensions are listed in `IGNORED_DIRS`, `IGNORED_FILES` and `IGNORED_EXTENSIONS`. The web-side gate in `packages/core/src/workspace/parts.ts` applies the same rule.
- `git::repo`: `MAX_READ_BYTES` is 64 MiB. `STALE_LOCK_SECS` is 300. The mirror author is `MIRROR_AUTHOR`; the default branch is `main`.
- `git::remote`: one remote, `SYNC_REMOTE` (`weaveforge`), on `SYNC_BRANCH` (`main`). Secrets are redacted from messages, and a token goes only to a URL that `token_may_go_to` accepts.
- `embed`: `MAX_TOKENS` is 512 and `MAX_TEXT_CHARS` is `MAX_TOKENS * 128`. `BATCH` is 32. `MODEL_FILES` lists the model, tokenizer and config files fetched by name.

Source: `crates/wf-store/src/` (`embed.rs`, `git/`, `root.rs`, `vault.rs`, `workspace_fs.rs`)
