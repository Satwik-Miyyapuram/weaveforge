# Desktop shell (`weaveforge-shell`)

`apps/shell` is the desktop and phone app on Tauri 2. It serves the static web export over the `app` scheme, starts the native local database behind typed DB commands, and gives the main window the `window.weaveforge` bridge (`apps/shell/src/lib.rs` says so).

- Workspace: its own (`[workspace]` in `apps/shell/Cargo.toml`). Tauri brings duplicate crate versions that the root workspace's `cargo-deny` bans must not take in. The shell's bans are in `apps/shell/deny.toml`.
- Modules: 50 `pub mod` in `src/lib.rs`. `local_http/` is the local HTTP API and MCP server; `local_pg/` is the native Postgres child that replaced PGlite.
- Our crates: [`wf-core`](wf-core.md), [`wf-store`](wf-store.md) (on phones with `default-features = false`), and [`wf-relay`](relay.md) with feature `specta`.
- Typed commands: `tauri-specta` writes `apps/shell/bridge/bindings.ts` from the command signatures.
- Desktops use `native-tls` and `git2` with https and ssh. Phones use `rustls` on `ring` and `git2` without https.
- Other folders: `bridge/`, `capabilities/`, `icons/`, `installer/` (the NSIS art and hooks), `native/`, `plugins/` (for example `apps/shell/plugins/ink`), `scripts/`, `widget/`, `tests/`. The Tauri configs are `tauri.conf.json`, `tauri.dev.json`, `tauri.bundle.json` and `tauri.android.conf.json`.
- Icons: the static icons (app closed; used by the .exe, installer and Start menu) are `icons/icon.ico` (16, 24, 32, 48, 64, 256) and `icons/icon.png` (512), made from `apps/web/public/icons/weave_forge.svg` by `node apps/shell/scripts/build-icons.mjs` (headless Edge renders each size on a transparent background). They use the CRT C1 light-mode colours: plum ink `#2B222B` and CRT blue dot `#1F6DAB`. An `.ico` is one image for every Windows surface, so it adds a thin cream `#FFE7C1` halo that keeps it visible on a dark taskbar as well as a light one. `--ink #rrggbb` overrides the ink. The standalone SVG fallbacks and the web favicon ship both sets: light (`#2B222B` / `#1F6DAB`) and dark (`#FFE7C1` / `#5AA0D8`). The running window and taskbar icon is set at runtime, not by these files (desktop only): the page (`apps/web/src/features/desktop-window-icon`) renders the emblem in the active theme's `--text` (ink) and `--accent` (dot), and the shell's `window_icon_set` command applies it with Tauri `set_icon` as a base64 PNG. The taskbar mode comes from `os_uses_light_theme`, which reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\SystemUsesLightTheme` (a missing or unreadable value counts as light). Each colour must reach a 3:1 WCAG contrast ratio against the taskbar background (`#f3f3f3` light, `#202020` dark); otherwise the static C1 colour for that mode is used, so the icon never disappears. The pure pick lives in `window-icon-colours.ts`; the Rust side is `apps/shell/src/window_icon.rs`. `apps/shell/scripts/shell-icons.test.mjs` checks the sizes, no tile, the C1 colours, the halo, and contrast on `#f3f3f3` and `#202020`.
- Installer: `tauri.conf.json` sets `bundle.windows.nsis`. `installer/installer.nsh` closes both `WeaveForge.exe` (Electron) and `weaveforge-shell.exe` before install and uninstall. `apps/shell/scripts/installer-config.test.mjs` checks the referenced files, the merged release config, and the close macro.
- `apps/shell/package.json` only pins the Tauri CLI (`npm run tauri`), for Gradle's Android build.

- Sign-in loopback: `apps/shell/src/auth_loopback.rs` listens on `127.0.0.1:53682` at `/auth/callback` (the port Supabase allow-lists). The listener starts at launch with bounded retry (`SIGN_IN_RETRY`: 500 ms, 1 s, 2 s). If the port is still held, the sign-in page's probe (`sign_in_listening`) retries on demand, so recovery needs no restart. `SignInPort.listening` is false until a bind succeeds. Callbacks with `error=` or no `code` get a 400 failure page; a repeated callback is answered but handed to the webview only once. If the port stays busy, the login screen offers a paste-the-address form (`pastedSignInQuery` in `apps/web/src/lib/desktop/desktop-auth.ts`).

Building and testing WeaveForge Dev: `.agents/testing.md`.

## Electron data migration (`migrate.rs`)

- Source: the Electron userData dir for the release, `<appData>/@weaveforge/desktop` (fallback `<appData>/<productName>`). The first candidate holding `local-db` or `preferences.json` wins. A repo-checkout run (`AppSource::Dev`) never reads it.
- The copy is read-only on the Electron side: the old dir is byte-identical after a run, and no marker is written there.
- Copies the seven `ITEMS` in `migrate.rs` (`local-db`, `local-db-backups`, `preferences.json`, `models`, `artifacts`, `weaveforge.log`, `overleaf-git`; never `secrets.json`) into the new dir through `.migrating`. Items that already exist in the new dir move to `.pre-migration/<time>/` first.
- Done marker: `migrated-from-electron` (JSON: `from`, `at`, `copied`, `secretsLeftBehind`) in the new dir, written last. A marker that copied nothing is retried once the source has data.
- Also writes `migrated` (JSON: `to`, `at`) into the new dir only.

Source: `apps/shell/src/`
