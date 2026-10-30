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
- Builders: Haiku `builder` agent, one exact spec on 1–3 files, tests first. At most 3 at once, separate files. Lanes, file ownership, shared files and merge order: plan §5.1. Naming, units, errors, tests, docs and commit titles: plan §4.7.
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

Search follow-up (found in P1.8b): the tokenizer splits vowelled Arabic at its harakat (`مُحَمَّد` → `م`, `ح`, `د`), so such words cannot be found as words and `foldArabicDiacritics` does nothing. Inherited from the TS and kept for parity. Fix: treat combining marks as word-internal before splitting, then fold; update the pinned test in `packages/wf-wasm/test/ported-search.test.ts`.

## Progress

Update after every merged PR. A phase is done only when its **done when** is met, with the numbers.

| Phase | State | PRs | Done-when evidence |
|---|---|---|---|
| 0 Foundations | done | #540 (0.1), #541 (0.2), #542 (0.3), #543 (0.3b), #544 (0.3c), #546 (0.4), #545 (0.5) | 0.1: cargo workspace + wf-core skeleton; 6/6 Rust gates green in CI (fmt, clippy, nextest 2 tests, doctest, deny, advisories); pre-push runs 5 offline gates. 0.2: specta bindings to packages/wf-wasm/src/bindings.ts with a staleness gate; 7/7 Rust gates green in CI, nextest 11 tests. 0.3: wf-wasm crate + typed @weaveforge/wasm package (coreInfo); wasm-release build 43,886 B raw / 14,292 B gzip; 4 wasm package tests; build:wasm runs in CI and pre-push; 0.3b: gzip budget (module + JS glue) gated in CI and pre-push, 6 script tests. 0.3c: pkg committed with an input stamp (wasm:fresh gate, glue diffed after the CI rebuild), home paths remapped out of panic locations, name/producers sections removed: 24,431 B raw, 12,676 B gzip with glue, budget 14 KB; Linux CI: "WASM package matches a fresh build", 12.4 KB gzip of 14.0 KB. 0.4: Settings → Data shows "Core 0.1.0" through the generated coreInfo call; glue loaded lazily (async chunk), retry on a failed load; WeaveForge Dev (app://): row "Core 0.1.0", wasm 200 application/wasm, no exceptions; web: generated init + coreInfo returns {"version":"0.1.0"} in a browser over http, and the served build (next start, CSP headers) fetches and compiles the bundled .wasm with no CSP violation. Caveat: the Settings row itself was not opened on web (needs sign-in; no test account). /settings first-load 511,962 B of a 512,000 B budget (base 511,627 B): trim or review the budget before the next Settings change. 0.5: parity harness (`npm run parity -w @weaveforge/wasm`), 8 tests (6 harness, 2 parity), first case coreInfo. Carried to phase 1: decide where parity TS halves live (not apps/web); None→null / map→object shape test with the first Option/map export. Carried to phase 2: reasons for the cargo-deny multiple-versions skip list |
| 1 Search pilot | done | #547 (1.1a), #548 (1.1b), #549 (1.5), #550 (1.3), #551 (1.2), #552 (1.6), #553 (1.4), #554 (1.7), #555 (1.7b), #556 (1.7c), #557 (1.8a), #558 (1.8b) | 1.1a: design doc phase-1-search.md; `js_text` (JS whitespace, letter-or-number, UTF-16 length) and tokenizer `fold`, `process_term`, `is_cjk` in wf-core; 7 tests in search_text.rs against goldens printed from the TypeScript on Node 24 (tests/goldens/search-text.mjs); wasm 24,508 B raw, still under the 14 KB gzip budget. 1.1b: `url_parts`, `tokenize`, `index_terms` (`MIN_TOKEN_UTF16_LEN = 2`, UTF-16 lengths); 7 tests in search_tokenize.rs against Node 24 goldens (tests/goldens/search-tokenize.mjs) plus a 256-case proptest; proptest =1.11.0 workspace dev-dep; nothing exported to WASM yet, 12.4 KB gzip of 14 KB. 1.5: `fuse_rankings` (`RRF_K = 60`, ties on code-point id order instead of `localeCompare`); 10 tests in search_fusion.rs incl. proptest; boundary checks (weights, limit 0, id cap, id→item map) carried to P1.7; WASM unchanged at 12.4 KB gzip. 1.3: query parser with `type:`/`in:`/`modified:` filters (`MAX_MODIFIED_DAYS = 36_500`); 13 tests in search_query.rs against Node 24 goldens (tests/goldens/search-query.mjs) plus 2 proptests; WASM unchanged at 12.4 KB gzip. 1.2: `tokenize`/`indexTerms` WASM exports with typed wrappers; text over `MAX_INDEX_TEXT_UTF16` (2^24 units) rejected in TS before it crosses into WASM; 16 wasm tests; parity 34/34 over 27 texts × 16 option sets in its own `wasm-parity` CI job (Node 24.14.1), also run by pre-push; budget raised to 136 KB for the Unicode tables, at 122.7 KB gzip. 1.6: `build_excerpt` in wf-core (UTF-16 text and highlight offsets, per-char case fold like the TS); 8 tests in search_excerpt.rs against Node 24 goldens (31 cases, each split surrogate half pinned) plus 2 proptests; not yet exported, WASM unchanged at 122.7 KB gzip; 1.4: `parseQuery` WASM export with typed wrapper (`ParsedQuery`, `SearchKind` from specta; `modifiedWithinDays` null when absent), TS-side length cap shared with tokenize; 19 wasm tests, parity 35/35 (26 queries in the TS grammar), WASM 126.1 KB gzip. 1.7: `fuseRankings` WASM export with typed wrapper (`{items, weight?}` lists, `identify` key, item map kept in TS; ties on code-point order); k, limit and weights checked in TS, total ids capped at `MAX_FUSION_IDS` (2^20) before `identify` runs and again in Rust; 30 wasm tests, parity 36/36 (16 fusion runs); WASM 133.2 KB gzip of 136 KB. The committed wasm module is the Linux (CI) build: Windows rustc emits different bytes, so check-wasm-pkg compares the module only on Linux, and a Rust change made on Windows takes two pushes (push the rebuilt pkg, then commit the module from CI's `wf-wasm-pkg` artifact); a second Linux build reproduced the committed module byte for byte. 1.7b: `buildExcerpt` WASM export; 31 goldens; wf-wasm 38/38, parity 37/37; budget 136→142 KB (138.3 KB gzip). 1.7c: ASCII fast paths; `indexTerms` 49.6→17.3 ms (TS 36.8 ms), MiniSearch `addAll` 45.1→38.6 ms (TS 62.4 ms); budget 142→144 KB (513 B headroom). 1.8a: web index, query and excerpts go through WASM; `SEARCH_SCHEMA_VERSION` 4; web 4353/4354, tsc 0, lint 0 errors. 1.8b: TS search core deleted (24 files, +453/−1144); core 1676/1676, wf-wasm 74/74, parity 37/37, web 4359 pass / 0 fail, lint 0 errors. **Done when:** `pdf:index` in WeaveForge Dev (P1.8b build, CDP 9223) 23.9 / 33.5 / 33.0 ms on a 14-page paper (worst long frame 60–63 ms), against the 111 ms bar and the <50 ms target. Caveat: the 223 ms baseline paper is no longer in the Dev workspace, so this compares across papers |
| 2 Desktop on Tauri 2 | in progress | #559 (2.1), #560 (2.2), #561 (2.3), #562 (2.4a), #563 (2.4b), #564 (2.4c), #565 (2.4d), #566 (2.4f), #567 (2.5), #568 (2.6a), #569 (2.6) | 2.1: design doc phase-2-desktop.md (custom scheme, Node sidecar until phase 3, data migration, CORS default with no server change). 2.2: apps/shell Tauri 2.12.5 skeleton (own Cargo workspace and deny.toml) serving the static web build on a custom `app` scheme with host confinement and a CSP; 43 shell tests; `shell` CI job (fmt, clippy, test, deny). 2.3: Node sidecar spike (apps/shell/sidecar): JSON-lines wire with `$bigint`/`$bytes` tags and a 32 MiB line cap, opens the desktop PGlite code unchanged; 32 sidecar tests. Measured on Windows ARM64: ships 97.3 MB raw / 29.6 MB brotli (node.exe 76.8 MB), first query 3.2 s cold, idle private 266 MB, working set 184 MB. x64 re-measure carried to 2.13. 2.4a: Rust sidecar client (apps/shell/src/sidecar.rs): spawns the sidecar in a Windows Job Object (kill on drop), cancel-safe writer task, bounded line reader, request timeout and in-flight cap, reaps the child after an internal kill; 66 shell tests (43 lib + 23 sidecar integration), `shell-windows` CI job. 2.4b: typed DB commands (`db_query`/`db_state`/`db_reset`) exported by tauri-specta into apps/shell/bridge/bindings.ts with a staleness test; transient errors (busy, timeout) are returned as errors, not as a database failure; 81 shell tests (44 lib + 13 commands + 24 sidecar). 2.4c: shell starts the sidecar (dev via tsx, bundled node; Windows `\\?\` prefix dropped from sidecar paths), typed DB commands served, DB part of the bridge shim (not injected yet); 88 shell tests (50 lib + 13 commands + 25 sidecar) + ignored real-sidecar test, 11 bridge tests. 2.4d: sidecar runs the DB lifecycle (open retry, restore from the newest good backup, recover, reset by moving the dir aside, backups every 10 min and on shutdown, `--backups`); a deferred move asks the shell to respawn the sidecar (`restart: true`, generation-guarded, refused after shutdown, probe query after a restart); real `db_reset`; quit grace 15 s (Electron `QUIT_TIMEOUT_MS`); sidecar 43 tests, shell 98 (52 lib + 21 commands + 25 sidecar) + ignored real-sidecar test. 2.4f: real-sidecar lock/orphan test (a second sidecar on a held database fails, the killed shell's sidecar dies, the next start opens the database) runs in CI on Linux and Windows; shell lib 52, commands 21, launch 1 + 2 ignored, sidecar 25. 2.5: one-time Electron data copy with lock, marker and rerun; sidecar 58, shell lib 59, commands 21, launch 1 + 4 ignored, sidecar 25, desktop 605. 2.6a: lane and notation rules (plan §4.7, §5.1). 2.6: wf-store root confinement and vault ops; root 13, vault 21, workspace nextest 98 |
| 3 Storage, sync, offline | not started | | |
| 4 Phones on Tauri 2 | not started | | |
| 5 Server | decide after 3 | | |
