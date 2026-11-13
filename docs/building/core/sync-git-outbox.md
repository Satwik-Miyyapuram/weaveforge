# Sync: git, outbox and wire helpers

These modules hold the pure parts of git sync, the Mattermost messages, the outbox and the PostgREST wire. They live in `crates/wf-core/src/sync/`; wasm exports in `crates/wf-wasm/src/`; TS keeps the I/O (git spawn, SQL, HTTP).

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `git_auth` | `basic_auth`, `remote_auth` | `gitBasicAuth`, `gitRemoteAuth` | — |
| `git_policy` | `is_under_ignored_folder`, `decide_git_sync_path`, `describe_changes` | `isUnderIgnoredFolder`, `decideGitSyncPath`, `describeChanges` | `apps/web/src/features/workspace/infrastructure/parts.ts`, `apps/web/src/features/workspace/application/workspace-folder.ts` |
| `git_reason` | `git_reason` | `gitReason` | — |
| `vault_git_parse` | `parse_status`, `parse_log`, `overwritten_files`, `nul_list`, `path_chunks` | `gitParseStatus`, `gitParseLog`, `gitOverwrittenFiles`, `gitNulList`, `gitPathChunks` | — |
| `repo_web_url` | `repo_web_url`, `commit_url` | `repoWebUrl`, `commitUrl` | `apps/web/src/features/experiments/ui/experiment-panels.tsx`, `apps/web/src/features/experiments/ui/experiment-detail-screen.tsx` |
| `sync_dot` | `sync_dot` | `syncDot` | `apps/web/src/features/offline-sync/domain/parts.ts` |
| `mattermost_messages` | `milestone_message`, `citation_alert_message`, `log_entry_message` | `milestoneMessage`, `citationAlertMessage`, `logEntryMessage` | `apps/web/src/integrations/manifests/mattermost.ts` |
| `mattermost_options` | `mattermost_events`, `mattermost_options`, `mattermost_channel_for` | `mattermostEvents`, `mattermostOptions`, `mattermostChannelFor` | `apps/web/src/features/sync/ui/sync-settings.tsx`, `apps/web/src/integrations/manifests/mattermost.ts` |
| `outbox_rows` | `outbox_entry`, `outbox_entries` | `outboxEntries` | `apps/web/src/features/offline-sync/domain/parts-2.ts` |
| `outbox_sides` | `edit_sides`, `deleted_remote_sides`, `deleted_local_base` | `editSides`, `deletedRemoteSides`, `deletedLocalBase` | `apps/web/src/features/offline-sync/domain/parts-1.ts` |
| `postgrest_wire` | `writable`, `error_info` | `postgrestWritable`, `postgrestErrorInfo` | — |
| `sql_ident` | `quote_ident` | `quoteIdent` | `apps/web/src/features/offline-sync/domain/parts-1.ts`, `apps/web/src/features/offline-sync/domain/parts-2.ts` |

Rules:

- `git_auth`: `basic_auth` is base64 of `user:token`; an absent username uses `x-access-token`. `remote_auth` always sets `GIT_TERMINAL_PROMPT=0`.
- `git_auth`: the `extraHeader` config and `-c credential.helper=` are added only for a non-empty token on an http(s) origin.
- `git_policy`: skip reasons are `ignored-directory`, `ignored-file`, `too-large` and `invalid-path`. The root `.weaveforge` folder is always ignored; `notes/.weaveforge` is not.
- `git_policy`: a non-finite or negative size is skipped as `too-large`. `describe_changes` gives `No changes` or e.g. `1 added, 2 changed, 1 removed`.
- `git_reason`: `fatal:` and `error:` lines are joined by a space. Otherwise the first line is used, or `Could not commit.` when it is empty.
- `vault_git_parse`: `parse_status` maps codes to `deleted`, `added` or `modified`, and skips the second record after `R` or `C`. `parse_log` splits on U+001F and skips blank or incomplete lines.
- `vault_git_parse`: `path_chunks` counts UTF-16 units against `PATH_CHUNK_MAX_UNITS` (8000); an oversized path gets its own batch.
- `repo_web_url`: only http(s) URLs are kept, trimmed. `commit_url` strips `.git` and a trailing slash, then uses `/-/commit/<sha>` when the host contains `gitlab` and `/commit/<sha>` otherwise. An empty sha gives `None`.
- `sync_dot`: the order is conflicts, then offline (`!is_online` or phase `offline`), then `None` when not enabled, then syncing, then error (`Sync failed`), then synced with a tip that includes `relative_last_sync`.
- `mattermost_messages`: locale-free; the caller formats numbers. The citation list stops at `CITING_LIST_LIMIT` (10) and then reads `…and N more`.
- `mattermost_options`: the event keys are `milestoneAdded`, `milestoneStatus`, `citationAlerts`, `dailyLogs` and `weeklyLogs`. Events are off unless the value is literal `true`.
- `mattermost_options`: `sameChannel` defaults to true unless literal `false`. With `sameChannel` false, each event uses its own channel, falling back to the branch channel when blank.
- `outbox_rows`: `JsNumber` reads text the way JS `Number()` does: blank gives 0, `inf` or `nan` gives NaN. `outbox_entries` keeps row order.
- `outbox_sides`: `edit_sides` takes the base from the first non-delete op and the local side from the last. `None` when only deletes are owed.
- `outbox_sides`: `deleted_remote_sides` uses the stored row when given, else the last owed payload. `deleted_local_base` reads the first op of any kind, deletes included.
- `postgrest_wire`: `GENERATED` is `vault_pages: body_preview` and `paper_tags: id`. `writable` strips those columns for their own table only.
- `postgrest_wire`: `error_info` reads JSON `code` and `message`. Without a JSON `message` it keeps the raw body, truncated to 200 UTF-16 units.
- `sql_ident`: `quote_ident` wraps the name in double quotes and doubles any embedded quote.
