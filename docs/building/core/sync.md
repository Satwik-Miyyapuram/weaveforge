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
  TypeScript folder names in `packages/core/src/workspace/parts-1.ts` stay
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
  `apps/web/src/features/sync/infrastructure/parts.ts`.
- `integration_store.rs`: `branchRead` and `branchSave` give the branch an
  integration reads back from its row and the value it writes. Mattermost keeps
  a blank channel blank; git falls back to `main`. The row reads and the upsert
  stay in `apps/web/src/backend/providers/postgrest/wire-postgrest-backend.ts`.
- `git_api.rs`: `gitReadPlan` gives the provider request URL, or the
  not-connected message. `githubCommits`, `gitlabCommits` and
  `gitReadFailureMessage` normalise commits and failure text. The fetch and the
  auth headers stay in `apps/web/src/features/sync/infrastructure/parts.ts`.
- `mattermost_post.rs`: `mattermostPostPlan` picks the channel and checks the
  server origin. `mattermostPostResponsePlan` flags a signed-out response.
  `mattermostTestPosts` groups test posts by channel. The fetch, the desktop
  bridge and the signed-out event stay in
  `apps/web/src/features/sync/infrastructure/parts.ts`.
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
  stay in `apps/web/src/features/offline-sync/domain/parts-1.ts`. The caller
  passes local projects in `order by name`, which the plan relies on.
- `send_verdict.rs` (Rust only, no wasm export): `classify_send` turns a PostgREST status, error code and row
  count into one verdict (awaiting parent, conflict, offline, RLS refused, refused,
  guard missed, accepted). `is_link_insert` marks link-table inserts, and
  `absent_ids` lists the ids a chunk expected but the server did not return.
  `missing_ids` filters those by tombstones. `send_steps.rs` calls these.
- `send_steps.rs`: the send step machine. `sendStart` and `sendAdvance` return
  `{ next: "read", ... }` for each GET the transport must make, or the final
  `SendOutcome`. `missingIdChunks` plans the chunks (100 ids each), and
  `missingAfterPresence` / `missingAfterTombstones` decide the missing ids.
  `changesFromReply` maps the feed reply. TS runs the fetches and loops.
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
`apps/web/src/features/workspace/application/parts-3.ts` calls
`readyCore().jsonEditSince`, `folder-import-apply.ts` calls
`readyCore().folderTitleFromPath`, and `remove-project-folder.ts` calls
`typedCore().pickProjectFolder`. `ink-host.tsx` calls
`typedCore().splitInkTextLayer`.

## What stays in TypeScript, and why

- **The outbox and conflict store.** The outbox writes and the conflict store
  calls stay in `apps/web/src/features/offline-sync`. Rust picks the route; the
  app carries it out.
- **The merge itself and file I/O.** `folder_merge.rs` decides the merge. The
  file reads and writes stay in `apps/web/src/features/workspace/application/parts-1.ts`.
- **Git and network.** Running git and sending the push stay in TypeScript.
  Rust only checks the URL and describes the result.
- **The PGlite runtime.** `pglite_sql.rs` builds SQL text. The value encoding and
  the PGlite client stay in `apps/web/src/backend/providers/local/pglite-client.ts`.
- **Store reads.** `collectWorkspaceSnapshot` reads the stores and is not
  ported. Rust keeps only the fields the serializer reads.

## Git rules

These rules moved from the removed Node sidecar into Rust. The shell spawns git
and reads the file system.

- `sync::git_auth` (`gitBasicAuth`, `gitRemoteAuth`) builds the Basic header and
  the `GIT_CONFIG_*` plan. The token goes only in the env plan, never on the
  command line or in `.git/config`. An empty token means no header, and a
  non-http URL gets no header.
- `sync::vault_git_parse` (`gitParseStatus`, `gitParseLog`, `gitOverwrittenFiles`,
  `gitNulList`, `gitPathChunks`) parses git's text output. Renames skip the
  second record. Path chunks count UTF-16 units, as JavaScript does.

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

## More sync modules

These modules sit beside the ones above. Each rule is pure. TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `conflict_deletion` | `deletion_for` | `deletionFor` | `apps/web/src/features/offline-sync/ui/use-sync-issues.ts` |
| `device_session` | `may_drive_device`, `session_action` | `mayDriveDevice`, `sessionAction` | `apps/web/src/features/offline-sync/ui/sync-loop.tsx` |
| `frontmatter` | `read_frontmatter`, `write_frontmatter`, `frontmatter_string`, `frontmatter_list` | `readFrontmatter`, `writeFrontmatter`, `frontmatterString`, `frontmatterList` | `apps/web/src/features/workspace/application/parts-1.ts` (`readFrontmatter`, `writeFrontmatter` only) |
| `import_action` | `ImportAction`, `ConflictKind`, `ActionCounts::add` | native only | — |
| `instant` | `parse_instant`, `format_instant` | native only | — |
| `integration_fields` | `git_connection_ready`, `mattermost_connection_ready`, `DEFAULT_GIT_BRANCH` | `gitConnection`, `mattermostConnection`, `gitConnectionReady`, `mattermostConnectionReady`, `emptyIntegration` | `apps/web/src/features/sync/infrastructure/parts.ts`, `apps/web/src/features/sync/ui/sync-settings.tsx`, `apps/web/src/features/sync/ui/git-screen.tsx` |
| `json_entities` | `json_data_path`, `json_kind_of_path`, `parse_json_data`, `diff_json_data`, `is_app_owned_path` | `jsonDataPath`, `parseJsonData`, `diffJsonData`, `countJsonActions`, `addCounts`, `jsonKindOfPath`, `isAppOwnedPath` | `apps/web/src/features/workspace/application/parts-1.ts` |
| `local_first_route` | `SYNCED_TABLES`, `BOTH_END_RPCS`, `both_ends_merge` | `syncedTables`, `isSyncedTable`, `isBothEndsRpc`, `bothEndsMerge` | `apps/web/src/backend/providers/local/local-first.ts` |
| `markdown_image` | `markdown_image`, `image_alt_from_filename`, `image_extension_for_mime`, `find_image_refs`, `image_paths_in_body`, `normalize_markdown_image_syntax` | `markdownImage`, `imageAltFromFilename`, `imageExtensionForMime`, `findImageRefs`, `imagePathsInBody`, `normalizeMarkdownImageSyntax` | `apps/web/src/lib/editor-image-upload.ts`, `apps/web/src/features/vault/lib/materialize-blob-images.ts`, `apps/web/src/features/logbook/ui/log-image-upload.ts`, `apps/web/src/features/papers/lib/parts.ts` |
| `memory_fs` | `MemoryWorkspaceFs`, `with_clock` | native only | — |
| `merge` | `merge_rows`, `same_value` | `mergeRows`, `sameValue` | `sameValue`: `apps/web/src/features/offline-sync/ui/sync-issues-panel.tsx`. `mergeRows`: — |
| `merge_vault_page` | `merge_vault_page`, `vault_page_base`, `vault_page_side` | `mergeVaultPage`, `vaultPageBase`, `vaultPageSide` | `vaultPageBase`: `apps/web/src/features/workspace/application/parts-1.ts`. `mergeVaultPage`, `vaultPageSide`: — |
| `migrated_notice` | `migrated_notice` | `migratedNotice` | — (the shell, not a wasm caller) |
| `project_pick` | `pick_project` | `pickProject` | — |
| `serialize` | `serialize_workspace`, `WORKSPACE_SCHEMA_VERSION` | `serializeWorkspace` | `apps/web/src/features/workspace/application/parts-1.ts`, `apps/web/src/features/workspace/application/parts-2.ts`, `apps/web/src/features/export/application/export-user-data.ts` |
| `text_diff` | `diff_body`, `merge_hunks`, `write_conflict_markers`, `has_conflict_markers` | `diffBody`, `mergeHunks`, `writeConflictMarkers`, `hasConflictMarkers` | `apps/web/src/features/offline-sync/ui/sync-issues-panel.tsx`, `apps/web/src/features/settings/ui/folder-conflict-card.tsx` |
| `vault_limits` | `too_large_message` | `vaultTooLargeMessage` | — |
| `workspace_fs` | `WorkspaceFs` trait (nine methods), `FsKind`, `WorkspaceStat`, `FsError` | native only | — |

Rules:

- `conflict_deletion`: "Mine" (local) keeps a remote delete and drops a local delete. "Cloud" (remote) is the opposite.
- `device_session`: an empty user id counts as signed out. `session_action` returns `idle`, `adopt`, `drive` or `foreign`.
- `frontmatter`: the fence is `---`, with an optional BOM. Numbers match `^-?\d+(\.\d+)?$`. `write_frontmatter` skips null and empty-list fields.
- `import_action`: `ImportAction` has five variants. `ConflictKind` has three, in kebab-case. `ActionCounts::add` uses `saturating_add`.
- `instant`: a time with no offset is read as UTC.
- `integration_fields`: the default git branch is `main`. Git is ready when enabled, with a non-blank token and repo. Mattermost is ready when enabled, with a non-blank bot token, server URL and channel id.
- `json_entities`: the three JSON files are `relations.json`, `tags.json` and `reading-list-items.json`. `parse_json_data` returns None for non-array content, so a parse error never reads as a deletion. App-owned paths are `.git`, `README.md`, `.weaveforge/{db,db-backups,cache}`, `mirror.json`, `manifest.json` and `papers/{pdf,html}`.
- `local_first_route`: `SYNCED_TABLES` has 18 entries. `BOTH_END_RPCS` is `metric_history` and `latest_metric_activity`. If both ends fail, the result is `ServerError`. `metric_history` gives `PreferLocalRows`. Other RPCs give `ConcatRows`.
- `markdown_image`: `VAULT_IMAGE_PREFIX` is `vault:`. Scanners are hand-written, with no regex crate. The default alt text is `image`. `image_extension_for_mime` falls back to `png`.
- `memory_fs`: a map-backed filesystem for tests and the serializer. Listings sort by byte order. `with_clock` sets the clock.
- `merge`: `RESERVED` columns are `id`, `server_seq`, `row_version` and `created_at`. Missing keys read as null. Conflicts come in order: local keys first, then remote-only keys.
- `merge_vault_page`: the body is compared by digest only, so no base text is kept. A side that alone moved a field or body wins. Fields both sides moved differently become conflicts, and the workspace value stands meanwhile.
- `migrated_notice`: `None` gives `None`. Non-JSON or undated markers give the warning with no " on <date>". The date is the first 10 chars of `at` when `parse_instant` accepts it.
- `project_pick`: exact match on id, name or dir comes first, then partial name. Errors list the project names. `norm` trims, lowercases and folds JS `\s`.
- `serialize`: `WORKSPACE_SCHEMA_VERSION` is `2`, stamped into `manifest.json`.
- `text_diff`: markers are `<<<<<<< this app`, `=======` and `>>>>>>> the folder`. Past `MAX_DIFF_CELLS` (4,000,000) the diff is one hunk holding both copies whole.
- `vault_limits`: the message reads "That file is too large to open here (over N MB)." Size caps stay in TS.
- `workspace_fs`: nine methods, deliberately small. Paths are POSIX and relative. Adapters reject unsafe paths. No symlinks, modes, streams or watching. `modified_ms` is milliseconds since the Unix epoch.
