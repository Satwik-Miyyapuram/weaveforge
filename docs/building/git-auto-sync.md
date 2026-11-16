---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-auto-sync.tsx
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/web/src/features/workspace/test/auto-sync.test.ts
  - apps/web/src/features/workspace/test/git-sync-dot.test.tsx
  - apps/web/src/features/workspace/application/folder-lock.ts
  - apps/web/src/features/workspace/test/folder-lock.test.ts
  - apps/web/src/features/workspace/test/pull-keeps-pulled-files.test.ts
checked: 2026-11-16
---
# Git auto-sync

How the desktop app keeps the workspace folder in step with its git remote
without a button. The user-facing side is in
[Syncing with GitHub on its own](../using/workspace-folder.md#syncing-with-github-on-its-own).

## The parts

| Part | File | Job |
| --- | --- | --- |
| Engine | `apps/web/src/features/workspace/application/auto-sync.ts` | `createAutoSync(deps)`: timers, single-flight, backoff, state |
| Wiring | same file, `wireAutoSync(engine, {onCommit, target})` | shows the engine, starts it, listens for commits, `focus`, `online`, `offline` |
| Host | `apps/web/src/features/workspace/ui/git-auto-sync.tsx` | mounted once in `app-shell.tsx`; builds the engine from the shell bridge |
| Dot | `apps/web/src/features/workspace/ui/git-sync-dot.tsx` | `syncDot(state)` gives tone, text and label; `GitSyncDot` is mounted by the app shell: `tabbar.tsx` (sidebar foot) and `app-shell.tsx` (phone top bar, projects screen) |
| Folder lock | `apps/web/src/features/workspace/application/folder-lock.ts` | one FIFO lock for every folder writer |
| Commit signal | `onVaultCommit` in `workspace-folder.ts` | fires after `runSyncToFolder` made a folder commit |

The engine takes its I/O as `AutoSyncDeps`: `remote()` (the shell's
`vaultSync("settings")`), `sync()` (`pullThenPush` from `parts-2.ts`),
`isOnline()` and `now()`. Tests pass fakes and drive time with
`mock.timers`.

## Rules

- Triggers: `afterCommit` debounces for `AUTO_SYNC_TIMING.afterCommitMs`
  (10 s); `start` runs at once and every `intervalMs` (5 min); `focus` and
  `online` nudge; a folder connected later nudges.
- Single-flight: a request during a run sets one follow-up flag, so any number of
  requests during a run cause exactly one more run.
- Backoff: failures wait `backoffMs` in turn (30 s, 1 min, 5 min, then 5 min
  again). A success resets the count. While a backoff is pending, automatic
  triggers are ignored; `retry()` cancels it and runs at once.
- Offline: a trigger while `isOnline()` is false sets `offline` and runs
  nothing. `setOnline(true)` nudges.
- No remote URL or no token: the state is `off` and nothing is pulled or pushed.
  The host also answers `off` when no desktop folder is connected.
- Failure: a thrown error, a conflicted pull (pushes nothing, says how many
  files), or a rejected push (its reason). All three back off.
- Success: `idle` with `syncedAt` and `pulled` (true for a fast-forward or a
  merge). Pulled files are taken in by the folder watcher as with the **Pull**
  button; the engine applies nothing itself.
- The status dot reads one shared view (`autoSyncView`, `onAutoSyncView`). It
  is a workspace UI file, so only the `app/` layer mounts it (check:solid bans
  cross-feature UI imports). It paints nothing for `off`.

## The folder lock

Every writer of the folder takes `folderLock` (`folder-lock.ts`), a FIFO
promise chain: the mirror (`syncToFolder`), `pullThenPush` (auto sync and the
manual run alike, one hold across pull and push) and, in `folderRemoteSync`,
**Push** and the tree-moving actions (pull, keep mine, take remote, keep both).
Settings, status and connect do not wait. A thrown error releases the lock.

Rule: code that holds the lock never calls another lock-taker, or it waits on
itself. The folder watcher's import (`applyFolderImport`, which calls
`syncToFolder`) therefore stays outside; `reportFolderChanges` only waits for
`folderLock.idle()` before reading the folder.

## Pulled files survive the next mirror

`mirror.json` is committed, so a pull brings the remote's manifest with the
remote's files, and the next mirror would treat a pulled file as unchanged and
overwrite it with the older database copy. `keepMirrorBases` (`parts-3.ts`)
reads the local manifests (the flat one and each project's) before a tree-moving
action and writes them back when the reply says the tree moved (`fast-forward`
or `merged`). A pulled file then differs from its base, so the mirror holds it
back and the watcher imports it. Limits: a project manifest that did not exist
locally is not restored, and a file the remote deleted is written again by the
mirror, as before.

## Tests

```
cd apps/web
node ./scripts/run-tests.mjs src/features/workspace/test/auto-sync.test.ts
node ./scripts/run-tests.mjs src/features/workspace/test/git-sync-dot.test.tsx
node ./scripts/run-tests.mjs src/features/workspace/test/folder-lock.test.ts
node ./scripts/run-tests.mjs src/features/workspace/test/pull-keeps-pulled-files.test.ts
node ./scripts/run-tests.mjs src/features/workspace/test/folder-remote-sync.test.ts
```
