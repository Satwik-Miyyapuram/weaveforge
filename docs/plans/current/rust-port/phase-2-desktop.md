# Phase 2 design: desktop on Tauri 2

One page, per plan §4.3. Plan: [plan.md](plan.md) § Phase 2.

## Scope

`apps/desktop` (Electron, 12.4k lines in `src/`, 63 test files) moves to a new
Tauri 2 app in `apps/shell`, plus a new crate `wf-store` for native I/O. The
React UI does not change: it reaches the shell only through
`window.weaveforge`, typed by `DesktopBridge` in
`apps/web/src/lib/desktop/desktop-bridge.ts`, over the channels named in
`apps/desktop/src/channels.ts`.

| Electron today | Tauri 2 |
| --- | --- |
| `preload.ts` exposes `window.weaveforge` over `ipcRenderer` | an init script exposes the same `window.weaveforge` over generated `invoke` calls |
| `ipcMain.handle` per channel, guarded by `ipc-guard.ts` | one `#[tauri::command]` per channel, typed by tauri-specta |
| `app://` handler: the `dist/web` bundle, the `/api/*` relays of `app-relays.ts` (pdf, html, s2, arxiv, blob, account, overleaf), `app://models` and `app://artifacts` | one custom scheme (`register_asynchronous_uri_scheme_protocol`) that serves all four; Tauri's built-in frontend and asset protocols cannot |
| `api-cors.ts` rewrites `Origin` for api.weaveforge.org | see Risks § Origin and CORS |
| `node:fs`, the `git` CLI, Electron `safeStorage` | `wf-store` (std fs, gix, `keyring`) |
| transformers.js in a worker for embeddings | `ort` in `wf-store` (native) |

## The contract stays one file

- Commands and payload types are Rust, exported by tauri-specta into one
  generated `bindings.ts`. CI fails on a stale copy.
- The new shim (`apps/shell/bridge/bridge.ts`) implements `DesktopBridge` with
  those calls. `tsc` checks it against the interface the UI already uses.
- Every command returns `Result<T, ShellError>`. The shim throws the same
  `Error(message)` the Electron preload throws for `IpcResult` today.
- Main → page events (`vaultChanged`, `signIn`, `menuChanged`) become typed
  Tauri events. The page → main `send` channels (`inkHaptics`, `windowFocus`,
  `appReport`, `titleBarColors`, `planWidgetTheme`) become commands whose
  result the shim drops.
- `semanticRank`/`semanticRanked` is a round trip, not an event: a local-API
  search in the sidecar asks the page to rank (sidecar → shell → page event →
  page computes → `invoke` → shell → sidecar). It keeps today's timeout and
  answers "no ranking" when the page is closed.

## What stays in Node until phase 3

PGlite, the local HTTP API and the local MCP server read and write the
database in-process, and the API and MCP serve outside clients on a port, which
a WebView cannot do. Moving storage is phase 3, so in phase 2 they will run
unchanged in a new Node sidecar (`apps/shell/sidecar`: the existing TS bundled
with esbuild, spoken to over stdio JSON lines). Phase 3 replaces and deletes it.
Its costs are stated, not hidden:

- **Size and memory.** A bundled Node adds about 70–90 MB to the installer and
  a second process to idle memory. Both count against the done-when numbers.
- **Lifetime.** The sidecar exits when its stdin closes, which happens on
  every OS when the shell exits or crashes. On Windows it is also put in a Job
  Object that kills it with the shell. An orphan would hold `acquireDbLock` and
  the next start would fail with `DatabaseInUseError`. 2.4 adds a test for this
  that runs on Windows and on Linux CI.
- **Signing.** The bundled `node.exe` is signed with the app.
- **MCP launch.** `mcp-connect.ts` writes client configs that run the Electron
  exe with `ELECTRON_RUN_AS_NODE=1`. The Tauri build has no such exe, so the
  configs will point at the sidecar's `node` and the bridge script. On first
  run, configs that the old build wrote are rewritten.

## User data moves once

Tauri's data dir follows the bundle identifier, not Electron's
`%APPDATA%/<productName>`. A new migration step (2.5) finds the Electron dir
and copies:

- `local-db` and its backups
- `preferences.json`
- `models`, `artifacts`, the app log

The copy runs only while the old dir's DB lock is free, so it never copies a
live PGlite dir. It copies into a temp dir and renames it into place, so a
crash leaves no half copy.

It never deletes the old dir, because Electron stays one release (plan §9.3).
A user who goes back to Electron after migrating would write to the old dir,
and the Tauri build would never see those writes. To stop that silent fork,
the migration writes a `migrated` marker into the old dir, and the last
Electron release warns on start when it finds one.

`secrets.json` is sealed by Electron `safeStorage` (Chromium os_crypt). It
could be decrypted (DPAPI on Windows, a Keychain item on Mac), but it holds a
few tokens, so the cost is not worth it. The user will re-enter those secrets
once, and the app says so. Web storage under the old `app://weaveforge` origin is not carried.
2.5 lists what the UI keeps there and proves nothing in that list is lost data.

## Steps (one PR each, into `feat/rust-port`)

1. **2.1** this doc.
2. **2.2** shell skeleton. It will add `apps/shell` as its own Cargo workspace
   with its own `deny.toml`, run as a separate `cargo deny` in CI, because
   `[bans]` skips apply to the whole graph and wf-core must stay strict. Every
   skip gets a reason (carried from phase 0). The window loads `dist/web`
   through the custom scheme with the Electron CSP, rewritten for the new
   origins. There is no bridge yet, so the app runs in browser mode. Settles
   CORS (see Risks).
3. **2.3** sidecar spike: bundled Node opens PGlite. Measure installer size and
   idle memory first. These decide whether the 510 MB and installer criteria
   can be met, so they come before the port.
4. **2.4** sidecar port: local DB (reset, backups, restore), Job Object, and
   the lock/orphan test with the real sidecar on Windows and Linux CI.
5. **2.5** data migration from the Electron dir, plus the `apps/desktop`
   change that warns on the `migrated` marker (tested: marker present, warning
   shown). That change ships in the last Electron release, before or with the
   first Tauri release.
6. **2.6** `wf-store::vault`: root confinement and file ops, tests ported first
   from `vault-folder.test.ts`.
7. **2.7** vault commands, watch events, and the shim for them.
8. **2.8** secrets (`keyring`) and preferences.
   - **2.8b** local API and MCP in the sidecar, with the MCP config rewrite.
     Moved here from 2.4: the API serves the vault (2.6/2.7), keeps its tokens
     in the secret store and its switch in preferences (2.8), and asks the
     window to rank (the `semanticRank` round trip). Before those exist it
     could only run against stubs.
9. **2.9** relays in the custom scheme (pdf, html, s2, arxiv, blob, account,
   overleaf), plus the `fetchTitle` and `fetchImage` commands.
10. **2.10** git sync with gix (commit, log, remote sync), then Overleaf read
    and sync.
11. **2.11** embeddings on `ort`.
12. **2.12** the rest: TeX, Zotero, Mattermost, updates, app log, menu, title
    bar, plan widget, ink.
13. **2.13** inject the shim into the window and bundle the sidecar's files
    (node, `main.mjs`, the PGlite runtime, migrations) as resources. Both wait
    until here: an injected shim switches the UI to desktop mode, which needs
    the whole bridge, and the bundle is first built for the installer
    measurement. Then e2e on WebView2 (Windows) and WebKitGTK (Linux CI). Mac WebKit
    needs a Mac and is recorded as blocked. Then `baseline.mjs`, installer
    size, and the 1,039-passage embedding time.

## Lanes (plan §5.1)

A step starts once the steps it needs are merged. Shared files (plan §5.1) are not listed; the orchestrator edits them.

| Step | Needs | Owns |
|---|---|---|
| 2.6 vault | none | creates the `crates/wf-store` crate; `crates/wf-core/src/workspace.rs`, `crates/wf-store/src/{root,vault}.rs`, `crates/wf-store/tests/{root,vault}.rs` |
| 2.7 vault commands, watch | 2.6 | new `apps/shell/src/vault.rs`, `apps/shell/tests/vault.rs`, `apps/shell/bridge/vault.ts` |
| 2.8 secrets, preferences | none | new `apps/shell/src/{secrets,prefs}.rs`, their tests and bridge files |
| 2.8b local API, MCP | 2.7, 2.8 | `apps/shell/sidecar/src/api*.ts` and their tests |
| 2.9a `Range` requests | none | new `apps/shell/src/range.rs` and its tests (the scheme handler calls it; routing lines in `protocol.rs` are the orchestrator's) |
| 2.9 relays | 2.9a | new `apps/shell/src/relay/*.rs` and their tests |
| 2.10 git, Overleaf | 2.6 | new `crates/wf-store/src/git/*.rs` and tests, then `apps/shell/src/git.rs` |
| 2.11 embeddings | 2.6, 2.9a | new `crates/wf-store/src/embed.rs` and tests, `apps/shell/src/embed.rs` |
| 2.12 the rest | 2.8 | one PR per area (TeX, Zotero, Mattermost, updates, log, menu, title bar, plan widget, ink), each in its own files |
| 2.13 shim, bundle, e2e | all above | runs alone |

Waves of 3: 2.6, 2.8, 2.9a → 2.7, 2.9, 2.10, 2.11 (three at a time, the fourth starts when one merges) → 2.8b and the 2.12 areas, three at a time → 2.13. A wave whose steps add crates gets the prep PR of plan §5.1 first. Phases 3 and 4 get the same table when they start.

## Done when (plan § Phase 2)

- The desktop tests pass against the Tauri build. Each step ports the tests
  for the channels it moves, first.
- `baseline.mjs`: nav p50 no worse; idle private memory at most 510 MB on
  Windows, sidecar included.
- Installer size measured.
- 1,039 passages embedded in under a minute.

## 2.3 spike results

Measured on Windows ARM64 with Node 24.14.1, using `node apps/shell/sidecar/scripts/measure.mjs <out-dir>`.
The script bundles the sidecar with esbuild (PGlite external), spawns it, runs one query, and
leaves it idle for 10 s. Private memory comes from `Get-Process`, as in `baseline.mjs`. These are
**ARM64 numbers only**. The shipping x64 `node.exe` is a different size, so 2.13 measures again on x64.
Brotli q9 per file is a proxy. The installer uses LZMA (NSIS/WiX).

| What | Raw | Brotli q9 (installer proxy) |
| --- | --- | --- |
| `node.exe` | 76.8 MB | 23.3 MB |
| PGlite runtime (`dist/` without source maps or other extensions) | 20.1 MB | 6.2 MB |
| Sidecar bundle `main.mjs` | 0.02 MB | 0.01 MB |
| Migrations | 0.4 MB | 0.1 MB |
| **Total** | **97.3 MB** | **29.6 MB** |

- **Memory.** Idle private is 266 MB (working set 184 MB). First query, which runs all
  migrations on a new data dir, takes 3.2 s. That leaves about 244 MB for the shell and
  WebView2 under the 510 MB criterion. It is tight, so 2.13 measures the whole app,
  and phase 3 removes this process.
- **Installer.** It adds about 30 MB compressed and 97 MB installed. Only the files above
  ship. PGlite's other extensions and source maps are left out.
- **Wire values.** `bytea` (Uint8Array) and any bigint do not fit in JSON. Under the desktop parsers,
  `int8` arrives as a number, the same as in Electron. The wire tags them as
  `{"$bigint":"<decimal>"}` and `{"$bytes":"<base64>"}`, in both directions, and the 2.4 shim decodes
  them. A jsonb value that has exactly one of those shapes would be decoded too. That is accepted,
  and no current table stores one.
- **Left for 2.4.** These are not in the spike:
  - the Rust spawn and Job Object;
  - a cap on in-flight calls, and waiting for stdout `drain` (the Rust client bounds what it sends);
  - `MAX_LINE` stops parsing, not buffering: readline holds the whole line first, so the Rust client must cap request size;
  - reset (`discard` throws);
  - periodic and quit-time backups (`LocalDbHost.snapshot` / `dumpTo` are never called);
  - the local API and MCP (moved to 2.8b).

## Risks

- **Origin and CORS.** The UI, its CSP and the sign-in callback assume
  `app://weaveforge`. A custom scheme on Windows is served as
  `http://<scheme>.localhost`, and on Mac/Linux as `<scheme>://localhost`.
  api.weaveforge.org checks `Origin`, and Tauri has no hook like Electron's
  `webRequest` to rewrite it. `isApiHost` in `apps/desktop/src/api-cors.ts`
  covers every `*.weaveforge.org` host, not only `api`, and includes the
  realtime WebSocket (`realtimeUrl` in `apps/web/src/backend/config.ts`). A
  custom scheme cannot proxy a WebSocket upgrade. Browsers apply no CORS to
  WebSockets, so 2.2 checks whether realtime checks `Origin` on upgrade. 2.2
  lists each host and picks one of two options for HTTP:
  - API calls go through the custom scheme, so the shell sends them with no
    browser `Origin`. No server change. The desktop build points the base
    URLs at the scheme through build-time env, not a UI code change.
  - The server allow-list gains the Tauri origins. That is a production write,
    so it waits for the user.

  The first is the default.

  **Settled in 2.2** (read-only probes, no server change):

  | Request | Origin | Result |
  | --- | --- | --- |
  | API preflight | `https://app.localhost` (Windows) | 403 |
  | API preflight | `app://localhost` (Linux, Mac) | 403 |
  | API preflight | `app://weaveforge` (Electron) | 204 |
  | Realtime handshake (`apikey`, `vsn=1.0.0`) | each of the above, `https://evil.example`, or none | 101 for all |

  The API allow-list lives in `infra/oci/Caddyfile`. Realtime accepts the
  handshake from any `Origin`, a foreign one included, so it does not check it
  and works from the Tauri window as is. HTTP API calls take the default
  option: 2.9 routes them through the custom scheme. Adding the two Tauri
  origins to the Caddy allow-list would also work, but it is a production write
  and waits for the user.
- **Custom scheme gaps.** The scheme answers only the hosts `localhost` and
  `app.localhost`. Windows maps every host to `app.localhost`, so models and
  artifacts will be same-origin paths, not `app://models` and `app://artifacts`.
  It reads whole files and has no `Range` support. That is fine for the web
  bundle, but 2.9 (PDF relays) and 2.11 (models) need `Range`.
- **Dependencies.** Tauri brings many duplicate crate versions. They are kept
  out of the root workspace (2.2).
- **Memory while building.** This machine has about 4 GB free. Shell builds
  run with `-j 4`.
