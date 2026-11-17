---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/settings/ui/workspace-folder-panel.tsx
  - apps/shell/src/vault_choice.rs
  - apps/shell/src/local_http/server.rs
  - crates/wf-core/src/workspace
checked: 2026-11-17
---
# The workspace folder

WeaveForge can keep a folder of plain Markdown on your disk that mirrors your
workspace, and read your edits back in. The folder is a normal folder: you can
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
holding the mirror's own bookkeeping. On the desktop, the local database lives in
the workspace folder's `.weaveforge/db` when the app finds it there; otherwise it
stays in WeaveForge's own data directory.

Backups are different: they are written to WeaveForge's own data directory
(`local-db-backups`), not into the folder. See
[the desktop app](desktop.md) for the rest of what the app keeps where.

[How your work is stored and synced](sync.md) is the full picture.

Every file carries a `weaveforge-id` in its frontmatter. **That id is the
identity, and the filename is not.** Rename a note in Finder and it stays the
same note.

## Which direction things flow

Writing out is automatic. Reading back is not.

The mirror follows your workspace: save something in the app, and the folder
catches up a moment later. It is one-way and best-effort: the database is the
source of truth, and a folder that cannot be written (disk unplugged, permission
revoked) does not take your save down with it.

Pulling folder edits back in is an explicit action, and it shows you a diff
first before anything is applied.

On desktop, WeaveForge watches the folder and tells you when something out there
changed. It reports; it does not apply.

## When both sides changed

When the same file was changed in the folder and in the app, the pull stops and
the conflict is listed in Settings → Workspace under **Needs you**, naming the
fields that collided. Nothing is written over until you choose. For each file you
can keep this app's copy, take the folder's, or keep both.

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

## Safety

- Paths are checked before any write: `..` and absolute paths are refused.
- The mirror's record of what it wrote (`mirror.json`) lives in the folder it
  describes, not in local storage.

## Related

- [How your work is stored and synced](sync.md)
- [Git auto-sync](../building/git-auto-sync.md): how the engine works.
- `docs/internal/plans/future/live-vault-folder.md`: the plan and its phases.
- `docs/internal/plans/future/interop-surface.md`: what else talks to WeaveForge.
