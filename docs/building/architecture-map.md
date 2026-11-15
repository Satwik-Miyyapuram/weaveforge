# How WeaveForge is put together

A map of the whole thing: where the code lives, what each surface can do, and
which of those things still work with the network unplugged.

It is written for somebody deciding where a change belongs, and for anybody who
wants to know what runs on their machine and what does not.

## The shape of it

One codebase, four surfaces, one schema.

- **`crates/wf-core`** — the rules. Pure Rust with no I/O in it: citation keys,
  LaTeX section trees, the paste pipeline, the search ranking. Everything else
  depends on this, and it depends on nothing. See [The Rust core](#the-rust-core).
- **`packages/core`** — the TypeScript that remains: shared contracts and glue
  that call into the Rust core. The domain rules themselves are in `crates/wf-core`.
- **`apps/web`** — the app. Screens, features, API routes, and the wiring that
  chooses which backend is behind them. The browser runs this; so does the
  desktop window, unchanged. Rust logic reaches it through the WASM build,
  registered in `apps/web/src/lib/rust-core.ts`.
- **`apps/shell`** — the shell. Only what a window can do and a tab cannot:
  the keychain, a folder on your disk, a local database, a loopback API, the
  menu, updates. It links `wf-core` for the rules and `wf-store` for the native I/O.
- **`apps/pitch`** — the public site, including this page.
- **`python/weaveforge`** — the SDK training scripts import.
- **`db/migrations`** — the schema, applied in the same order to a hosted
  database and to the one in your app's folder. There is no second schema.

## What runs where

Three ways to run it, and they are not three versions. The same feature code
sits above every one of them; what changes underneath is the database client,
the identity, the auth service and the blob store — four things, swapped at
startup.

| | In a browser | Desktop, signed in | Desktop, no account |
| --- | --- | --- | --- |
| Where data lives | Hosted Postgres | Hosted Postgres | Native Postgres, run by the shell, in the app's folder |
| Who you are | Your account | Your account | One local user |
| Attachments | Object storage | Object storage | Files on disk, each with a row that points at it |
| Integration tokens | Sealed with a server key | Sealed with a server key | This computer's keychain |
| Needs a network | Yes | Yes | No |

## Offline, precisely

"Works offline" is a claim worth being exact about. A copy with no account makes
no outbound request at boot, and these work with the network unplugged:

| Feature | Offline | How |
| --- | --- | --- |
| Projects, notes, papers, lists, reports | Yes | Ordinary rows in the local database |
| The editor, including typing in a document | Yes | The CRDT log is still written; the sync channel is not opened, because there is nobody to reach |
| The workspace folder mirror | Yes | The shell reads and writes the folder directly |
| The workspace editor — panes, explorer, quick open | Yes | Pane layout, tree and fuzzy match are client logic; the documents are rows in the local database |
| Experiments, and training scripts logging into them | Yes | The loopback API answers the SDK's own routes |
| The MCP server | Yes | Same database, same rows |
| Reading a PDF — outline, citation links, figure links | Yes | Parsed from the text layer on the client; the reference list and in-text mentions are found by core's parsers |
| The citation popover's record — title, venue, DOI | No | Looked up on arXiv, Crossref, Semantic Scholar and OpenAlex, then cached for thirty days keyed by the text's fingerprint |
| Linking and editing an Overleaf report | Yes | The token sits in the keychain; the row is an ordinary row |
| Opening an Overleaf report's contents | No | It is a clone from overleaf.com — offline means no server of ours, not no Overleaf |
| Attachments logged from a training script | Yes, up to 25 MB | The loopback API saves them to the app's local artifacts folder |
| Sharing, supervision, anything with a second person | No | Account features |

### Why the editor needed a fix rather than a flag

The editor opens a realtime channel to carry other people's keystrokes. That
channel is built from configuration compiled into the app, not from whichever
database the app is talking to — so a copy with no account opened it anyway,
failed on every keystroke, and put a "live sync unavailable" notice under a
document nobody else can open. Now the provider takes a `live` flag: solo means
no transport, not no history. The document is still recorded; nothing is sent.

### Why Overleaf needed a keychain

Linking an Overleaf report does three jobs, and only one of them needs a server.
The rows are ordinary rows. The LaTeX parse is a pure function in `wf-core`. Only
holding the token needs somewhere safe — and on a server that is a key the
browser never sees. The equivalent this machine has is its own keychain, so the
token is kept there, the clone happens in the shell, and the page never holds
the credential either way. The clone code is not duplicated: the shell's
Overleaf workshop imports the same `wf-core` reader the app uses.

## How big it is

Counted from the files git is tracking, not remembered — run `npm run docs:generate` to refresh it.

<!-- generated:code-map -->

<!-- Generated by scripts/update-docs.mjs — run `npm run docs:generate`. -->

| Where | Size | What lives there |
| --- | --- | --- |
| `crates/wf-core` | 178,754 lines | The rules, in Rust: pure logic with no I/O, shared by every shell |
| `crates/wf-store` | 5,468 lines | Native I/O in Rust: the workspace folder, blobs, git and models |
| `crates/wf-wasm` | 27,356 lines | wf-core for JavaScript, via wasm-bindgen |
| `crates/wf-bindings` | 1,110 lines | Writes the TypeScript types for every Rust type the UI sees |
| `packages/core` | 24,619 lines | Residual TypeScript: shared contracts and glue that call the Rust core |
| `packages/wf-wasm` | 4,245 lines | TypeScript wrappers and generated types over the WASM module |
| `apps/web` | 218,148 lines | The app itself: screens, features, API routes, backend wiring |
| `apps/shell` | 47,325 lines | The Tauri shell — what only an installed app can do |
| `apps/relay` | 27,140 lines | Relays and pasted-link fetches, in Rust: the wf-relay library and its OCI server |
| `apps/pitch` | 919 lines | The public site and this documentation |
| `python/weaveforge` | 3,375 lines | The SDK training scripts import |
| `python/tests` | 2,277 lines | Its tests |
| `db/migrations` | 155 files | The schema, as an ordered sequence |
| `docs` | 185 files | Documentation, this page included |

**540,736 lines of code in all**, across 3,259 source files.

<!-- /generated:code-map -->

## The IPC surface

Everything the desktop shell can do that a tab cannot goes through one of these,
a Rust command in `apps/shell/src`, typed once in the generated
`apps/shell/bridge/bindings.ts` and wrapped by
`apps/web/src/lib/desktop/desktop-bridge.ts`. Two are pushed the other way — main to renderer — because
they are events nobody asked for: a sign-in finishing, and somebody else
changing the folder.

<!-- generated:desktop-ipc -->

<!-- Generated by scripts/update-docs.mjs — run `npm run docs:generate`. -->

64 typed commands:

- `db_query` — `dbQuery`
- `db_state` — `dbState`
- `db_reset` — `dbReset`
- `local_api_call` — `localApiCall`
- `local_file_read` — `localFileRead`
- `local_file_write` — `localFileWrite`
- `local_file_remove` — `localFileRemove`
- `preference_write` — `preferenceWrite`
- `secret_read` — `secretRead`
- `secret_write` — `secretWrite`
- `secret_clear` — `secretClear`
- `vault_root` — `vaultRoot`
- `vault_choose` — `vaultChoose`
- `vault_missing` — `vaultMissing`
- `vault_retry` — `vaultRetry`
- `vault_forget` — `vaultForget`
- `vault_read` — `vaultRead`
- `vault_write` — `vaultWrite`
- `vault_write_if` — `vaultWriteIf`
- `vault_read_bytes` — `vaultReadBytes`
- `vault_write_bytes` — `vaultWriteBytes`
- `vault_list` — `vaultList`
- `vault_stat` — `vaultStat`
- `vault_remove` — `vaultRemove`
- `vault_sync` — `vaultSync`
- `vault_commit` — `vaultCommit`
- `vault_log` — `vaultLog`
- `vault_file_log` — `vaultFileLog`
- `vault_read_at` — `vaultReadAt`
- `fetch_title` — `fetchTitle`
- `fetch_image` — `fetchImage`
- `zotero_local` — `zoteroLocal`
- `update_check` — `updateCheck`
- `sign_in_listening` — `signInListening`
- `app_log_report` — `appLogReport`
- `app_log_read` — `appLogRead`
- `app_log_reveal` — `appLogReveal`
- `app_storage_usage` — `appStorageUsage`
- `app_storage_clear` — `appStorageClear`
- `local_artifacts_delete` — `localArtifactsDelete`
- `overleaf_read` — `overleafRead`
- `overleaf_sync` — `overleafSync`
- `mattermost_sign_in` — `mattermostSignIn`
- `overleaf_sign_in` — `overleafSignIn`
- `mattermost_post` — `mattermostPost`
- `ink_available` — `inkAvailable`
- `ink_recognise` — `inkRecognise`
- `ink_haptics_available` — `inkHapticsAvailable`
- `ink_haptics` — `inkHaptics`
- `embed_load` — `embedLoad`
- `embed_texts` — `embedTexts`
- `embed_unload` — `embedUnload`
- `model_downloads` — `modelDownloads`
- `cancel_model_downloads` — `cancelModelDownloads`
- `menu_model` — `menuModel`
- `menu_invoke` — `menuInvoke`
- `title_bar_colors` — `titleBarColors`
- `window_focus` — `windowFocus`
- `plan_widget_state` — `planWidgetState`
- `plan_widget_set` — `planWidgetSet`
- `plan_widget_theme` — `planWidgetTheme`
- `plan_widget_palette` — `planWidgetPalette`
- `plan_widget_data` — `planWidgetData`
- `plan_widget_open` — `planWidgetOpen`

<!-- /generated:desktop-ipc -->

The number is deliberately visible. A codebase this size is a cost, and a figure
that only ever goes up is a figure somebody should be arguing with.

## The Rust core

The rules and the native I/O moved to Rust. Each crate has one job, and the
dependency only points one way: the others depend on `wf-core`, not the reverse.

| Crate | What it does |
| --- | --- |
| `crates/wf-core` | Pure logic shared by every shell, with no I/O. Also built to WASM. |
| `crates/wf-store` | Native I/O: the workspace folder, blobs, git and models. Never built for WASM. |
| `crates/wf-wasm` | `wf-core` for JavaScript, through `wasm-bindgen`. Built by `scripts/build-wasm.mjs`. |
| `crates/wf-bindings` | Writes the TypeScript types for every Rust type that crosses into the UI. |

The shell's `apps/shell/src/local_pg` runs the native Postgres that the desktop
app uses when there is no account.

## Where to put a change

- A rule that would be true in any client — **`crates/wf-core`**.
- A screen, or a rule about how one behaves — **`apps/web/src/features`**.
- Something only an installed window can do — **`apps/shell/src`**, exposed
  as Tauri commands (registered in `commands.rs` or a `cmd_*.rs` module) and typed
  once in `apps/shell/bridge/bindings.ts`.
- A column — a new migration in **`db/migrations`**. Never an edit to an
  old one; they have already run on other people's machines.

## Related

- [The atlas](../atlas.html) — the same map drawn out, one page, every figure
  read off this commit by `scripts/build-atlas.mjs`
- [The desktop app](../using/desktop.md) — including working without an account
- [The workspace folder](../using/workspace-folder.md)
- [Collaborative editing](../using/collaborative-editing.md)
- [Integrations](../using/integrations.md)
- [Design principles](design.md)
- [Core modules](core/README.md)
