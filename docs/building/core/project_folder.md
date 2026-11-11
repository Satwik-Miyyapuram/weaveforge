# project_folder

Rust home: `crates/wf-core/src/project_folder.rs`.

## What it owns

- `project_folder_name(dir)`: the project a folder stands for. A folder counts only when its name ends in `--` followed by 1 to 6 ASCII letters or digits. The result is the name before that `--`, or `None` when no suffix is there. Matching is case-insensitive, as the old `/--[a-z0-9]{1,6}$/i` regex was.

## Where it is called

- wasm export `projectFolderName` in `crates/wf-wasm/src/project_folder.rs`.
- Wrapper `packages/wf-wasm/src/wrappers-9.ts`, typed through `rust()` in `packages/core/src/shared/rust.ts`.
- `apps/shell/sidecar/src/local-mcp-projects.ts`: `resolveProjects` fallback, used when the app's project list is not available.

## What stays in TS

Listing the vault folders (`listVaultFiles`), the project-to-folder match that uses `projectDir` and `idSuffix`, and the `workspace` fallback entry.
