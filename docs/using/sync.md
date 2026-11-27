---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/web/src/features/settings/ui/folder-remote-sync-panel.tsx
  - apps/web/src/features/settings/ui/github-connect.tsx
  - apps/shell/src/github_connect.rs
  - apps/web/src/backend/parts.ts
  - crates/wf-core/src/sync
checked: 2026-11-22
---
# How your work is stored and synced

This page covers where your work lives and how it syncs in 0.9.8. It describes only what the code on this branch does.

## Where your work lives

Your notes, papers, plans and logbook are files in the workspace folder you chose. Without an account, WeaveForge works on those files directly and keeps no database. You do not need an account to use it.

## Syncing with GitHub

Sync goes through **your own private GitHub repository**, one per workspace folder. In 0.9.8, GitHub sync works in the desktop app only; the web app does not sync a workspace with GitHub.

1. Connect GitHub from the desktop app. It signs you in with GitHub's device flow, asks only for the `repo` scope, and creates a private repository named `weaveforge-<name>`. If a private repository with that name already exists under your account, the app uses it. It refuses a public repository, and one owned by someone else.
2. The app uploads the workspace and shows **Uploading your workspace…**, then the status dot reads **Synced <time>**.
3. The **Git remote** section of workspace settings shows **Backs up to** with the repository.

Once connected, the folder syncs by itself:

- about 10 seconds after a folder commit,
- when the app starts,
- every 5 minutes,
- when the window regains focus,
- when the network comes back.

The status dot shows **Synced <time>**, **Syncing…**, **Offline** (it syncs when you are back online) or **Sync failed**, with the time of the next try. After a failure the app waits 30 seconds, then 1 minute, then 5 minutes before it tries again. **Retry** on a **Sync failed** dot clears that wait and runs the sync at once.

### Token and sign-in

- On desktop, the GitHub token stays in this machine's keychain. The page never sees it.
- The app asks GitHub only for the `repo` scope, the narrowest scope that can create a private repository.
- There is no client secret. Sign-in uses GitHub's device flow, which needs none.
- GitHub's code expires (about 15 min). If it expires, the app says **The GitHub code expired. Start again.** Click **Connect GitHub** again.

### When GitHub refuses the token

If the token stops working (for example, you revoked WeaveForge on GitHub), the next pull or push fails. Settings → Workspace folder → Git remote then shows **GitHub needs you to sign in again. Your repository stays the same.** Click **Reconnect**. The app syncs to the same repository. The message clears after a successful sign-in or a successful pull or push.

### Advanced: any git host

**Advanced: any git host, with your own URL and token** lets you paste the URL and token of any https git host instead of using GitHub.

## What is not there any more

- **Offline sync is removed.** There is no offline sync mode and no server sync queue in the app. Your notes are files, so the folder is what you back up or sync.

## Sharing

Sharing and live collaboration still go through the WeaveForge server. See [Collaborative editing](collaborative-editing.md).

## Related

- [The workspace folder](workspace-folder.md): the folder layout.
- [Upgrading to 0.9.8](upgrading-to-098.md): what changed for keys.
- [Collaborative editing](collaborative-editing.md): two people in one document.
