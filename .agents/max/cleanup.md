# Cleanup

Parallel lanes fill the disk fast: each worktree's cargo `target/` holds
several GB. Clean after every batch, not only at the end of the night.

## Rules

- Show the user the list with sizes and get an OK before deleting anything
  that is not your own regenerable output from this session.
- No `rm -rf`, no `Remove-Item -Recurse`. Use each tool's own cleaner.
- Before removing a worktree or branch someone else made, check its age and
  whether its branch is on origin. Never drop uncommitted work silently; list
  it for the user.
- Keep target dirs of active lanes until their phase is done, so later
  batches rebuild only what changed.

## What and how

| What | How |
| --- | --- |
| cargo `target/` of a finished lane | `cargo clean` inside it, while no build runs there |
| Merged worktree | dirty files only `next-env.d.ts` or submodule noise? `cmd /c rmdir` its `node_modules` junctions, then `git worktree remove <path>` (no `--force`), then `git worktree prune` |
| `node_modules.partial-*` | leftovers of a failed `npm ci`; delete after OK |
| Claude temp | old session folders under `%LOCALAPPDATA%\Temp\claude\`; keep the current one |
| Scratch DB copies, Dev workspaces, CI artifact downloads | delete once the check that needed them is done; do not keep backup copies |
| `.next` caches, stage dirs, old `%TEMP%` | delete after OK, or Windows Disk Cleanup |

Keep down the build output in the first place: shell builds share one
`CARGO_TARGET_DIR`, `CARGO_INCREMENTAL=0`, and dev debug info at
`line-tables-only`.
