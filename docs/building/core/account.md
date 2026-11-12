# Account and app config

These modules hold the pure rules for accounts, auth, backend config, home config, update checks and the privacy gate. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `account_links` | `account_links` | `accountLinks` | `apps/web/src/app/header-actions.tsx` |
| `account_menu` | `inbox_links`, `account_attention` | `inboxLinks`, `accountAttention` | `apps/web/src/app/header-actions.tsx` |
| `account_provision` | `create_member_reply`, `citation_alert_failure_log` | `createMemberReply`, `citationAlertFailureLog` | `apps/web/src/container/parts.ts` |
| `account_purge` | `purges_objects`, `STORAGE_LIST_PAGE`, `split_storage_listing`, `storage_listing_has_more`, `purge_failure_message` | `purgesObjects`, `storageListPage`, `splitStorageListing`, `storageListingHasMore`, `purgeFailureMessage` | `apps/web/src/backend/account/purge-user-blobs.ts` |
| `auth_transition` | `next_auth_step` | `nextAuthStep` | `apps/web/src/features/auth/domain/parts.ts` |
| `backend_config` | `missing_config_message` | `missingConfigMessage` | — |
| `home_config` | `vault_root_from_text` | `vaultRootFromText` | — |
| `update_check` | `parse_tag`, `parse_version`, `is_newer`, `newest_release` | `parseReleaseTag`, `parseAppVersion`, `isNewerVersion`, `newestDesktopRelease` | — |
| `privacy_disclaimer_readiness` | `should_mount_shell_children`, `should_show_workspace_loader` | `shouldMountShellChildren`, `shouldShowWorkspaceLoader` | `apps/web/src/features/auth/ui/privacy-disclaimer-gate.tsx` |

Rules:

- `account_links`: no GitHub entry; the source link stays on the public pitch page. Documentation is in the account block, not Settings. Sharing and AI suggestions are not here; they are the Inbox group.
- `account_menu`: the AI row is always first, then the shared row, and the supervisor row for supervisors. A local account (no sign-in) gets the AI row only. Only rows with a count count toward the icon.
- `account_provision`: `create_member_reply(ok, has_member)` decides the reply. The fallback texts are `Failed to create account.` and `Account created but no member returned.`. Citation-alert failure logs are `warn` from `citation-alerts`.
- `account_purge`: listings are paged at 200 entries. Object removal runs only for the tiered provider and only when the user has rows. Failed removals throw, and the rows stay for a retry.
- `auth_transition`: decides from ids and flags only. The caller builds the user object for the step it gets back.
- `backend_config`: names only, never values. A variable scoped to Production is invisible on Preview deployments, so the message says which environment to set it for.
- `home_config`: returns `None` (TS `{ vaultRoot: null }`) when the text is not a JSON object, the key is missing or not a string, or the string is empty.
- `update_check`: tags must be exactly `v<major>.<minor>.<patch>` after trimming. `android-vN` and `py-v…` tags are rejected. The newest release is found by version, not list order; drafts and pre-releases are skipped; on a tie the first listed is kept.
- `privacy_disclaimer_readiness`: a cached "already accepted" snapshot still waits for the full container. The workspace loader yields to the error when a startup error is present.
