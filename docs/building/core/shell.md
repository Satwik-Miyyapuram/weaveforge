# Desktop shell (`weaveforge-shell`)

`apps/shell` is the desktop and phone app on Tauri 2. It serves the static web export over the `app` scheme, starts the native local database behind typed DB commands, and gives the main window the `window.weaveforge` bridge (`apps/shell/src/lib.rs` says so).

- Workspace: its own (`[workspace]` in `apps/shell/Cargo.toml`). Tauri brings duplicate crate versions that the root workspace's `cargo-deny` bans must not take in. The shell's bans are in `apps/shell/deny.toml`.
- Modules: 50 `pub mod` in `src/lib.rs`. `local_http/` is the local HTTP API and MCP server; `local_pg/` is the native Postgres child that replaced PGlite.
- Our crates: [`wf-core`](wf-core.md), [`wf-store`](wf-store.md) (on phones with `default-features = false`), and [`wf-relay`](relay.md) with feature `specta`.
- Typed commands: `tauri-specta` writes `apps/shell/bridge/bindings.ts` from the command signatures.
- Desktops use `native-tls` and `git2` with https and ssh. Phones use `rustls` on `ring` and `git2` without https.
- Other folders: `bridge/`, `capabilities/`, `icons/`, `installer/` (the NSIS art and hooks), `native/`, `plugins/` (for example `apps/shell/plugins/ink`), `scripts/`, `widget/`, `tests/`. The Tauri configs are `tauri.conf.json`, `tauri.dev.json`, `tauri.bundle.json` and `tauri.android.conf.json`.
- Icons: `icons/icon.ico` (16, 24, 32, 48, 64, 256) and `icons/icon.png` (512) come from the emblem source `apps/web/public/icons/weave_forge.svg`. Regenerate with `node apps/shell/scripts/build-icons.mjs` (headless Edge renders each size on a transparent background; `--ink #rrggbb` overrides the ink, default `#6B7A90`, which reads on both light and dark taskbars). `scripts/shell-icons.test.mjs` checks the sizes, no tile, and contrast on `#000` and `#fff`.
- Installer: `tauri.conf.json` sets `bundle.windows.nsis`. `installer/installer.nsh` closes both `WeaveForge.exe` (Electron) and `weaveforge-shell.exe` before install and uninstall. `scripts/installer-config.test.mjs` checks the referenced files, the merged release config, and the close macro.
- `apps/shell/package.json` only pins the Tauri CLI (`npm run tauri`), for Gradle's Android build.

Building and testing WeaveForge Dev: `.agents/testing.md`.

Source: `apps/shell/src/`
