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
| `node:fs`, the `git` CLI, Electron `safeStorage` | `wf-store` (std fs, git2); secrets in the shell through `keyring-core` and one store crate per platform (`windows-native-keyring-store`, `apple-native-keyring-store`, `dbus-secret-service-keyring-store`), not the `keyring` crate, which is a CLI since v4 |
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

### How 2.8b does it

`registerMainLocalApi` (`apps/desktop/src/main-local-api.ts`) already takes
everything it touches as injected deps, so it runs in the sidecar unchanged.
The sidecar supplies those deps, and the shell answers what only it can.

**The wire goes both ways.** Today the shell asks and the sidecar answers.
2.8b adds two sidecar → shell line kinds on stdout, next to the replies:

- `{"ask":N,"method":"…","params":…}`: the sidecar needs an answer. The shell
  answers on stdin with `{"answer":N,"ok":true,"value":…}` or
  `{"answer":N,"ok":false,"error":"…"}`, with `answer` as the first key. An ask
  times out after 10 s, at most 64 wait at once, and all fail when stdin closes.
- `{"event":"…","params":…}`: a notice; nothing comes back.

The shell side is a `SidecarHost` trait (`event`, and `ask` run on a blocking
thread) passed to `Sidecar::spawn_with_host`. `spawn` keeps working with no
host: its asks are answered `no host` and its events are dropped. An answer
over the request cap is answered `answer too large` instead, so no ask hangs.
The host answers at most `AskLimits::max_open` asks at once (64) and waits
`AskLimits::timeout` (10 s) for each: one more is answered `busy`, a slower
host `host timed out`, and an error too long for the line `error too large`.

**The deps, one by one.**

| `MainLocalApiDeps` | In the sidecar |
|---|---|
| `ipc.handle(channel, fn)` | wire method `ipc:<channel>`; Rust commands (`local_api_state`, `local_api_set`, `local_api_token_create`, `local_api_token_revoke`, `mcp_connect`, `mcp_disconnect`, `mcp_open_client`) call it, and the shim gains the matching members |
| `ipc.on("semanticRanked")` | wire method `ipc:semanticRanked`, called by the `semantic_ranked` command when the page answers |
| `mainWindow().webContents.send("semanticRank")` | event `semanticRank`, which the shell emits to the window; no window means no ranking, as today |
| `preferenceStore()`, `secretStore()` | asks `pref.read`/`pref.write`/`secret.read`/`secret.write`; the shell serves only the `local-api` preference and the `local-api-token` secret and refuses every other name |
| `open.url`, `open.path` | asks `open.url`/`open.path`; the shell opens only `cursor:` and `vscode:` install links and an `.mcpb` file inside the MCP folder, and refuses anything else |
| `vault` | a TS `VaultSession` on the root the shell sends with `vault.root` at start and after every folder pick |
| `execPath`, `version` | the sidecar's own `node` and the shell's version, sent at start |

Files the API writes reach the page through the Rust watcher, like any other
outside edit.

**MCP configs.** `mcpLaunch` now names the sidecar's `node` and the bridge
script, without `ELECTRON_RUN_AS_NODE`. On first run, an entry in
`~/.weaveforge/mcp.json` or a client config that still names the old Electron
exe is rewritten to the new launch. Other entries are left alone.

**Split.** 2.8b-1 the two-way wire (`wire.ts`, `sidecar.rs`, tests on both
sides). 2.8b-2 the sidecar deps and `registerMainLocalApi` in `main.ts`.
2.8b-3 the Rust host, the commands, rank forwarding and the shim members.
2.8b-4 the MCP config rewrite.

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

### How 2.5 does it

- The sidecar runs the copy (`apps/shell/sidecar/src/migrate.ts`) before it
  opens the database, when the shell passes `--migrate-from <Electron dir>`.
  The shell passes it only for the bundled sidecar (`electron_data_dir`), so a
  dev run never touches the installed app's data. Electron's dir is Tauri's
  `config_dir()/WeaveForge` on every OS.
- Copied: `local-db`, `local-db-backups`, `preferences.json`, `models`,
  `artifacts`, `weaveforge.log`, `overleaf-git`. Each item is copied into
  `<new>/.migrating`, and only once every copy succeeded is each one renamed
  into place. `<old>/migrated` is written before the first rename, so from then
  on Electron warns. A rerun copies every item again: one already in `<new>`
  (from a crashed run, or written by the new app first) is moved aside to
  `<new>/.pre-migration/<time>/`, never deleted, because Electron may have
  changed its copy since. Only the rename step (milliseconds) can leave items
  for an aside; a quit during the copy only leaves `.migrating`, which the
  next run clears. Nothing cleans `.pre-migration`: each crash inside the rename
  step adds one more copy, and the user may delete the folder once the new app
  shows their data. `--migrate-from` must not be or contain the new dir.
- Locks: Electron's `local-db`, and the workspace database
  (`<vault-root>/.weaveforge/db`) when Electron's preferences name a folder.
  If either is held by a live process, the sidecar exits with code 3 and asks
  the user to close the old app and restart; the shell puts that last stderr
  line in `db_state().failure`, so the user sees it. The next start tries
  again. A stale lock is taken over as Electron does. Both markers are written
  while the locks are still held.
- Gap: the lock only proves Electron has its database open. Electron takes it
  in `LocalDbHost` open, after `ensureDatabaseLocation`, so an Electron whose
  database is not open yet (or failed to open) is not detected, and a move it
  runs then could race the copy. Accepted: both apps are rarely started
  together. If it bites, add a liveness check on Electron's single-instance
  lock.
- Markers: `<old>/migrated` (`{to, at}`) for the Electron warning, then
  `<new>/migrated-from-electron` (`{from, at, copied, secretsLeftBehind}`),
  written last and atomically; while it exists the copy never runs again. A
  failed copy stops the sidecar (exit 1) instead of opening an empty
  database, which would hide the user's data on every later start.
- Electron (`apps/desktop/src/migrated-notice.ts`) shows a warning dialog on
  start when the marker is there.
- Not copied: the workspace database. It stays in the folder; **2.7** must
  pass the workspace root to the sidecar and open the database there as
  Electron does (`databaseDirFor`, `relocateDatabaseOnce`, workspace backups
  under `.weaveforge`). The home-config fallback for the folder
  (`readHomeConfig`) is not read during the copy; 2.7 handles it with the rest.
- **2.8** reads preferences only after the sidecar has started (the copy has
  run), and uses `secretsLeftBehind` to tell the user which tokens to re-enter.
- The copy is TypeScript in the sidecar; phase 3 ports it to Rust with the
  rest of the sidecar.
- A large copy delays the first reply on the first start. The 60 s call
  timeout does not kill the sidecar: early calls fail as transient and are
  retried. Real risks: quitting mid-copy kills the sidecar after the 15 s
  grace, and the next start copies everything again (staging is cleared); the
  copy doubles disk use for backups and models, and a full disk fails it
  (exit 1) on every start until space is freed. No free-space check yet.
- A sidecar that exited (exit 3 or 1) is not respawned until the app restarts;
  a retry from the reset screen belongs to the respawn follow-up.

### Web storage left behind (2.5 inventory)

Every `localStorage`, `sessionStorage` and IndexedDB use in `apps/web/src` was
classified. None holds data the user cannot get back:

- About 45 preferences (theme, layout, explorer state, filters, reader and ink
  tool settings, last project, recent searches). Defaults rebuild them.
- About 10 caches (screen cache, search index, embeddings, PDF text and bytes,
  reference lookups, startup snapshot, graph state also kept in the
  database). Each is rebuilt from the database or the network; embeddings
  cost a re-index.
- 3 secrets, all session-scoped (the wrapped MCP session, the Overleaf
  workshop session id; the BYOK key is never in web storage). The user signs
  in again.
- One caveat: paper HTML saved by "free copy" without a workspace folder lives
  only in IndexedDB (`weaveforge-paper-html`). It can be fetched again from
  its URL unless the page is gone. With a folder it is a file under
  `papers/html/`, which stays.
- `wf.tags.deferredReconcile` queues tag-link updates that failed offline;
  losing it means the links catch up on the next save of that note
  (`note-tags.ts`).

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
8. **2.8** secrets (`keyring-core` and the platform stores) and preferences.
   - **2.8b** local API and MCP in the sidecar, with the MCP config rewrite.
     Moved here from 2.4: the API serves the vault (2.6/2.7), keeps its tokens
     in the secret store and its switch in preferences (2.8), and asks the
     window to rank (the `semanticRank` round trip). Before those exist it
     could only run against stubs.
9. **2.9** relays in the custom scheme (pdf, html, s2, arxiv, blob, account,
   overleaf), plus the `fetchTitle` and `fetchImage` commands.
10. **2.10** git sync with git2 (commit, log, remote sync), then Overleaf read
    and sync. git2 (libgit2, vendored), not gix: gix 0.90 cannot yet push over
    https or merge into the worktree, both of which sync needs.
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
| 2.12 the rest | 2.8 (none needs the 2.9 relays: Mattermost signs in through its own window) | one PR per area (TeX, Zotero, Mattermost, updates, log, menu, title bar, plan widget, ink), each in its own files |
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
- **Linux secrets.** The Secret Service store negotiates an encrypted session
  on the session bus (pure-Rust crypto, the `crypto-rust` feature), as
  Electron's `safeStorage` (libsecret) did. Builds need `libdbus-1-dev`; the app links `libdbus-1.so.3`, which
  2.13 declares in the `.deb` and leaves out of the AppImage.
