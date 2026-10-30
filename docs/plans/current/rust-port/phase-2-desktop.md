# Phase 2 design: desktop on Tauri 2

One page, per plan §4.3. Plan: [plan.md](plan.md) § Phase 2.

## Scope

`apps/desktop` (Electron, 12.4k lines in `src/`, 63 test files) becomes
`apps/shell` (Tauri 2) plus a new crate `wf-store` for native I/O. The React UI
does not change: it already talks to the shell only through
`window.weaveforge`, typed by `DesktopBridge` in
`apps/web/src/lib/desktop/desktop-bridge.ts`, over 65 channels named in
`apps/desktop/src/channels.ts`.

| Electron today | Tauri 2 |
| --- | --- |
| `preload.ts` exposes `window.weaveforge` with `ipcRenderer.invoke` | an init script exposes the same `window.weaveforge`, built on generated `invoke` calls |
| `ipcMain.handle` per channel, guarded by `ipc-guard.ts` | one `#[tauri::command]` per channel in `apps/shell`, typed by tauri-specta |
| `app://weaveforge` protocol serving `dist/web` | Tauri asset protocol serving the same static export, with the same CSP |
| `node:fs`, the `git` CLI, Electron `safeStorage` | `wf-store` (std fs, gix, `keyring`) |
| transformers.js in a worker for embeddings | `ort` in `wf-store` (native) |

## The contract stays one file

- Commands and their payload types are Rust, exported by tauri-specta into one
  generated `bindings.ts`, beside the wf-wasm one. CI fails on a stale copy.
- The shim `apps/shell/bridge/bridge.ts` implements `DesktopBridge` with those
  generated calls. `tsc` checks it against the interface the UI already uses,
  so a missing or mistyped method fails the build, not the user.
- Every command returns `Result<T, ShellError>`, and the shim maps it to the
  same thrown `Error` messages the Electron bridge throws today
  (`IpcResult<T>`), so the UI's error handling is unchanged.
- Events (`vaultChanged`, `signIn`, `semanticRanked`, `menuChanged`) are
  Tauri events with typed payloads, also generated.

## What is not ported in phase 2

The local database (PGlite in Electron's Node main process), the local HTTP
API and the local MCP server read and write that database in-process. Moving
storage is phase 3, so in phase 2 they move unchanged into a **Node sidecar**
(`apps/shell/sidecar`, the existing TS, bundled with esbuild, run by Tauri's
shell plugin, spoken to over stdio JSON lines). Phase 3 replaces it and deletes
it. The sidecar's size and memory are measured and reported, not hidden.

## Steps (one PR each, into `feat/rust-port`)

1. **2.1** this doc.
2. **2.2** `apps/shell` skeleton: a window that loads `dist/web` with the
   Electron CSP, no bridge (the app runs in browser mode). Every new
   cargo-deny skip gets a reason (carried from phase 0). Builds in CI (Linux)
   and locally (Windows ARM64).
3. **2.3** `wf-store::vault`: root confinement and the file ops of
   `vault-folder.ts`, tests ported first from `vault-folder.test.ts`.
4. **2.4** vault commands, watch events and the bridge shim for them; the app
   opens a workspace folder in the Tauri build.
5. **2.5** secrets (`keyring`) and preferences.
6. **2.6** proxies: title, image, PDF, arXiv, Semantic Scholar, HTML, blob.
7. **2.7** git sync with gix: commit, log, remote sync.
8. **2.8** Overleaf read and sync.
9. **2.9** the Node sidecar: local DB, local API, MCP.
10. **2.10** embeddings on `ort`.
11. **2.11** the rest: TeX, Zotero, Mattermost, updates, app log, menu,
    title bar, plan widget, ink.
12. **2.12** e2e on WebView2 (and WebKit in CI), `baseline.mjs`, installer
    size, the 1,039-passage embedding time.

## Done when (plan § Phase 2)

- The desktop tests pass against the Tauri build. Each step ports the tests
  for the channels it moves, first.
- `baseline.mjs`: nav p50 no worse; idle private memory at most 510 MB on
  Windows.
- Installer size measured.
- 1,039 passages embedded in under a minute.

## Risks

- **Origin.** The UI and the Supabase sign-in callback assume
  `app://weaveforge`. Tauri on Windows serves `http(s)://tauri.localhost`.
  2.2 checks CSP, `'self'`, the service worker being off, and the sign-in
  loopback before anything else is ported.
- **Dependencies.** Tauri brings many duplicate crate versions. Each gets a
  `deny.toml` skip with a reason, scoped to the shell, so `wf-core` stays
  strict.
- **Memory while building.** This machine has about 4 GB free. Shell builds
  run with `-j 4`.
