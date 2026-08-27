# The desktop app

WeaveForge in a window of its own. It is the same app the browser runs — the
same notes, the same library, the same account — wrapped so it opens from the
taskbar, keeps its own window size, and does not sit in a tab that gets closed
by accident.

Nothing is stored differently. Sign in on the desktop and the browser sees the
same notes a moment later, because both are talking to the same account.

## Signing in with Google

Pick **Continue with Google** and your normal browser opens on Google's own
sign-in page. Choose the account, and the browser shows a short page saying
you're signed in. The app finishes on its own — go back to it and you are
already through. There is no code to copy and no button to press.

If the browser tab is still open once the app has let you in, close it. It has
nothing left to do.

### Why the browser and not a window inside the app

Signing in inside the app would mean the app could read everything you typed on
Google's page, including your password. Because it *could*, Google will not
allow it — an embedded browser is refused sign-in outright, and every app you
use in this shape does the same thing: it hands the sign-in to a browser you
already trust, and gets back only the result.

The way the result comes back is the part worth knowing about. While it is
waiting, the app listens on `127.0.0.1` — your own machine, on a port nothing
outside it can reach — and the browser is sent there at the end. Nothing about
your sign-in crosses the network to get from the browser to the app, because
both are on the same computer.

### If sign-in doesn't finish

**The browser says it can't reach the page.** The app has to be running and
waiting for the browser to arrive. If it was closed or restarted mid-way,
start the sign-in again from the app.

**Something else is on the port.** WeaveForge listens on port 53682, and only
while a sign-in is in flight. If another program holds it, the app logs
`sign-in listener could not start` on startup and the sign-in has nowhere to
land. Quitting the other program is enough; nothing needs configuring.

**You took too long.** The code the browser brings back is good for about five
minutes and can only be used once. Past that, start again.

## Signing in with an email address

Email and password work the same as they do in the browser, with no round trip
through anything. If you use both, they are the same account only if the
addresses match.

## Updating

Most of WeaveForge does not need updating at all. The window loads the app from
the web, so a change to the app is there the next time you open it — the same
way a browser tab gets it. There is nothing to download and no version of the
app to keep in step.

What the installer holds is the window itself: signing in, links opening in your
browser, and the machinery underneath them. That part changes rarely, and when
it does the app tells you **once you sign in** — not every time you open it. A
box that appears at every launch is a box people learn to close without reading,
and by the time it matters they have stopped seeing it.

Nothing is downloaded until you choose to. Choosing to opens the release page in
your browser, where the installer is the same one you first installed from.

Between sign-ins the same fact sits in **Settings → Updates**, with a dot on the
section when a newer version is out. That section also shows which version this
window is, and has a **Check now** button if you would rather ask than wait.

The section is not there in a browser, because a browser has no window to
update — whatever it loads is already current.

If the check cannot reach GitHub it says nothing rather than showing you an
error, because a shell that cannot reach GitHub is still a working shell.

## A folder on your disk

The desktop app can point WeaveForge at any folder you pick and keep it mirrored
as plain Markdown, then tell you when something out there changes it. The
browser can do this too, but only for a folder you re-pick each session; the
desktop app remembers the one you chose, and is the only place the folder is
watched. See [`workspace-folder.md`](workspace-folder.md).

## Links

Links to other sites open in your normal browser, not inside the app window.
That is deliberate: the app window is for WeaveForge, and a page that arrived
from somewhere else does not get to run in it.

## Working without an account

The desktop window offers **"Work on this computer, without an account"** on the
sign-in screen. Choosing it swaps four things — the database client, the
identity, the auth service and the blob store — for local ones, and leaves every
repository, screen and use case above them untouched. The data lives in PGlite
under the app's own directory, with the same schema the server has (all the
server migrations run locally), and the sidebar carries an **Offline · on this
computer** badge for as long as that is true. Where a signed-in copy offers
"Sign out", an account-less one offers **Sign in**: there is no session to end,
and signing in later leaves what is on this computer where it is.

What this covers and what it costs:

- Projects, notes, papers, lists, reports, experiments, the workspace folder
  mirror, the local HTTP API and the MCP server all work with no network at all.
  Launching needs no connection: a packaged copy in offline mode makes no
  outbound request at boot.
- The editor works, including in a document you are the only reader of. Typing
  is recorded the way it always is — the change log a document is rebuilt from
  is still written — but no sync channel is opened, because there is nobody on
  the other end of it to reach. A copy with an account and a copy without both
  end up with the same document; only one of them has anybody to send it to.
- Overleaf reports can be linked, renamed, re-pointed and unlinked with no
  account. See [Overleaf, with no account](integrations.md#overleaf-with-no-account)
  for what the token does and where it is kept.
- Attachments are kept in a local table (`local_blobs`) rather than object
  storage, base64-encoded, because the bridge to the shell carries text.
- Integration credentials are kept in `local_secrets` in the same local
  database, not behind `/api/settings/credentials` — there is no server to hold
  them and no other user to hold them from. They are protected by the file
  permissions on the app's directory and nothing else.
- Sharing, supervision and anything else that needs a second person are
  account features and stay unavailable.

There is a fuller table of what does and does not survive the network being
unplugged in [How WeaveForge is put together](architecture-map.md#offline-precisely).

### Training scripts write into it too

The local HTTP API also answers the Python SDK's routes, so a run logged from a
training script lands in the same folder-sized database as everything else. Turn
the API on in **Settings → Let other apps in**, then:

```bash
export WEAVEFORGE_TOKEN=<the token the app shows>
export WEAVEFORGE_API_URL=http://127.0.0.1:27123
```

`weaveforge.track(...)` then behaves exactly as it does against a server: the
same client, the same routes, the same rows. Re-sending a step overwrites it
rather than duplicating it, so a script that retries a flush is safe. Artifacts
are the exception — they are blobs, and the local API only knows how to run
SQL — so figures logged this way have nowhere to go offline.

## Updates

Packaged copies update themselves: `electron-updater` checks the GitHub releases
feed on launch and every six hours, downloads in the background, and asks once —
after the bytes are already local — whether to restart now or install on quit.
Every failure is silent, because "cannot reach GitHub" is the ordinary state of
a copy on a train. **Help → Check for updates…** forces a check and says so
either way.

SECURITY: the Windows build is not code-signed. The only integrity check on a
downloaded update is the SHA-512 in `latest.yml`, fetched over HTTPS from the
same release. That is weaker than a signature, and signing is the fix.

## The window's menu

The window carries its own menu rather than Electron's default (whose Help
entries point at electronjs.org): File has the workspace-folder chooser and
Settings, Edit has the usual editing roles, View has Home / Library / Notes plus
reload and zoom, and Help has Documentation, Check for updates… and the version.
Menu navigation happens inside the page, not with `loadURL` — a load driven from
the main process starts a fresh document, which would log an account-less copy
straight back out.
