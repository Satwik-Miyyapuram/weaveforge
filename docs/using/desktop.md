---
covers:
  - apps/shell
  - apps/android
checked: 2026-11-23
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
Both install the same app. Those are for 64-bit Intel and AMD PCs; on an Arm PC
(Snapdragon) take the `arm64` files instead, such as
`WeaveForge_<version>_arm64-setup.exe`.

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
   Unblock-File -Path .\WeaveForge_*-setup.exe
   ```

## Installing on a Mac

The [releases page](https://github.com/Satwik-Miyyapuram/weaveforge/releases/latest)
has Windows installers only; there is no Mac download yet. On a Mac, build the
app from source (`npm run tauri -- build` in `apps/shell`) and drag
`WeaveForge.app` into Applications.

A Mac build is free and is not notarised by Apple, which costs a yearly
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

**Something else is on the port.** WeaveForge listens on port 53682, and only
while a sign-in is in flight. If another program holds it, the sign-in has
nowhere to land. Quitting the other program is enough; nothing needs configuring.

**You took too long.** The code the browser brings back expires and can only be
used once. If it no longer works, start again.

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

Organisation admin (members, invites) stays in the browser.

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

### Coming from 0.8

This version no longer brings over the offline data that 0.8 kept in its own
local database. If you still have 0.8 data you need, open it in 0.9.3 (or an
earlier 0.9 release) first, which brings it over once, and then update. The old data is
never changed or deleted, so it stays where 0.8 left it.

### Upgrading to 0.9.7

0.9.7 keeps your notes, papers, ink and settings as ordinary files in a
workspace folder instead of the app's internal database. A workspace folder is
now required: choose a folder for your workspace before you start working.

The first time you open 0.9.7, an upgrade screen shows the move's progress and
then a report. The report is saved as `.weaveforge/migration-0.9.7/report.json`
in your workspace, and lists how many items moved for each kind, any conflict
copies, and where the backup is.

Nothing is deleted automatically. A backup is kept in
`.weaveforge/migration-0.9.7/`. Once the move is verified, a **Remove old data**
button appears; nothing is removed until you press it. It does not appear
before the move is verified.

Passwords and tokens are kept in your operating system's keychain, never in a
file. On Linux, install a keyring that provides Secret Service first, for
example:

```
sudo apt install gnome-keyring libsecret-1-0
```

then unlock the keyring and try again.

### Upgrading to 0.9.8 and 1.0.0

0.9.8 does not move old database data itself.

- **0.9.8** keeps your device passwords and tokens only in your operating
  system's keychain. The no-account copy of your data runs on your workspace
  files, not on the local database. The Overleaf token saved by 0.9.7 is removed
  from the keychain when the app starts.
- **1.0.0** is the first stable release. Everything in 0.9.8 is included. The
  server's personal-table removal is not part of 1.0.0 yet: those tables stay on
  the server until a later 1.0.x applies it.

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

**Use without an account** on the sign-in screen asks for a workspace folder,
shows any warnings about it until you press **Continue**, then reloads the window
on that folder. The choice is kept for the next launch. **Sign out** in the
account menu ends it: there is no session to end, so it brings back the sign-in
screen, and what is on this computer stays where it is. The button is not
offered when a signed-in session expires.

What this covers:

- Your notes, papers, lists, reports and experiments are files in the open
  workspace folder, as they are with an account. No database is used. With no
  folder open, the app asks you to open one.
- Attachments and images are files too, under `assets/` in the folder, each
  with a `.sha256` file beside it so a damaged copy is noticed.
- Integration keys are kept in this computer's keychain, one entry per key.
  They never go into a file in the folder or to the server.
- Sharing, supervision and anything else that needs a second person are
  account features and stay unavailable.

## Opening on your last screen

When the window opens, the screen you left is there straight away, while the
app starts behind it. That first look is a picture of the screen you last saw.
You cannot click or type in it, and it is swapped for the live screen as soon
as the app is ready, usually within a second or two. Click or press a key
before then and the picture goes; that first click is not passed on, so nothing
you do lands on it.

The picture is kept only on this computer, only for the last three screens of
the project you had open, and only for the version of the app that drew it.
Signing out removes it. A different account, a new version, or a screen that
was too big to keep simply opens the normal way, with the loading screen.

## Updates

The window checks GitHub releases for a newer version when **Settings → Updates**
opens, and keeps the answer for an hour. The app downloads nothing itself. When a
newer version is out, the section shows it with a **Get** button, labelled with the new version
number, that opens the release page in your browser. A failed check shows "Could not check for updates.
Try again." and is not kept, so the next look asks again. **Check now** in that
section, or **Help → Check for updates…**, asks straight away.

SECURITY: the Windows build is not code-signed. Nothing is installed by the app
itself; the installer comes from the release page in your browser, over HTTPS.
That is weaker than a signature, and signing is the fix.

## The window's menu

The window has its own menu bar:

- **File**: the workspace-folder entries (**Choose workspace folder…** when none
  is set; otherwise **Show in file explorer** and **Change workspace folder…**),
  **Settings** (`Ctrl+,`) and **Quit**.
- **Edit**: Undo, Redo, Cut, Copy, Paste and Select all.
- **Go**: the sidebar pages, from Home and Search… down to Settings.
- **View**: Reload, Actual size, Zoom in, Zoom out and Full screen.
- **Window**: Minimize, Maximize and Close window.
- **Help**: Documentation, Keyboard shortcuts, Check for updates… and the
  version number, greyed out.

On Windows, minimizing the window tells it to use less memory: it trims what
it can rebuild, and gives the normal level back when you restore it.

Menu navigation happens inside the page, not with `loadURL` — a load driven from
the main process starts a fresh document, which would log an account-less copy
straight back out.
