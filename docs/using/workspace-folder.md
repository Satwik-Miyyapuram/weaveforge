---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/settings/ui/workspace-folder-panel.tsx
  - apps/shell/src/vault_choice.rs
  - apps/shell/src/local_http/server.rs
  - crates/wf-core/src/workspace
  - apps/web/src/features/workspace/application/workspace-folder.ts
checked: 2026-11-22
---
# The workspace folder

WeaveForge keeps your workspace as a folder of plain Markdown on your disk, and
reads your edits back in. The folder is a normal folder: you can
open it in other apps, because everything in it is a file you can read without
WeaveForge installed.

Settings → Workspace is where all of this lives.

## Choosing the folder on first open

The first time the desktop app opens with no folder chosen, it asks once where
the workspace should go. **Choose folder** lets you pick one. **Skip** uses a
`WeaveForge` folder inside your Documents folder. Your answer is remembered
across restarts, and the question is not asked again, even after you disconnect
the folder. You can change the folder later from Settings → Workspace.

The question names the folder Skip would use. If the folder connects but the app
has a warning about it, the question stays on screen with that warning until you
choose **Continue**.

You are not asked if WeaveForge already has data from an earlier version: an
older database, a folder remembered from an earlier version, or an Electron-era
data folder with items the app migrates. Quitting before you answer means you
are asked again on the next launch.

## What gets written

One directory per kind of thing (`notes/`, `papers/`, `reading-lists/`,
`report/`, `experiments/`, `plan/`, `logbook/`), plus a `.weaveforge/` directory
holding the mirror's own bookkeeping. Since 0.9.8 the files are the only copy of
your work: there is no local database, and no personal copy of your work is kept
on the server. Sync to folder no longer writes table files to `.weaveforge/tables/`,
and Apply no longer restores rows from them. Table files that 0.9.7 wrote stay
in the folder, and 0.9.8 does not read them. See
[the desktop app](desktop.md) for the rest of what the app keeps where.

[How your work is stored and synced](sync.md) is the full picture.

Every file carries a `weaveforge-id` in its frontmatter. **That id is the
identity, and the filename is not.** Rename a note in Finder and it stays the
same note.

## Which direction things flow

Both ways, with no click. The files in the folder are the store; the app reads
them directly, so there is nothing to import. The server holds only what you
share and your lab's organisation data.

Save something in the app and the file is written at once. Edit a file in the
folder with another editor and, on desktop, WeaveForge sees the change, reloads
it, and says so with a short note: "Folder changed: 2 files reloaded." The
app's own writes are not reported back to you.

If the folder is connected to a GitHub repository, each change is committed and
pushed about ten seconds after the edits stop, and the app pulls every five minutes.

## When both sides changed

A pull that finds the same file changed on this machine and on the remote stops
and pushes nothing. Settings → Workspace says how many files collided. For each
pull you can keep this machine's copy, take the remote's, or keep both (the
remote's copy is saved beside yours as "name (remote)"). Push never overwrites
the remote.

## Canvases

A [canvas](canvas.md) is written as a `.canvas` file in `notes/`. Because the file
carries no frontmatter, the mirror records which canvas each file belongs to in
`.weaveforge/canvas-ids.json`. Leave that file alone. If it cannot be read, your
canvases are held, not imported, until you repair or remove it.

## Letting other apps in

The desktop app can serve the folder over HTTP on this machine only. The server
binds to `127.0.0.1` and nothing else.

To turn it on, go to Settings → **Access tokens**, switch on **Let programs on
this computer connect**, then choose **Turn on** in the dialog. Every request
needs a token.

Each token carries its own permissions, grouped as:

- **Experiments**
- **Read and search Notes**
- **Write and delete Notes**
- AI clients: **Read and search the workspace** and **Leave drafts for you to approve**

The `/vault/` routes need a Notes permission. A token without one gets `403`,
and a request with no token gets `401`. **Revoke** asks first, because scripts
using that token stop working. You can create up to 5 tokens.

What is served: reading, writing, deleting and listing files under `/vault/`,
`POST /search/simple/?query=...`, and an MCP server at `/mcp` for agents running
on this machine, with three read tools: `search_workspace`, `list_workspace` and
`read_entry`.

## Keeping a history

The desktop app can commit the folder after each write, giving you file-level
history in ordinary git.

It refuses in one case even when switched on: a folder sitting inside somebody
else's repository. The app does not write commits into a repository it does not
own.

## Syncing with GitHub on its own

Once the folder has a remote and a token (Settings → **Workspace**), the
desktop app pulls and then pushes by itself. You do not press anything. It
syncs:

- about 10 seconds after the app commits the folder, so a burst of edits goes up
  as one sync;
- when the app starts, and every 5 minutes after;
- when you come back to the window, and when your computer is back online.

Only one sync runs at a time. A failed sync waits 30 seconds, then 1 minute,
then 5 minutes before it tries again, and the first success resets that. While
you are offline nothing runs. With no remote or no token it does nothing at all.

A small dot shows how it is going: at the foot of the sidebar on a computer, and
in the top bar on a phone.

| It says | Meaning |
| --- | --- |
| **Synced 14:02** | In step with the remote at that time. **· pulled changes** means something came in. |
| **Syncing…** | A pull and push is running. |
| **Offline** | No network. It syncs as soon as you are back. |
| **Sync failed** · **Retry** | The last sync failed. **Retry** tries now. |

Nothing shows when auto-sync is off. When both sides changed the same file, the
pull stops before pushing and the dot reports it. Choose which copy to keep in
Settings → **Workspace**.

A file deleted on the other computer stays deleted and is listed in Settings →
**Workspace**: choose **Put back** there to restore it, or delete the item in the
app as well.

To sync the folder to another machine, push that history to a git remote.
**Connect GitHub** under Settings → Workspace folder → **Git remote** makes a
private repository for it in one step; see
[Syncing to your own GitHub](sync.md#syncing-to-your-own-github).

## Safety

- Paths are checked before any write: `..` and absolute paths are refused.
- The mirror's record of what it wrote (`mirror.json`) lives in the folder it
  describes, not in local storage.

## Related

- [How your work is stored and synced](sync.md)
- [Git auto-sync](../building/git-auto-sync.md): how the engine works.
- `docs/internal/plans/future/live-vault-folder.md`: the plan and its phases.
- `docs/internal/plans/future/interop-surface.md`: what else talks to WeaveForge.
