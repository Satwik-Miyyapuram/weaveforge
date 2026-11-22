---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/web/src/features/settings/ui/folder-remote-sync-panel.tsx
  - apps/web/src/features/settings/ui/github-connect.tsx
  - apps/shell/src/github_connect.rs
  - apps/web/src/backend/parts.ts
  - apps/web/src/backend/providers/postgrest/watch-writes.ts
  - crates/wf-core/src/sync
checked: 2026-11-22
---
# How your work is stored and synced

This page covers where your work lives and how it syncs in 0.9.8. It describes only what the code on this branch does.

## Where your work lives

Your notes, papers, plans and logbook are files in the workspace folder you chose. Without an account, WeaveForge works on those files directly and keeps no database. You do not need an account to use it.

## Syncing with GitHub

Sync goes through **your own private GitHub repository**, one per workspace folder.

1. Connect GitHub from the app. It signs you in with GitHub's device flow, asks only for the `repo` scope, and creates a private repository named `weaveforge-<name>`. If a repository with that name already exists under your account, the app uses it.
2. The app uploads the workspace and shows **Uploading your workspace…**, then **Synced**.
3. The **Git remote** section of workspace settings shows **Backs up to** with the repository.

Once connected, the folder syncs by itself:

- about 10 seconds after a folder commit,
- when the app starts,
- every 5 minutes,
- when the window regains focus,
- when the network comes back.

The status dot shows **Synced**, **Syncing…**, **Offline** (it syncs when you are back online) or **Sync failed**, with the time of the next try. After a failure the app waits 30 seconds, then 1 minute, then 5 minutes before it tries again.

## What is not there any more

- **Offline sync is removed.** There is no offline sync mode and no server sync queue in the app. Your notes are files, so the folder is what you back up or sync.

## Sharing

Sharing and live collaboration still go through the WeaveForge server. See [Collaborative editing](collaborative-editing.md).

## Related

- [The workspace folder](workspace-folder.md): the folder layout.
- [Upgrading to 0.9.8](upgrading-to-098.md): the 0.9.7 export gate and what changed for keys.
- [Collaborative editing](collaborative-editing.md): two people in one document.
