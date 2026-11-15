# Desktop shell (`weaveforge-shell`)

`apps/shell` is the desktop and phone app on Tauri 2. It serves the static web export over the `app` scheme, starts the native local database behind typed DB commands, and gives the main window the `window.weaveforge` bridge (`apps/shell/src/lib.rs` says so).

- Workspace: a member of the root workspace (`members` in the root `Cargo.toml`). CI checks it against its own `apps/shell/deny.toml`, because Tauri brings duplicate crate versions that the root `cargo-deny` bans (which are strict for `crates/*` only) would reject.
- Modules: 49 `pub mod` in `src/lib.rs`. `local_http/` is the local HTTP API and MCP server; `local_pg/` is the native Postgres child that replaced PGlite.
- Our crates: [`wf-core`](wf-core.md), [`wf-store`](wf-store.md) (on phones with `default-features = false`), and [`wf-relay`](relay.md) with feature `specta`.
- Typed commands: `tauri-specta` writes `apps/shell/bridge/bindings.ts` from the command signatures.
- Desktops use `native-tls` and `git2` with https and ssh. Phones use `rustls` on `ring` and `git2` without https.
- Other folders: `bridge/`, `capabilities/`, `icons/`, `native/`, `plugins/` (for example `apps/shell/plugins/ink`), `scripts/`, `widget/`, `tests/`. The Tauri configs are `tauri.conf.json`, `tauri.dev.json`, `tauri.bundle.json` and `tauri.android.conf.json`.
- `apps/shell/package.json` only pins the Tauri CLI (`npm run tauri`), for Gradle's Android build.

Building and testing WeaveForge Dev: `.agents/testing.md`.

Source: `apps/shell/src/`
