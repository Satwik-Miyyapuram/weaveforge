# github-connect

Rust home: `apps/shell/src/github_connect.rs` (shell, not wf-core: it does network and keychain I/O).
Tests: `apps/shell/tests/github_connect.rs`, plus one unit test in the module.
TS callers: `apps/web/src/features/workspace/application/parts-2.ts` (`startGithubConnect`,
`finishGithubConnect`, `cancelGithubConnect`, `uploadWorkspace`, `onGithubReauth`), used by `features/settings/ui/github-connect.tsx`
(Settings panel) and `features/settings/ui/github-onboarding.tsx` (first-run card).
User docs: [Syncing to your own GitHub](../../using/sync.md#syncing-to-your-own-github).

## What it does

One-click GitHub sync for the workspace folder:

1. `github_connect_start` asks GitHub for a device code (`POST /login/device/code`, scope `repo`)
   and returns `{userCode, verificationUri, expiresIn}` to the page.
2. `github_connect_finish(name)` polls `POST /login/oauth/access_token` until the user answers.
   It waits `interval` seconds between polls, adds 5 seconds on `slow_down`, and stops on
   `access_denied`, `expired_token` or the code's `expires_in` deadline.
3. With the token it reads `GET /user`, then `POST /user/repos` for a private
   `weaveforge-<slug>` repo. When `vault-git-remote` is already `https://github.com/<login>/<name>`,
   `existing_repo_name` keeps that `<name>`, so a reconnect syncs to the same repo. On 422 (name taken) it reuses the repo only when the user owns it
   and it is private; otherwise it returns an error saying why.
4. It stores the token in the keychain secret `git-sync-token` (the one the manual token path
   uses), sets the prefs `vault-git` (on) and `vault-git-remote` (the clone URL), and clears
   `github-reauth`.
5. The page then runs `vaultSync("connect")`, then `uploadWorkspace()`: a push, and when the
   remote turns it away (a reused repo with commits), `pullThenPush()`. A conflict or a second
   rejection rejects with a reason; the panel shows it with Retry.

`github_connect_cancel` stops a running poll. The token never reaches the page.

## Repo name

`repo_name(slug, folder)` lowercases, maps every character other than ASCII letters, digits,
`_` and `.` to `-`, collapses runs of `-` and trims `-`/`.` at the ends. The slug is tried first, then the folder name. The result is
`weaveforge-<base>`, cut to 100 characters with no trailing `-` or `.`. An empty base becomes
`workspace`, so the name is never just the prefix.

## Reconnect

A revoked or invalid token must not fail silently.

- `vault_sync` (in `vault_sync.rs`) calls `note_auth(prefs, url, action, failure)` after each
  action. When the remote is on `github.com` and the failure `is_auth_failure` (git2's "The token
  was refused.", "add a token", 401, "Bad credentials", ...), it sets the shell-only pref
  `github-reauth` (`REAUTH_PREF`, not page-writable). Any later pull, push or connect that works
  clears it; `settings` and `status` leave it alone.
- `VaultSyncReply.needsReconnect` carries the flag to the page.
- `folderRemoteSync` re-reads `settings` after a failure and calls every `onGithubReauth`
  listener when the flag is set. The Settings panel and the onboarding card listen; the card
  comes back even after Skip, with **Reconnect** and a session-only **Later**.
- Reconnect reruns the device flow; `existing_repo_name` keeps the same repo.

## Settings

- Client id: `option_env!("WF_GITHUB_CLIENT_ID")` at build time, else the public default
  `Ov23liGTr77x2QN93Qmw`. The device flow needs no client secret.
- `name`: the repo slug source. `null` uses the workspace folder's name.

## Tests

- Device flow against a mock HTTP server: pending then token, `slow_down` backs off, denied,
  expired reply, deadline passes while pending, cancel.
- Repo: 201 created; 422 reuses the user's private repo; 422 refuses a public repo and someone
  else's repo.
- Request shape: client id and scope sent, token sent to `/user`, form encoding, repo slug.
- Repo name: always valid for GitHub (charset, 100 characters, no trailing `-`/`.`), falls back
  to `weaveforge-workspace`.
- Reconnect: auth failures told apart from others, only `github.com` remotes flag, the same repo
  is kept; `apps/shell/tests/vault_sync.rs` checks `note_auth` sets and clears the flag.
- Web: `apps/web/src/features/settings/test/github-connect.test.tsx` (panel, Advanced, onboarding
  order, Skip, hidden when a remote is set or the shell is older, upload then Synced, Retry,
  pull-then-push, conflict, Reconnect in panel and card) and
  `apps/web/src/features/workspace/test/folder-remote-sync.test.ts` (`onGithubReauth`,
  `uploadWorkspace`).
