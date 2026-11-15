---
covers:
  - apps/shell
  - apps/android
checked: 2026-11-14
---
# The desktop app

WeaveForge in a window of its own. It is the same app the browser runs — the
same notes, the same library, the same account — wrapped so it opens from the
taskbar, keeps its own window size, and does not sit in a tab that gets closed
by accident.

Nothing is stored differently. Sign in on the desktop and the browser sees the
same notes a moment later, because both are talking to the same account.

## Installing on Windows

Download the installer from the
[releases page](https://github.com/Satwik-Miyyapuram/weaveforge/releases/latest):
`WeaveForge_<version>_x64-setup.exe` for most people, or
`WeaveForge_<version>_x64_en-US.msi` if your IT department deploys MSI packages.
Both install the same app. The build is for 64-bit Intel and AMD PCs; Arm PCs
(Snapdragon) run it through Windows' built-in emulation.

<!-- UNCONFIRMED: no signing config in apps/shell/tauri.conf.json, apps/shell/tauri.bundle.json or .github/workflows/ci.yml; release-time signing and publishing happen outside the repo. -->
The Windows build is free and open-source, and is not signed with an expensive
commercial EV code-signing certificate (which costs hundreds of dollars a year).
Because of this, Microsoft Defender SmartScreen displays a blue prompt on the
first run: *"Windows protected your PC — Microsoft Defender SmartScreen prevented an
unrecognized app from starting."* To install and run:

1. **SmartScreen dialog**: Click **More info** (underneath the warning text),
   then click the **Run anyway** button that appears at the bottom.
2. **File Properties unblock**: If Windows blocks running the downloaded file,
   right-click the installer (`.exe`) → **Properties** → under the **General**
   tab at the bottom, check the **Unblock** box (*"This file came from another
   computer and might be blocked to help protect this computer"*) → click **Apply**
   or **OK**, then double-click the installer.
3. **In PowerShell**, if you prefer the terminal:
   ```powershell
   Unblock-File -Path .\WeaveForge-*-Windows-*.exe
   ```

## Installing on a Mac

Download `WeaveForge-<version>-macOS.dmg` (one file for Apple silicon and Intel) from the
[releases page](https://github.com/Satwik-Miyyapuram/weaveforge/releases/latest),
open it, and drag WeaveForge into Applications.

<!-- UNCONFIRMED: notarisation is not set up anywhere in the repo (no macOS signing config in apps/shell/tauri*.json or .github/workflows/ci.yml); release-time status is unknown. -->
The Mac build is free and is not notarised by Apple, which costs a yearly
developer fee. So the first time you open it, macOS Gatekeeper says it cannot
check the app for malicious software or that the developer cannot be verified,
and offers only **Done** or **Move to Trash**. To open it:

1. **System Settings**: Open **System Settings → Privacy & Security**. Scroll
   down to the **Security** section showing WeaveForge was blocked, and click
   **Open Anyway**. Confirm with your password or Touch ID. From then on it opens
   normally.
2. **Finder Control-Click**: In Finder, open `/Applications`, hold the **Control**
   key and click (or right-click) `WeaveForge.app`, then select **Open**. In the
   dialog that appears, click the **Open** button (which is hidden during a regular
   double-click).
3. **In Terminal**, once (removes the quarantine attribute applied to downloads):
   ```bash
   xattr -dr com.apple.quarantine /Applications/WeaveForge.app
   ```

<!-- UNCONFIRMED: no signing step in .github/workflows/ci.yml; the ad-hoc signature claim is not verifiable from the repo. -->
The app carries an *ad-hoc* signature: enough for macOS to run it and to notice
if it has been changed since it was built, but it says nothing about who built
it. If that matters to you, build it yourself from source.

The Mac build does not update itself; see [Updating](#updating).

## Installing on Android

For Android tablets and phones (especially devices with an active stylus like the
Samsung Galaxy Tab S-Pen), download `WeaveForge-<version>-Android.apk` from the
[releases page](https://github.com/Satwik-Miyyapuram/weaveforge/releases).

The Android release is the native inking shell: a front-buffered digitiser surface
with hardware palm rejection over the full web app, plus a home-screen deadlines
widget. Because it is distributed directly as an `.apk` (sideloaded) rather than
through Google Play, Android's security protections will ask for confirmation before
installing:

1. **Allow unknown apps**: When you tap the downloaded `.apk` in Chrome, Firefox,
   or your file manager, Android prompts that your phone or tablet is not allowed
   to install unknown apps from this source. Tap **Settings** on the prompt, turn on
   **Allow from this source**, press Back, and tap **Install**.
2. **Google Play Protect warning**: If Google Play Protect displays a prompt
   (*"Blocked by Play Protect"* or *"Play Protect doesn't recognize this app's
   developer"*), tap **More details** (or the small drop-down arrow) and select
   **Install anyway**.
3. **Via ADB** (optional, for devices connected to a computer via USB):
   ```bash
   adb install -r WeaveForge-<version>-Android.apk
   ```

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

**Something else is on the port.** WeaveForge listens on port 53682 for as long
as the app is running. If another program holds it, the app logs
`The sign-in listener did not start` on startup, and the browser cannot hand the
sign-in back. The sign-in screen then shows a **Sign-in address** box: finish
signing in in the browser, copy the address from its tab, and paste it there.
Quitting the other program is also enough; nothing needs configuring.

**You took too long.** <!-- UNCONFIRMED: the five-minute lifetime and single use are not checked in the repo; the code is issued outside it. --> The code the browser brings back is good for about five
minutes and can only be used once. Past that, start again.

## Signing in with an email address

Email and password work the same as they do in the browser, with no round trip
through anything. If you use both, they are the same account only if the
addresses match.

## Sharing and supervision

A signed-in window has the same **Shared with you** entry in the sidebar's Inbox
as the browser (**Supervision** too when you supervise students). It shows what
others shared with you and what you shared, and **Share my work** shares a whole
kind of thing at once: every note, every paper, the whole report or plan,
including items you add later. These pages read from the server, so they need
the connection; your own notes keep working offline either way.

Organisation admin (members, invites) stays in the browser. <!-- UNCONFIRMED: product statement; no code in the repo enforces where org admin runs. -->

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

**On a Mac** the app does not update itself: macOS only lets an app replace
itself when Apple has signed it, and this one is not. The same **Updates**
section applies: when a newer version is out it says so, with a **Get** button
that opens the release page. Nothing is installed without you.

If the check cannot reach GitHub the section says **Could not check for
updates. Try again.** and the window keeps working.

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

The desktop window offers **Use without an account, local only** on the
sign-in screen (and **Work on this computer (offline)** on the "Couldn’t start the
app" screen). Choosing it swaps four things — the database client, the
identity, the auth service and the blob store — for local ones, and leaves every
repository, screen and use case above them untouched. The data lives in a local Postgres server (`local-pg`)
under the app's own directory, with the same schema the server has (all the
server migrations run locally), and the sidebar carries an **Offline · on this
computer** badge for as long as that is true. Where a signed-in copy offers
"Sign out", an account-less one offers **Sign in** <!-- UNCONFIRMED: no Sign in entry for offline mode found; apps/web/src/features/settings/ui/settings-find.tsx:11 lists only Sign out. -->: there is no session to end,
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
- Integration credentials are kept in `local_secrets` <!-- UNCONFIRMED: table name not found in apps/web/src/backend/providers/local; only the /api/settings/credentials mentions at apps/web/src/backend/parts.ts:202 and providers/local/parts.ts:68 match. --> in the same local
  database, not behind `/api/settings/credentials` — there is no server to hold
  them and no other user to hold them from. They are protected by the file
  permissions on the app's directory and nothing else.
- Sharing, supervision and anything else that needs a second person are
  account features and stay unavailable.

There is a fuller table of what does and does not survive the network being
unplugged in [How WeaveForge is put together](../building/architecture-map.md#offline-precisely).

### Where it lives, and what happens if it breaks

The database is a directory, `local-pg`, under the app's own data directory
(`%APPDATA%\dev.weaveforge.desktop` on Windows, `~/Library/Application Support/
dev.weaveforge.desktop` on macOS). A run that is cut off at the wrong moment — a
force-quit, a crash, the power — can leave that directory in a state no later
start can open. Three things stand between that and losing your notes:

- **Copies.** Every ten minutes, and again when the app quits, the whole database is written out as a compressed archive to `local-db-backups/` in the app's data folder, beside `local-pg`. The newest three are kept, plus the newest copy from each of the last seven days. The workspace folder is not written to: no `.weaveforge/db-backups/` copy is created (only `local-db-backups` is configured, `apps/shell/src/lib.rs:363`). <!-- UNCONFIRMED: the 'while something has changed' condition was not found in apps/shell/src/lib.rs spawn_backups (lines 376-400 not fully traced); uninstall behaviour for the data folder is not in the repo. -->
- **Restoring by itself.** When the data folder holds no database (no `data/PG_VERSION`; `apps/shell/src/local_pg/host.rs:86-110`), the directory is moved aside as `local-pg.discarded-<time>` (never deleted) and the newest copy from `local-db-backups/` is loaded into a fresh one, without asking. A database that exists but will not open is not moved aside or restored by this path. You lose at most what changed since that copy. <!-- UNCONFIRMED: when the *Couldn't start the app* screen (*Start with a fresh database*) appears was not traced; its own text (apps/web/src/features/auth/ui/privacy-disclaimer-gate.tsx:255-290) says it appears only when no copy exists. -->
- **After a reinstall.** Copies are only in the app's data folder, so they survive a reinstall only if that folder is kept. The app does not restore from a workspace folder. <!-- UNCONFIRMED: the earlier text described a `~/.weaveforge/desktop.json` record that no code in apps/shell/src writes or reads, and a restore from `.weaveforge/db-backups/`; neither is found in the repo. Whether uninstall removes the data folder is not in the repo. -->

### Training scripts write into it too

The local HTTP API also answers the Python SDK's routes, so a run logged from a
training script lands in the same folder-sized database as everything else. Create
a token in **Experiments → More → Python SDK token** (experiments
only) or **Settings → Access tokens** (pick permissions and expiry). It shows once;
only its hash is kept. Then:

```bash
export WEAVEFORGE_TOKEN=<the token the app shows once>
export WEAVEFORGE_API_URL=http://127.0.0.1:27123
```

`weaveforge.track(...)` then behaves exactly as it does against a server: the
same client, the same routes, the same rows. Re-sending a step overwrites it
rather than duplicating it, so a script that retries a flush is safe. Artifacts
are the exception — they are blobs, and the local API only knows how to run
SQL — so figures logged this way have nowhere to go offline.

## Updates

The window checks GitHub releases for a newer version when **Settings → Updates**
opens, and keeps the answer for an hour. The app downloads nothing itself. When a
newer version is out, the section shows it with a **Get** button, labelled with the new version
number, that opens the release page in your browser. A failed check shows "Could not check for updates.
Try again." and is not kept, so the next look asks again. <!-- UNCONFIRMED: the not-kept behaviour was not traced in apps/web/src/features/settings/ui/desktop-update-panel.tsx. --> **Check now** in that
section, or **Help → Check for updates…**, asks straight away.

SECURITY: the Windows build is not code-signed. <!-- UNCONFIRMED: the repo has no signing config (apps/shell/tauri.conf.json, apps/shell/tauri.bundle.json, .github/workflows/ci.yml), and ci.yml publishes no Windows release; the signing state of the released installer and its release page are outside the repo. --> Nothing is installed by the app
itself; the installer comes from the release page in your browser, over HTTPS.
That is weaker than a signature, and signing is the fix.

## The window's menu

The window has its own menu bar:

- **File**: the workspace-folder entries (**Choose workspace folder…** when none
  is set; otherwise **Show in file explorer** and **Change workspace folder…**),
  **Settings** (`Ctrl+,`) and **Quit**.
- **Edit**: Undo, Redo, Cut, Copy, Paste and Select all.
- **Go**: the sidebar pages, from Home and Search… down to Settings.
- **View**: Reload, Actual size, Zoom in, Zoom out, Full screen and Developer tools. In an installed build Developer tools does nothing; it only opens in debug builds (`apps/shell/src/menu.rs`, `dev_tools()`).
- **Window**: Minimize, Maximize and Close window.
- **Help**: Documentation, Keyboard shortcuts, Check for updates… and the
  version number, greyed out.

Menu navigation happens inside the page. <!-- UNCONFIRMED: no `loadURL` call exists in apps/shell/src or apps/web/src, so the earlier reason (a main-process load would start a fresh document and log an account-less copy out) is not verified; menu handlers were not traced. -->
