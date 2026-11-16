# Desktop shell (`weaveforge-shell`)

`apps/shell` is the desktop and phone app on Tauri 2. It serves the static web export over the `app` scheme, starts the native local database behind typed DB commands, and gives the main window the `window.weaveforge` bridge (`apps/shell/src/lib.rs` says so).

- Workspace: its own (`[workspace]` in `apps/shell/Cargo.toml`). Tauri brings duplicate crate versions that the root workspace's `cargo-deny` bans must not take in. The shell's bans are in `apps/shell/deny.toml`.
- Modules: 50 `pub mod` in `src/lib.rs`. `local_http/` is the local HTTP API and MCP server; `local_pg/` is the native Postgres child that replaced PGlite.
- Our crates: [`wf-core`](wf-core.md), [`wf-store`](wf-store.md) (on phones with `default-features = false`), and [`wf-relay`](relay.md) with feature `specta`.
- Typed commands: `tauri-specta` writes `apps/shell/bridge/bindings.ts` from the command signatures.
- Desktops use `native-tls` and `git2` with https and ssh. Phones use `rustls` on `ring` and `git2` without https.
- Other folders: `bridge/`, `capabilities/`, `icons/`, `native/`, `plugins/` (for example `apps/shell/plugins/ink`), `scripts/`, `widget/`, `tests/`. The Tauri configs are `tauri.conf.json`, `tauri.dev.json`, `tauri.bundle.json` and `tauri.android.conf.json`.
- `apps/shell/package.json` only pins the Tauri CLI (`npm run tauri`), for Gradle's Android build.

Building and testing WeaveForge Dev: `.agents/testing.md`.

## Electron data migration (`migrate.rs`)

- Source: the Electron userData dir for the release, `<appData>/@weaveforge/desktop` (fallback `<appData>/<productName>`). The first candidate holding `local-db` or `preferences.json` wins. A repo-checkout run (`AppSource::Dev`) never reads it.
- The copy is read-only on the Electron side: the old dir is byte-identical after a run, and no marker is written there.
- Copies the seven `ITEMS` in `migrate.rs` (`local-db`, `local-db-backups`, `preferences.json`, `models`, `artifacts`, `weaveforge.log`, `overleaf-git`; never `secrets.json`) into the new dir through `.migrating`. Items that already exist in the new dir move to `.pre-migration/<time>/` first.
- Done marker: `migrated-from-electron` (JSON: `from`, `at`, `copied`, `secretsLeftBehind`) in the new dir, written last. A marker that copied nothing is retried once the source has data.
- Also writes `migrated` (JSON: `to`, `at`) into the new dir only.

Source: `apps/shell/src/`
