# Sync core module

The `sync` module holds the rules that keep a workspace consistent across
devices and folders: which side wins a conflict, what changed since the last
agreed state, how a remote snapshot becomes a delta, which git push result to
report, and how ink and folder files are split and named. The rules are pure.
The app does the reads, writes, network calls and git commands, and passes the
results in.

## What lives in Rust

- `conflict_route.rs`: picks the route for an outbox operation that the server
  refused as stale, from the server's answer.
- `conflict_settle.rs`: decides how an open conflict settles when the server's
  row arrives.
- `conflict_resolve.rs`: the row or action that a reader's choice produces.
- `folder_merge.rs`: settles a file that both sides changed, and counts the
  import preview.
- `folder_mirror.rs`: the mirror manifest. `jsonEditSince` tells whether a JSON
  file was edited since the manifest recorded it. `unstampForCompare` blanks a
  README or manifest's export time, so two copies that differ only in it compare
  equal (the mirror's unchanged check).
- `folder_layout.rs`: folder names and paths. `folderTitleFromPath` gives a note
  title from a file path, and `pickProjectFolder` chooses a project folder. The
  TypeScript folder names in `packages/core/src/workspace/folder-layout.ts` stay
  in `packages/core`: that package has no wasm dependency, and the names are read
  when the workspace is loaded.
- `preview_folder.rs`: `readsFolder` decides which top-level folders a folder import preview reads (git, the project's own folder, the shared assets, and the legacy flat-folder rule).
- `snapshot_delta.rs`: `planDelta` compares a remote snapshot with the held
  state, and `applyDelta` applies the plan.
- `change_origin.rs`: `digestText`, the hash used to detect changes.
- `git_gate.rs`: `decideVaultCommit` decides whether a vault commit should run.
- `git_remote.rs`: checks a remote URL, redacts secrets from messages, and
  describes a push result (`describePush`).
- `gitlab_log_file.rs`: `gitlabLogFilePlan` plans a log entry's GitLab writes:
  the file URL, the `logbook/` path, the markdown body, the branch fallback and
  the commit messages. The PUT, POST fallback and DELETE stay in
  `apps/web/src/features/sync/infrastructure/gitlab-log-exporter.ts`.
- `integration_store.rs`: `branchRead` and `branchSave` give the branch an
  integration reads back from its row and the value it writes. Mattermost keeps
  a blank channel blank; git falls back to `main`. The row reads and the upsert
  stay in `apps/web/src/backend/providers/postgrest/wire-postgrest-backend.ts`.
- `git_api.rs`: `gitReadPlan` gives the provider request URL, or the
  not-connected message. `githubCommits`, `gitlabCommits` and
  `gitReadFailureMessage` normalise commits and failure text. The fetch and the
  auth headers stay in `apps/web/src/features/sync/infrastructure/git-client.ts`.
- `mattermost_post.rs`: `mattermostPostPlan` picks the channel and checks the
  server origin. `mattermostPostResponsePlan` flags a signed-out response.
  `mattermostTestPosts` groups test posts by channel. The fetch, the desktop
  bridge and the signed-out event stay in
  `apps/web/src/features/sync/infrastructure/mattermost-notifier.ts`.
- `ink_note.rs`: `splitInkTextLayer` splits an ink note body into text layers.
- `stamp_workspace_id.rs`: `stampWorkspaceId` writes the `weaveforge-id` line
  into a hand-written file's frontmatter.
- `pglite_sql.rs`: SQL-text helpers for the local PGlite backend.
- `workspace_snapshot.rs`: the snapshot types and counts that the serializer
  reads.
- `sync_phase.rs`: `initialPhase`, `afterCycle`, `afterFailure` and `isCaughtUp`
  decide the sync-loop phase (idle, offline, error) after each cycle. The timers
  and the store stay in `apps/web/src/features/offline-sync/ui/sync-loop.tsx`.
- `conflict_attention.rs`: `countOpen` counts the conflicts that need a person,
  and `keepAllPicks` builds the picks for "keep all mine or theirs".
- `adoption_plan.rs`: `planRenames` picks which local project collides with a
  name the account already holds, and the name it takes. The `update` statements
  stay in `apps/web/src/features/offline-sync/domain/adoption.ts`. The caller
  passes local projects in `order by name`, which the plan relies on.
- `send_verdict.rs`: `classifySend` turns a PostgREST status, error code and row
  count into one verdict (awaiting parent, conflict, offline, RLS refused, refused,
  guard missed, accepted). `isLinkInsert` marks link-table inserts, and
  `missingIds` lists the ids a chunk expected but the server did not return.
  The transport stays in `postgrest-transport.ts`.
- `pump_route.rs`: `pumpRoute` picks the pump's step for one send outcome: stop
  (offline), settle, conflict, wait (refused, parent unsent) or fail, and whether
  the version is acked and the row stalled. The outbox writes, the conflict store
  calls and the skip loop stay in `domain/pump.ts`.
- `push_plan.rs` (cycle and puller gates): `shouldPullAfterPush` skips the pull
  after an offline push, `shouldFetchNextPage` bounds the page loop, and
  `tableGroups` groups refused pulls by table (first-seen order, singletons
  dropped). The SQL batch and the held-row deletes stay in `domain/puller.ts`.
- `panel_labels.rs`: `deviceLabel` names this machine from its platform for the
  adoption suffix (ASCII lowercase).

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`sync_folder_merge.rs` and
others). The TypeScript wrappers in `packages/wf-wasm/src` import the raw names
from `../pkg/wf_wasm.js` and re-export them. The main names are `digestText`,
`planDelta`, `applyDelta`, `stampWorkspaceId`, `decideVaultCommit`,
`describePush`, `redactSecret`, `splitInkTextLayer`, `jsonEditSince`,
`folderTitleFromPath`, `pickProjectFolder` and `unstampForCompare`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`. For example,
`apps/web/src/features/workspace/application/mirror-manifest.ts` calls
`readyCore().jsonEditSince`, `folder-import-apply.ts` calls
`readyCore().folderTitleFromPath`, and `remove-project-folder.ts` calls
`typedCore().pickProjectFolder`. `ink-host.tsx` calls
`typedCore().splitInkTextLayer`.

## What stays in TypeScript, and why

- **The outbox and conflict store.** The outbox writes and the conflict store
  calls stay in `apps/web/src/features/offline-sync`. Rust picks the route; the
  app carries it out.
- **The merge itself and file I/O.** `folder_merge.rs` decides the merge. The
  file reads and writes stay in `apps/web/src/features/workspace/application/folder-merge.ts`.
- **Git and network.** Running git and sending the push stay in TypeScript.
  Rust only checks the URL and describes the result.
- **The PGlite runtime.** `pglite_sql.rs` builds SQL text. The value encoding and
  the PGlite client stay in `apps/web/src/backend/providers/local/pglite-client.ts`.
- **Store reads.** `collectWorkspaceSnapshot` reads the stores and is not
  ported. Rust keeps only the fields the serializer reads.

## Sidecar git and argument rules

These rules moved from `apps/shell/sidecar/src` into Rust. The sidecar still
spawns git and reads the file system.

- `sync::git_auth` (`gitBasicAuth`, `gitRemoteAuth`) builds the Basic header and
  the `GIT_CONFIG_*` plan. The token goes only in the env plan, never on the
  command line or in `.git/config`. An empty token means no header, and a
  non-http URL gets no header.
- `sync::vault_git_parse` (`gitParseStatus`, `gitParseLog`, `gitOverwrittenFiles`,
  `gitNulList`, `gitPathChunks`) parses git's text output. Renames skip the
  second record. Path chunks count UTF-16 units, as JavaScript does.
- `sidecar_args` (`parseSidecarArgs`) walks the sidecar's argv and returns the
  raw paths or the error message. `main.ts` resolves the paths with
  `path.resolve`. The wasm loads before argv is parsed.

Stays in TypeScript, and why:

- **Running git.** `vault-git.ts` spawns git, and the env merge with
  `process.env` is I/O.
- **Timers, lock files and the pid.** Lifecycle timers, the DB lock and the
  pid are process state.
- **The mirror writes.** `vault-handlers.ts` reads and writes the vault folder.
- **Bridge transport.** `bridge.ts` `decodeWire`/`unwrap` build JS-realm values
  and throw JS errors, and `desktop.ts` validators run in the webview before
  its wasm is confirmed loaded. Both are left for a follow-up.

## Related

- [Workspace core](workspace.md)
- [Search core](search.md)
- [Storage core](storage.md)

Source: `crates/wf-core/src/sync/`
