# Rust port: handoff

The plan is [plan.md](plan.md). This file is the run sheet: read it first, keep § Progress current.

## Goal of the run

Do phases **0 → 4** of the plan in one run, in order, without stopping between phases.
Phase 5 (server) is only a decision, made after phase 3: write the recommendation in § Progress and ask the user.

## Branch

- All work is on `feat/rust-port` (cut from main at `3bbf18e3f`, already pushed with these two files).
- Every task PR targets `feat/rust-port`. When CI is green and the reviewer has no open findings, squash-merge it into `feat/rust-port`.
- **Nothing goes into main** until phase 4 is done. Then open one PR, `feat/rust-port` → main, and **ask the user before merging it**.
- Merge main **into** `feat/rust-port` about weekly (main → branch only).

## Where to work

- Work in a worktree on `feat/rust-port`. Ask the user once before creating it (`git worktree add` was denied before); if an existing worktree already has the branch checked out, reuse it.
- The main checkout stays on `fix/B08-blob-view-secret` with three dirty files that must never be committed: `apps/web/next-env.d.ts`, `apps/web/src/deployment/generated-registry.ts`, `apps/web/src/features/papers/infrastructure/zotero-web-api.ts`.
- Pre-push hook in a worktree needs:
  - `export TSX_TSCONFIG_PATH="$(cygpath -w $PWD/apps/desktop)\\tsconfig.json"` (absolute Windows path)
  - `npm run build -w packages/core` first
  - never `--no-verify`
- Merging main in: `docs/atlas.html` and `docs/building/architecture-map.md` always conflict. Take either side, `npm run docs:generate`, `git add` both.
- The full web test suite can run the machine out of memory. Run the tests of the area you changed locally; CI runs the full suite.

## Agents (§5 of the plan)

- The main session (Opus) orchestrates: exact specs, gates, reads every diff, commits, opens and merges PRs into `feat/rust-port`.
- Builders: Haiku `builder` agent, one exact spec on 1–3 files, tests first. At most 3 at once, separate files.
- Reviewer: **one persistent Opus agent** for the whole run. Spawn it once at the start (`Agent`, `subagent_type: general-purpose`, `model: opus`, name `rust-reviewer`), have it read plan.md, then send every PR diff to it with `SendMessage`. Never spawn a second one; only if it is gone, spawn it again the same way.

## Decisions (final, §9 of the plan)

1. Pilot is search, with the kensaku filters.
2. Server move: decided after phase 3.
3. Electron stays one release after Tauri ships.
4. Limits and asserts also go into the TS we keep, sync and storage code first.

## When to stop and ask the user

Do not stop for anything else. Ask only for:
- creating the worktree (once, at the start);
- a production write (database migration, server deploy);
- the phase 5 decision;
- merging the final PR into main;
- something that needs hardware or an account you do not have (an iOS build needs a Mac; signing keys; store accounts). Record it as blocked in § Progress, finish everything else that does not depend on it, then ask.

## Commits and PRs

- `git -c user.email=pandu.satwik@gmail.com -c user.name=S.Miyyapuram commit -s`, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Rules to carry over

- No destructive git commands.
- Never touch the installed WeaveForge app; test in WeaveForge Dev (`.agents/testing.md`).
- Never use Supabase MCP. The database is the OCI Postgres.
- No artifacts, no Vercel. Everything stays local.
- Tests first, and prove nothing else broke.

## After the port

Shortcuts 1–5 and the kensaku UI parts: §10 of the plan. Not before the port is on main.

## Progress

Update after every merged PR. A phase is done only when its **done when** is met, with the numbers.

| Phase | State | PRs | Done-when evidence |
|---|---|---|---|
| 0 Foundations | done | #540 (0.1), #541 (0.2), #542 (0.3), #543 (0.3b), #544 (0.3c), #546 (0.4), #545 (0.5) | 0.1: cargo workspace + wf-core skeleton; 6/6 Rust gates green in CI (fmt, clippy, nextest 2 tests, doctest, deny, advisories); pre-push runs 5 offline gates. 0.2: specta bindings to packages/wf-wasm/src/bindings.ts with a staleness gate; 7/7 Rust gates green in CI, nextest 11 tests. 0.3: wf-wasm crate + typed @weaveforge/wasm package (coreInfo); wasm-release build 43,886 B raw / 14,292 B gzip; 4 wasm package tests; build:wasm runs in CI and pre-push; 0.3b: gzip budget (module + JS glue) gated in CI and pre-push, 6 script tests. 0.3c: pkg committed with an input stamp (wasm:fresh gate, glue diffed after the CI rebuild), home paths remapped out of panic locations, name/producers sections removed: 24,431 B raw, 12,676 B gzip with glue, budget 14 KB; Linux CI: "WASM package matches a fresh build", 12.4 KB gzip of 14.0 KB. 0.4: Settings → Data shows "Core 0.1.0" through the generated coreInfo call; glue loaded lazily (async chunk), retry on a failed load; WeaveForge Dev (app://): row "Core 0.1.0", wasm 200 application/wasm, no exceptions; web: generated init + coreInfo returns {"version":"0.1.0"} in a browser over http, and the served build (next start, CSP headers) fetches and compiles the bundled .wasm with no CSP violation. Caveat: the Settings row itself was not opened on web (needs sign-in; no test account). /settings first-load 511,962 B of a 512,000 B budget (base 511,627 B): trim or review the budget before the next Settings change. 0.5: parity harness (`npm run parity -w @weaveforge/wasm`), 8 tests (6 harness, 2 parity), first case coreInfo. Carried to phase 1: decide where parity TS halves live (not apps/web); None→null / map→object shape test with the first Option/map export. Carried to phase 2: reasons for the cargo-deny multiple-versions skip list |
| 1 Search pilot | in progress | #547 (1.1a), #548 (1.1b) | 1.1a: design doc phase-1-search.md; `js_text` (JS whitespace, letter-or-number, UTF-16 length) and tokenizer `fold`, `process_term`, `is_cjk` in wf-core; 7 tests in search_text.rs against goldens printed from the TypeScript on Node 24 (tests/goldens/search-text.mjs); wasm 24,508 B raw, still under the 14 KB gzip budget. 1.1b: `url_parts`, `tokenize`, `index_terms` (`MIN_TOKEN_UTF16_LEN = 2`, UTF-16 lengths); 7 tests in search_tokenize.rs against Node 24 goldens (tests/goldens/search-tokenize.mjs) plus a 256-case proptest; proptest =1.11.0 workspace dev-dep; nothing exported to WASM yet, 12.4 KB gzip of 14 KB |
| 2 Desktop on Tauri 2 | not started | | |
| 3 Storage, sync, offline | not started | | |
| 4 Phones on Tauri 2 | not started | | |
| 5 Server | decide after 3 | | |
