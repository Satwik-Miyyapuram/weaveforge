# shell_paths

Rust home: `crates/wf-core/src/shell_paths.rs`, plus `mcp_client_configs` in `crates/wf-core/src/mcp_config_rewrite.rs`.

## What it owns

- `join_path(sep, parts)`: Node `path.join` for plain segments. Skips empty parts, collapses runs of separators, resolves `.` and `..` like Node, keeps a trailing separator, keeps a `C:` drive root on win32, and turns `/` into `\` when `sep` is `\`. A `..` above a root is dropped; `""` for no parts, `.` for a path that resolves to nothing.
- `mcp_client_configs(home, platform, app_data, sep)`: Cursor's `mcpServers` file, then VS Code's `servers` file. Win32 uses `app_data` or `<home>/AppData/Roaming`; darwin uses `Library/Application Support`; other platforms use `.config`.

## Where it is called

- The native shell rewrites MCP configs itself: `mcp_client_configs` and `rewrite_mcp_client_configs` in `apps/shell/src/local_http/rewrite.rs`.

## What stays in TS

Reading and writing the home pointer and the MCP config files, the rewrite-and-backup flow, and `mcp-connect.ts`, which still joins `HOME_CONFIG_DIR` itself.
