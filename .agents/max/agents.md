# Agents

## Levels (two below you, no deeper)

| Level | Who | Type / model | May spawn? | Does |
| --- | --- | --- | --- | --- |
| 0 | You, the orchestrator | main session, Opus | level 1 | plan, allocate, decide, talk to the user |
| 1 | Lead, one per lane | `general-purpose` or `claude`, Opus | level 2 only | owns a worktree and branch; specs builder edits; reviews their diffs; runs the lane's one build and test pass; commits, pushes, opens a draft PR |
| 1 | Reviewer/researcher, one only | Opus, kept alive with `SendMessage` | no | second review of every lead diff before you call it done; research questions |
| 2 | Builder | `builder` (Haiku) | **never** | exact edits to 1–3 named files, tests first. Never compiles, never runs tests |
| 2 | Scout, reviewer | `scout`, `reviewer` (Haiku) | **never** | read-only; answers with `path:line` |

- A lead's prompt says: "You may spawn subagents for parallel parts. Tell
  each one it must NOT spawn agents."
- Code is written by Haiku builders, or by a lead when a change needs Opus
  judgment. Opus agents otherwise plan and review.

## Caps

- At most 10 Haiku agents at once, plus the one Opus reviewer/researcher.
- Launch independent agents in one message so they run in parallel.
- Keep agents alive and hand them their next task with `SendMessage`; spawn
  only when none fits.
- Keep weekly usage under 70%. Prefer Haiku for anything mechanical.

## Builds and RAM: one cargo at a time

`~/.cargo/config.toml` sets `jobs = 1` and a `rustc-wrapper` that holds a
machine-wide lock, so only one rustc runs at a time. Do not remove it.

- Builders never compile. They run `rustfmt --edition 2024 <their files>`
  only.
- Each lead runs one combined build, test and clippy pass per batch, after
  its builders finish. Leads queue: never two cargo builds at once.
- No `-j`; vitest runs with `--maxWorkers=1`.
- A build killed for low memory: wait 2 minutes, retry detached. Do not stop
  the queue over it.

## Review chain

1. Builder hands back its diff and stops before committing.
2. The lead reviews it (wrong trailers and sloppy edits slipped through
   unreviewed before), then commits.
3. The Opus reviewer reviews the lead's branch diff.
4. You report the lane done only after step 3 and green gates.

## PRs

- One draft PR per lane or batch, not one per builder.
- Lanes that depend on each other stack: each branch starts from the one
  below. Merge the stack to main all at once, and only with the user's OK.
- When CI and review are green, arm
  `gh pr merge N --squash --auto --match-head-commit <sha>` (only for PRs the
  user approved) and move on.
