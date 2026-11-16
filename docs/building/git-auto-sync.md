---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-auto-sync.tsx
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/web/src/features/workspace/test/auto-sync.test.ts
  - apps/web/src/features/workspace/test/git-sync-dot.test.tsx
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
| Dot | `apps/web/src/features/workspace/ui/git-sync-dot.tsx` | `syncDot(state)` gives tone, text and label; `GitSyncDot` sits in the status bar |
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
- The status dot reads one shared view (`autoSyncView`, `onAutoSyncView`), so
  the status bar does not import the folder code. It paints nothing for `off`.

## Tests

```
cd apps/web
node ./scripts/run-tests.mjs src/features/workspace/test/auto-sync.test.ts
node ./scripts/run-tests.mjs src/features/workspace/test/git-sync-dot.test.tsx
```
