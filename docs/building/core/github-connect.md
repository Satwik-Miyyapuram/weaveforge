# github-connect

Rust home: `apps/shell/src/github_connect.rs` (shell, not wf-core: it does network and keychain I/O).
Tests: `apps/shell/tests/github_connect.rs`, plus one unit test in the module.
TS callers: `apps/web/src/features/workspace/application/parts-2.ts` (`startGithubConnect`,
`finishGithubConnect`, `cancelGithubConnect`), used by `features/settings/ui/github-connect.tsx`
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
   `weaveforge-<slug>` repo. On 422 (name taken) it reuses the repo only when the user owns it
   and it is private; otherwise it returns an error saying why.
4. It stores the token in the keychain secret `git-sync-token` (the one the manual token path
   uses), and sets the prefs `vault-git` (on) and `vault-git-remote` (the clone URL).
5. The page then runs `vaultSync("connect")`. Finish does not push.

`github_connect_cancel` stops a running poll. The token never reaches the page.

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
- Web: `apps/web/src/features/settings/test/github-connect.test.tsx` (panel, Advanced, onboarding
  order, Skip, hidden when a remote is set or the shell is older).
