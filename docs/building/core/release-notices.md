# Release notices

A release notice is a short in-app message about a new version. It shows once per device in a banner until the user dismisses it.

Notices are rows in `release_notices`, one per version. The text is the version's section from [`CHANGELOG.md`](../../../CHANGELOG.md). No GitHub secret or CI step is involved; a person publishes each notice after the release is out.

## Pieces

| Part | Where |
| --- | --- |
| Table `release_notices` | `db/migrations/0156_release_notices.sql` |
| `latest` (newest notice, or `null`; reads no account row) | `crates/wf-core/src/repos/release_notices.rs` |
| Banner and dismissal (`localStorage` key `wf.releaseNotice.seen`) | `apps/web/src/features/release-notices/ui/release-notice-banner.tsx` |
| Publish script | `scripts/publish-release-notice.mjs` |

Rules:

- A notice shows when its `version` differs from the version stored in `localStorage` (`wf.releaseNotice.seen`). The latest row is the only one considered.
- Dismissal is stored on this device only. It is not sent to the server, so `user_settings` is never read or written for notices. A notice may show once more on a new device or after storage is cleared.
- A notice dismissed on the account before this change (the old `user_settings.last_release_notice_seen`) shows once more per device. Nothing migrates the old value.
- `body` is plain text in the banner. It is not rendered as HTML.

## TODO (1.0.0 cleanup)

Dead code since the device-local change, to remove with the 1.0.0 drop:

- The `unseen` arm and `fn unseen` in `crates/wf-core/src/repos/release_notices.rs`,
  with the `last_release_notice_seen` read in it. The web code no longer calls it.
- The `saveNoticeSeen` arm in `crates/wf-core/src/repos/user_settings.rs`, with the
  `last_release_notice_seen` field of its row.
- Column `user_settings.last_release_notice_seen` in `db/migrations/0156_release_notices.sql`,
  dropped by a 1.0.0 migration (ask first; it is a production write).

## Publishing steps

1. Confirm the release section exists in `CHANGELOG.md` under `## [<version>]`.
2. Preview the SQL (nothing is written):

   ```bash
   WF_OCI_SSH=<user@host> npm run release:notice -- <version>
   ```

3. Insert the row on the OCI Postgres:

   ```bash
   WF_OCI_SSH=<user@host> npm run release:notice -- <version> --apply
   ```

Re-running with `--apply` for the same version updates the existing row. `WF_OCI_SSH` is only read from the environment and is never printed.
