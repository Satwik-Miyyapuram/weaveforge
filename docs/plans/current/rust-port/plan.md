# Plan: Rust core + Tauri 2 shells + React UI

Status: proposal. Nothing in the repo changed. Date: 2026-10-29.

## 1. Decision

- **One Rust core, several thin shells.** Not two apps, and not a Rust UI.
- **Core:** search, parsing, sync and merge, the workspace model, git and Overleaf live once, in Rust.
- **Shells:** Tauri 2 on Windows, Mac, Linux, Android and iOS. Each shell loads the same React UI.
- **Browser:** the web app uses the same core compiled to WASM.
- **What stays in TypeScript:** React screens, CodeMirror, PDF.js and ink drawing.

The rule that makes this work is **one source of truth**:
- A piece of logic exists in one place.
- When it moves to Rust, its TS copy is deleted in the same PR.
- TS types for anything crossing the boundary are **generated** from Rust, never hand-written.

## 2. What we measured already (do not re-guess)

Sources: `docs/plans/speed-plan.md` and `docs/internal/design/memory-optimization.md`. Tool: `scripts/perf/baseline.mjs`, which talks CDP on port 9223 to WeaveForge Dev.

| Metric | Baseline 2026-10-18 | Now (Electron 44) |
|---|---|---|
| Idle private memory | 723 MB | 471–507 MB |
| Peak private memory | 1,281 MB | 864–1,101 MB |
| Idle JS heap | 7 MB | — |
| JS heap, ink note open | 124 MB | — |
| Idle per process | — | GPU 236, browser 298, renderer 154 MB |
| Nav p50 / p95 | 79.5 / 151 ms | 65 ms p50 |
| `pdf:page-render` p95 | 544 ms | — |
| `ink:note-paint` | 1,960 ms | — |
| MiniSearch tokenize, `indexPdf` | 223 ms | sliced to 111 ms |
| `ink:parse`, 50 pages | 83 ms | — |
| Embed 1,039 passages, ONNX WASM, 4 threads | ~6 min | — |

**What this means (corrects my earlier "about half the RAM"):**

- **Memory is in Chromium, not in our code.**
  - The JS heap is small, 7 MB idle.
  - The GPU process alone is about 330 MB of ANGLE/D3D11 driver memory.
  - Moving logic to Rust saves little memory.
- **Tauri on Windows uses WebView2, which is also Chromium.**
  - Measured: Tauri 370–399 MB against Electron 312–318 MB ([tauri#5889](https://github.com/tauri-apps/tauri/issues/5889)).
  - Expect about the same RAM on Windows. Only the Node main process (about 70–90 MB) goes away.
  - Mac and Linux use the system WebKit and gain more.
- **Long frames come from layout and paint**, and Rust does not touch those.

**Where Rust wins (realistic):**

| Area | Today | Rust expectation | How we prove it |
|---|---|---|---|
| Embeddings | ~6 min in WASM | native `ort`, maybe NPU: 5–20× faster | time the same 1,039 passages |
| PDF index tokenize | 223 ms | 3–10× faster, off the UI thread | `indexPdf` mark |
| Ink parse | 83 ms / 50 pages | 3–10× faster | `ink:parse` mark |
| Git sync | isomorphic-git / child process | in-process `git2` (libgit2) | sync timing test |
| Installer size | Electron, ~100+ MB | Tauri, ~10–20 MB | file size |
| iOS | online only | offline, local core | feature test |
| Correctness | TS runtime errors | whole bug classes gone (see §3) | defect rate |

Rendering, layout, PDF.js paint and the CodeMirror UI stay the same speed.

## 3. Why Rust helps correctness, and where it doesn't

**It helps.** Google's Android data from Nov 2025 ([blog](https://blog.google/security/rust-in-android-move-fast-fix-things/)):
- About 1000× fewer memory-safety bugs per line.
- A 4× lower rollback rate.
- 25% less review time.
- About 20% fewer revisions.

**It removes:**
- null and undefined errors (`Option`)
- unhandled errors (`Result` plus `?`, and the compiler forces handling)
- data races
- missing match cases (exhaustive `match`)

**It does not remove:**
- logic bugs
- wrong specs
- UI bugs
- bugs in the boundary between Rust and TS

The boundary is the dangerous part. Mozilla found that hand-written wrappers around their Rust core caused "many serious bugs" and crashes, and fixed it by **generating** the bindings ([Mozilla UniFFI post](https://hacks.mozilla.org/2023/08/autogenerating-rust-js-bindings-with-uniffi/)). We do the same.

## 4. How the best teams avoid errors: rules for this project

### 4.1 One source of truth

| Thing | Single source | Everything else |
|---|---|---|
| Data types crossing Rust↔TS | Rust structs + `#[derive(specta::Type)]` | generated `bindings.ts`; CI fails if stale |
| Commands/events (shell IPC) | Rust fns with `#[tauri::command]` + [tauri-specta](https://docs.rs/tauri-specta) | generated typed TS client |
| WASM API | Rust + `wasm-bindgen` + [specta](https://github.com/specta-rs/specta)/`tsify` | generated `.d.ts` |
| DB schema | `db/migrations` (unchanged) | Rust row types checked by tests against the schema |
| Business rules (rank, merge, parse) | `wf-core` | TS only calls them; no copies |
| Constants and limits | one `limits.rs` | exported to TS by the same generator |
| Docs for the IPC API | generated from the Rust doc comments | `check:docs`-style staleness gate |

Same pattern as the existing `docs:generate` / `check:docs`: a generated file is checked in, and CI regenerates it and fails on any diff.

### 4.2 Make illegal states impossible

- **Parse, don't validate.** Turn raw input into a typed value once, at the edge, and pass only typed values inside. Examples: `DocPath`, `VaultId`, `NonEmptyQuery`.
- **Newtypes instead of bare `String` or `u64`:** `PageIndex(u32)`, `ByteLen(u64)`, `DurationMs(u64)`. Put units last in names, for example `latency_ms_max`.
- **Use enums for states, never several boolean flags.** For example, `SyncState::{Idle, Pulling{since}, Conflict{paths}, Failed{err}}`.
- **No `unwrap`/`expect`/`panic!` in library code.** Clippy denies them. Tests may use them.
- **One error enum per crate** using `thiserror`. Errors carry context and never secrets.

### 4.3 TigerStyle rules we adopt

Source: [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md), based on NASA's Power of Ten.

- **Design first.** Each phase starts with a one-page design: data types, invariants, and back-of-the-envelope numbers.
- **Assertions.**
  - Aim for 2 or more per non-trivial function.
  - Check arguments, return values and invariants.
  - Pair them: check both what must happen and what must not.
  - `debug_assert!` covers the hot path; `assert!` covers invariants that protect user data. Those stay on in release.
- **Limit everything.** Every loop, queue, buffer and retry has an upper bound and a named constant.
- **Functions at most 70 lines.** Put `if`s up and `for`s down; leaf functions stay pure.
- **Handle every error.** No ignored `Result`; `#[must_use]` is respected.
- **Warnings are errors from day one:** `-D warnings`.
- **Be explicit.** Pass options instead of relying on library defaults.
- **Zero tech debt.** No TODO is merged without an issue link. Comments say *why*.

### 4.4 Test layers (each catches what the others miss)

| Layer | Tool | Catches | When |
|---|---|---|---|
| Unit + integration + doc tests | `cargo nextest` | logic bugs | every commit |
| Snapshot tests | `insta` | unintended output changes | every commit |
| **Parity / golden tests** | old TS and new Rust run on the same inputs, outputs compared | port mistakes | every port PR, until the TS is deleted |
| Property tests | `proptest` | edge cases nobody thought of (merge, parse, rank) | every commit, 256 cases; nightly 10k |
| Fuzzing | `cargo-fuzz` + `Arbitrary` | crashes and hangs on hostile input (PDF text, BibTeX, markdown, git packs) | nightly |
| Deterministic simulation | seeded fake fs/clock/network with fault injection, in the style of TigerBeetle [VOPR](https://docs.tigerbeetle.com/about/vopr) | sync and data-loss bugs; any failure replays from seed + commit | nightly, for `wf-store` sync |
| Crash tests | kill mid-write, reopen | torn writes | phase 3 |
| Mutation testing | [cargo-mutants](https://mutants.rs) | tests that check nothing | weekly; needs non-flaky tests first |
| Existing TS tests + e2e | unchanged | UI regressions | every commit |
| Perf gate | `scripts/perf/baseline.mjs` | slowdowns, memory growth | end of each phase |

### 4.5 Gates (pre-push + CI; nothing merges red)

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings -D clippy::unwrap_used -D clippy::expect_used -D clippy::panic`, plus a chosen pedantic subset
- `cargo nextest run`
- `cargo deny check`: licences compatible with AGPL-3.0, no known advisories, no duplicate major versions
- Bindings staleness check: regenerate and fail on any diff
- WASM size budget, alongside the existing `check-bundle-budget`
- `#![forbid(unsafe_code)]` in `wf-core`. Any `unsafe` elsewhere needs a `// SAFETY:` comment and a test.
- Existing gates stay: check-solid, check-dry, check:boundaries, typecheck, tests.

### 4.6 Process rules

- **Small PRs.** One concern each, about 400 changed lines or less, stacked if needed.
- **Tests first.** A failing test lands in the same PR before the code that makes it pass.
- **Strangler pattern.** The new Rust path sits behind the old interface, parity tests prove they match, then the switch is made and the old code deleted. The app works after every PR.
- **No big-bang rewrite.** The Electron build stays shippable until the Tauri build passes every desktop test. Keep it one release as a fallback.
- **One integration branch: `feat/rust-port`.**
  - Cut it from main once, at the start of phase 0.
  - Every task and phase PR targets `feat/rust-port` and merges there.
  - **Nothing merges into main until phases 0–4 are all done.** The end is one final PR, `feat/rust-port` → main.
  - Merge main **into** `feat/rust-port` about weekly (only in that direction), so the final merge stays small.
  - Normal fixes keep landing on main the whole time.

### 4.7 Conventions (one notation everywhere)

Every crate, test, doc and commit in the port follows these. A spec that needs something not listed here adds it to this table first, in the same PR, so the next spec reuses it. Where a name is ported from TypeScript, the ported name wins over the general rule, so a grep finds both.

**Rust code**

| What | Rule | Example |
|---|---|---|
| Modules | one area per file, singular snake_case | `wf_store::vault`, `apps/shell/src/sidecar.rs` |
| Error types | one enum per module area, named `<Area>Error`, derived with `thiserror` (a workspace dep at the root; `apps/shell` adds it as an orchestrator edit in the first lane that needs it); variants say what failed, no `Error` suffix | `VaultError::Escape`, `RootError::NotAFolder` |
| Error texts a person sees | copied word for word from the TypeScript they replace, pinned by a `*_texts_match_*` test | `"That is not a folder."` |
| Errors at the IPC edge | every command returns `Result<_, ShellError>`; module errors convert with `From` | `impl From<VaultError> for ShellError` |
| Constants | SCREAMING_SNAKE, unit last, then `_MAX`/`_MIN` | `READ_BYTES_MAX`, `WATCH_DEBOUNCE_MS` |
| Units | inside a crate, the §4.2 newtypes (`ByteLen(u64)`, `DurationMs(u64)`, defined once in `wf_core::units`, which the orchestrator adds in the prep PR before 2.7), `Duration` and `SystemTime`; bare `u64` with the unit last in the name only at the IPC edge. `wf-core` derives `specta::Type` only behind its `specta` feature (on in `wf-bindings` alone), so `apps/shell` depends on `wf-core` and `wf-store` although it pins specta `rc.26` through tauri-specta; the shell uses the newtypes inside too | `size: ByteLen` inside, `size_bytes: u64` over IPC |
| Paths | inside: `PathBuf`; across IPC: `/`-separated workspace-relative `String`, checked once by `wf_core::workspace::safe_workspace_path` | `"notes/a.md"` |
| IPC shapes | match the Electron channel being replaced (field names, units, null vs missing), stated in the command's doc comment | `DbState` |
| Commands | `#[tauri::command]` named `<area>_<verb>`; TS gets camelCase from tauri-specta | `vault_read` → `vaultRead` |
| Events | `<area>:<event>`, payload a `specta::Type` struct | `vault:changed` |
| Docs | `//!` on every module, `///` on every pub item; first line one sentence ending in a period; comments say why | |
| Limits | every loop, queue, buffer and retry has a named constant (§4.3) | |

**Tests**

| What | Rule |
|---|---|
| Names | snake_case sentences of the behaviour, no `test_` prefix: `a_file_is_not_a_folder` |
| Place | unit tests in a `#[cfg(test)] mod tests` at the end of the file; tests of the public API in `tests/<area>.rs` |
| Shared helpers | one copy per crate in `tests/common/mod.rs` (temp dirs, fixtures); never copied into a second file |
| Temp folders | the crate's `TempDir` helper in `tests/common/mod.rs` (unique name, removed on drop; `apps/shell` has one too); never a fixed path |
| Platform skips | skip with a printed reason (`eprintln!`), never a silent pass |
| Ported tests | keep the TS test's name as a comment above the Rust test |

**Docs**

- Plain English, short sentences, as in the existing phase docs.
- Steps are written `2.6`, sections `§5.1`, files in backticks and repo-relative.
- Numbers use a thousands comma (`1,039`), a space before units (`510 MB`, `8 MB`), an en dash for ranges (`3–4 weeks`).
- Each phase doc has: Scope, Steps, Lanes, Done when, Risks.

**Git**

| What | Rule | Example |
|---|---|---|
| Branch | `rust/p<phase>-<step>-<slug>` | `rust/p2-6-vault` |
| Worktree | scratchpad `wt-p<phase><step>` | `wt-p26` |
| Commit and PR title | conventional commit, step last | `feat(store): vault root confinement and file ops (P2.6)` |
| Scopes | `core`, `store`, `wasm`, `bindings`, `shell`, `sidecar`, `bridge`, `rust-port` (docs) | |

**Known drift.** Names written before this section stay until their file is next touched; then the touching step fixes them. Listed so nobody copies them:
- `SidecarError` in `apps/shell/src/sidecar.rs` writes `Display` by hand.
- Constants with `MAX_` first: `MAX_IN_FLIGHT`, `MAX_REPLY_BYTES` (`apps/shell/src/launch.rs`), `SIDECAR_MAX_LINE`, `MAX_REASON_CHARS` (`apps/shell/src/sidecar.rs`), `MAX_INDEX_TEXT_UTF16`, `MAX_FUSION_IDS` (`crates/wf-wasm/src/lib.rs`). `MAX_MODIFIED_DAYS` in wf-core keeps its ported name.
- Shell tests use fixed pid-based temp paths instead of a `TempDir` helper (`apps/shell/src/protocol.rs`, `apps/shell/tests/commands.rs`, `apps/shell/tests/launch.rs`).
- `wf_store::vault::Entry::size` is a bare `u64`; 2.7 moves it to `ByteLen` when it maps `Entry` to IPC.
- `UnsafePath` in `crates/wf-core/src/workspace.rs` is a struct with a hand-written `Display`, not a `thiserror` `<Area>Error` enum.
- Commit titles before §4.7: "Rust port 2.5: …" (#567), "… (2.4f)" (#566), "(2.4c)" and "(2.4d)" without `P`.

## 5. Agent workflow (Haiku builders, Opus reviewer, orchestrator)

| Role | Model | Does | Never does |
|---|---|---|---|
| **Orchestrator** (the main session) | Opus | splits the phase into tasks; writes the exact spec for each (files, signatures, tests to make pass); runs the gates; reads every diff; commits; opens PRs | hands off vague tasks |
| **Builder** | Haiku (`builder` agent) | applies one exact spec to 1–3 named files; writes the listed tests first | design, scope growth, touching other files |
| **Reviewer** | Opus, **persistent** (one agent per session, read-only) | reviews each PR diff against the spec and the §4 rules: correctness, missed edge cases, limits and asserts, single source of truth, secrets | edits code |

**One task cycle:**
1. The orchestrator writes the spec. It contains the goal, the files, the Rust signatures, the invariants, the test names with their inputs and expected outputs, and the done-when check.
2. A builder (Haiku) writes the tests first, then the code, then runs `cargo nextest` on that crate.
3. The orchestrator runs all the gates and reads the diff line by line, following the "verify Haiku work" rule.
4. The persistent reviewer (Opus) reviews the PR diff. It is sent each diff with `SendMessage`; it is not spawned again.
5. The orchestrator fixes findings, or sends them back to the builder with an exact spec.
6. The orchestrator commits with DCO sign-off, pushes, and opens the PR against `feat/rust-port`. When CI is green and the reviewer has no open findings, the orchestrator squash-merges it into `feat/rust-port`. Never into main.

**Parallelism:** at most 3 builders at once, each on separate files in its own worktree. The orchestrator does all merging. The rules are in §5.1.

### 5.1 Parallel lanes without conflicts

A **lane** is one step (one PR) in flight: its own branch off the tip of `feat/rust-port`, its own worktree, and at most one builder working in it at a time. At most 3 lanes run at once.

**Picking lanes.** Two steps run together only when neither needs the other's code. Each phase doc lists its steps in a Lanes table; a step starts when every step it needs is merged. A step that calls an API not merged yet waits; it is never built against a stub of another lane.

**File ownership.** Every spec lists the files its builder may create or edit. A file belongs to at most one active lane. Before starting a builder, the orchestrator compares the spec's list with the other active lanes' lists and with their `git diff --name-only origin/feat/rust-port...HEAD`. Any overlap means the step waits. Each step puts its code in files of its own (§4.7: one area per file), and no step grows a file that another lane owns.

**Shared files: builders never edit them.** The orchestrator makes these edits in the lane's branch, by hand, limited to the lines that step adds:

| File | Shared because | How a lane changes it |
|---|---|---|
| root `Cargo.toml`, `apps/shell/Cargo.toml` | every member and dependency | orchestrator adds the line before the builder starts |
| `Cargo.lock`, `apps/shell/Cargo.lock` | generated | never hand-merged: take `feat/rust-port`'s copy, re-resolve with `cargo metadata`, rerun the gates; if a lane's new dependency moved, pin it back with `cargo update -p <crate> --precise <tested version>` |
| `crates/*/src/lib.rs`, `apps/shell/src/lib.rs` | module list, plugin setup | orchestrator adds the `pub mod` or `.plugin(...)` line |
| `apps/shell/sidecar/src/main.ts` | the sidecar's request dispatch | orchestrator wires a lane's `api*.ts` handler in |
| `crates/*/Cargo.toml`, `apps/shell/Cargo.toml` members | dependencies of a crate several lanes build in | orchestrator adds the line before the builder starts |
| `crates/*/tests/common/mod.rs`, `apps/shell/tests/common/mod.rs` | the crate's one copy of test helpers (§4.7) | orchestrator adds a helper; builders only call them |
| `apps/shell/src/commands.rs` `specta_builder()` | the one list of commands | orchestrator adds the step's names to `collect_commands!` |
| `apps/shell/bridge/bindings.ts` | generated from that list | never hand-merged: regenerate with `WF_UPDATE_BINDINGS=1 cargo test --test commands` |
| `apps/shell/src/protocol.rs` | the custom scheme's routing | relays live in their own modules; orchestrator adds the routing lines |
| `apps/shell/tauri.conf.json`, capabilities | one config | orchestrator edits |
| `deny.toml`, `apps/shell/deny.toml` | one policy | orchestrator edits, a reason per skip |
| `handoff.md` § Progress, phase docs, plan §4.7 | one log, one notation | orchestrator edits (see Progress) |

A new third-party crate goes in only after `cargo deny` passes (`multiple-versions = "deny"`). When more than one lane of a wave adds crates, the orchestrator adds all of them in one prep PR into `feat/rust-port` before the wave starts (one `cargo deny` run over the combined graph); lanes never add crates themselves.

**Merging.** PRs merge into `feat/rust-port` one at a time, in the order they go green. After each merge, every other open lane merges `origin/feat/rust-port` into its branch (a merge, not a rebase, so no force push). The orchestrator resolves only the shared files above, regenerates lockfiles and bindings, and reruns the gates before that lane's PR may merge.

**Progress.** Each PR adds its own `handoff.md` § Progress entry in its own branch, once its PR number is known and its counts are verified. Entries added in parallel conflict only as adjacent lines; keep both, in merge order.

**Machine load.** Each lane builds in its own `target/`. With 3 lanes running, builders run cargo with `CARGO_BUILD_JOBS=2`. If memory runs short, drop to 2 lanes; never stop another lane's build.

**Review.** The one reviewer gets each lane's diff when that lane is ready. Diffs queue; they are never batched across lanes.

**Live state.** The orchestrator keeps the table of active lanes (step, branch, worktree, owned files) in its scratchpad. A new session rebuilds it from `git worktree list` and `gh pr list --base feat/rust-port`.

**The persistent reviewer:**
- Spawned **once** per session, at the start, with `Agent` (`subagent_type: general-purpose`, `model: opus`, name `rust-reviewer`). Its first prompt: read this plan (§4 rules, the current phase), then wait for diffs. It edits nothing. At each new phase, send it the phase number so it rereads that phase.
- Every later review goes to the **same** agent with `SendMessage` (to `rust-reviewer`): the spec, the diff (`git diff feat/rust-port...HEAD`), and the gate results. It keeps what it learned about the phase, so it catches drift across PRs.
- Output: one line per finding, `path:line: severity: problem. fix.` No praise.
- Never spawn a second reviewer in the same session. If it is gone (session ended), spawn one again the same way.

**Run:** one session runs all phases, 0 → 4, in order, without stopping between them. Context compaction handles length. A phase starts only when the previous phase's **done when** is met and recorded in `handoff.md` (§ Progress). If a session ends early, the next one reads `handoff.md` and resumes at the first phase not marked done.

## 6. Target layout

```
crates/                        Cargo workspace
  wf-core       pure logic: search, parse (md, BibTeX, ink), merge, workspace model. No I/O. forbid(unsafe)
  wf-store      native I/O: files, blobs, git (git2), Overleaf git bridge, embeddings (ort)
  wf-wasm       wf-core → WASM for the browser
  wf-bindings   one binary: writes bindings.ts from all specta types/commands
apps/shell      Tauri 2 app: desktop + Android + iOS; plugins: stylus overlay (Kotlin), fs, git
apps/web        React UI; imports generated bindings only
```

## 7. Phases

Each phase lands on `feat/rust-port`, and the app on that branch works after every one. Main gets the whole port in one final PR after phase 4. Phase 5 is optional and comes later.

### Phase 0: Foundations (about 1 week)
- Cargo workspace and `rust-toolchain.toml` (pinned version).
- All the §4.5 gates, wired into pre-push and CI.
- `wf-bindings` generator and its staleness check.
- `wf-wasm` builds, and the web app calls one function (`wf_core::version()`) through generated types, tested.
- Parity test harness: a Node script that feeds the same JSON fixtures to TS and Rust and diffs the outputs.
- **Done when** all gates run and are green on an empty core, and one generated call works on web and in Electron.

### Phase 1: Pilot, search (about 2 weeks)
- Port the pure parts of `packages/core/src/search`: tokenizer, query parser, rank fusion and excerpts.
- Add kensaku-style filters in the new parser: `type:`, `in:`, `-word` and `modified:7d`.
- Parity tests on golden fixtures, and proptest for the parser (it never panics, and a parse round-trips).
- **Done when:**
  - the palette uses Rust ranking on web and desktop
  - the TS ranking is deleted
  - `indexPdf` tokenize is at most 111 ms, and if possible below 50
  - every gate is green.

### Phase 2: Desktop shell, Electron → Tauri 2 (about 3–4 weeks)
- Port `apps/desktop/src` (fs IPC, git file sync, Overleaf sync, Workshop relay) to `wf-store` plus Tauri commands. Keep **the same IPC contract**, now generated, so the React UI does not change.
- Move embeddings to native `ort`.
- Run the e2e suite on WebView2 (Windows) and on WebKit (Mac and Linux). WebKit differs from Chromium.
- **Done when:**
  - the existing desktop tests pass on the Tauri build
  - `baseline.mjs` shows no regression in nav p50, and idle private memory at most 510 MB on Windows
  - installer size is measured
  - embedding the 1,039 passages takes under 1 minute.

### Phase 3: Storage, sync and offline engine (about 4 weeks; highest risk)
- Port the storage, sync and offline-sync parts of `packages/core`.
- Simulation tests with fault injection: a fake fs, clock and network that can drop or reorder, plus a kill at every write point.
- proptest checks merge invariants:
  - it is commutative where the spec says so
  - it never loses a line from either side without a conflict marker.
- Fuzz the git pack and file parsers.
- **Done when:**
  - the old sync tests pass on Rust
  - 10k proptest cases and a nightly seed run come back clean for 7 days
  - crash tests show no torn file.

### Phase 4: Phones on Tauri 2 (about 3–4 weeks)
- **Android:**
  - The Kotlin `InkingOverlayView` becomes a Tauri plugin. The Kotlin code is kept and the WebView is reached through the plugin `load` hook ([Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/)).
  - Spike it first, because overlay z-order and passing touches through to the WebView are not documented.
- **iOS:** the app ships the bundled UI and the core, so it works offline.
- **Done when:**
  - the phones have the same feature list as desktop
  - ink latency is at most today's overlay
  - offline open, edit and sync work on iOS.

### Phase 5: Server (optional; decide after phase 3)
- Move the Next.js API routes to axum only if there is a clear reason, such as sharing code with the core or measured speed. Otherwise keep them.

## 8. Risks

| Risk | Mitigation |
|---|---|
| WebKit (Mac/iOS) behaves differently from Chromium | e2e on WebKit from phase 2; feature checks, not browser sniffing |
| Android overlay can't sit over the Tauri WebView | phase 4 starts with a 2-day spike; fallback is to keep the Kotlin shell + Rust core via JNI |
| Two copies of logic during a port | parity tests + delete the TS copy in the same PR as the switch |
| Boundary bugs | generated bindings only; async calls; no hand-written glue |
| Rust learning curve slows reviews | small PRs, strict clippy, the Opus reviewer reads everything |
| Memory does not improve on Windows | expected (§2); the goal there is speed, size and correctness, not RAM |
| Data loss in the sync port | simulation + crash tests gate phase 3; Electron fallback for one release |

## 9. Decisions (answered 2026-10-29)

1. Pilot: **search**, including the kensaku-style filters.
2. Phase 5 server move: **decide after phase 3**.
3. Electron: **kept for one release** after Tauri ships, then removed.
4. Limits and assertions also go into the TypeScript we keep: **yes**, starting with the sync and storage code.

## 10. After the port (not before)

Doing these now in TS is wasted work, so they wait for the port to land on main.

- **Shortcuts 1–5** (already shipped by #538: `Ctrl+/` sheet, `Ctrl+Shift+T`, `F2` on explorer rows):
  1. `F2` renames the **active document**, not only the explorer row.
  2. `Ctrl+Shift+B` toggles the app sidebar.
  3. `Ctrl+D` duplicates the current note; inside CodeMirror text it stays "select next match".
  4. `Ctrl+Shift+P` command palette. Recommended: the `Ctrl+K` palette in commands mode. Ask the user first.
  5. `Ctrl+Shift+F` workspace search on desktop and mobile; focus mode moves to `F11` (approved).
  - Tests first per key (inside and outside the editor, no CodeMirror clash). Update the `Ctrl+/` sheet in the same PR. Prove it in WeaveForge Dev.
- **Kensaku-style filters** (`type:`, `in:`, `-word`, `modified:7d`, sort, recent-weighted ranking, Space to preview): the parser part is built in Rust phase 1. The UI parts left after the port (sort control, Space preview) come here.
- **Grouped AI suggestion review** (user request 2026-10-31: approving one by one is too hard): group pending AI proposals (by document and by kind) in `ai-proposal-review-screen.tsx`, with approve-all / reject-all per group and for everything, plus undo. Tests first: grouping, bulk approve applies every proposal once, a failed apply leaves the rest pending.
- **Import papers from a `.bib` file** (user request 2026-10-31): pick a BibTeX file and add each entry to the papers library (title, authors, year, venue, DOI, URL, citation key, abstract), skipping duplicates by DOI or citation key and reporting the skipped and broken entries. Reuse or extend `packages/core/src/features/report/domain/bib-entries.ts`; the parser goes in Rust (`wf-core`), since the port is done by then. Tests first with real exports (Zotero, Mendeley, Google Scholar, Paperpile).
- **Paperpile import** (user request 2026-10-31): Paperpile has no public API; it exports BibTeX and can keep a `.bib` synced to Google Drive. So it is the `.bib` import plus a "From Paperpile" entry that explains the export, and optionally re-importing a chosen synced `.bib` file. Ask the user before adding any Google Drive access.

### Found during the port (reviewers, look-back reviews, user reports)

Reviewers check every diff against `qol-rubric.md`; the number in brackets is the rubric item. `[bug]` items that the port itself must fix are scheduled in a phase and marked so; the rest wait for this section.

**Bugs**

- **Note edit then status change is lost** (user report 2026-10-31, rubric 2, 9). `UpdatePaperUseCase.mutate` (`packages/core/src/features/papers/application/update-paper.use-case.ts:131-143`) reads, changes and saves the whole row with no version check, and `PostgrestPaperRepository.save` upserts every column including `status`. A summary save that started before a status change writes the old status back. Test first in `packages/core/test/features/papers/update-paper.usecase.test.ts` with a gated fake repo: start `setSummary`, park it at `getById`, run `setStatus("read")`, release, assert both the status and the summary survive. Fix: write only changed fields, or a conditional update as `replaceSummary` does. Also check the stale snapshot via `onReplace` (`papers-list.tsx:199-206`) and the offline queue replaying full rows.
- **Vault files edited outside WeaveForge are not picked up** (user report, rubric 6). In Tauri `vault_watch.rs` has no caller, no `notify` dependency and no event to the page, so nothing reloads. The echo filter (`vault_watch.rs:52-66`) is path plus a 2 s window, so a real edit right after an app save is dropped. Scheduled in batch 2.12e: wire the watcher, compare content hash or mtime, reload a clean open note in place, offer keep-mine / take-theirs / merge for a dirty one. No click needed.
- **Blind vault writes** (`vault.rs:200-216`, rubric 2, 3) can overwrite an external edit made since the note was read. Check hash or mtime before writing (2.12e).
- **Pull conflicts are only a sentence** (`vault_sync.rs:253-293`, `folder-remote-sync-panel.tsx:65-69`, `git-remote.ts:108-109`; rubric 1, 10). No keep-mine, take-remote or keep-both, the remote copy is unreachable, and the same conflict repeats every sync. `folder-remote-sync.ts:14-15` wrongly says the watcher imports pulled files.
- **A failed update check reads "up to date"** (`desktop-update-panel.tsx:117`, `update_check.rs:101-135`; rubric 13). Return an error and say "Could not check for updates. Try again."
- **Main-thread reindex on every write** (`workspace-search.ts:234,247`; rubric 26). One note or paper save re-projects, rebuilds the wiki graph and re-tokenizes every note. Likely over 100 ms at 10k notes; measure on the large fixture and make it incremental.
- **Joiner gets 502 when the leader's model store fails** (`model_cache.rs`). Fall back to its own download.

**Missing reach or wiring**

- `vault_search` is not registered in `commands.rs` and has no web caller; it re-reads every note per query (`vault_search.rs:60-80`; rubric 20-22, 26).
- Bridge gaps in `apps/shell/bridge/desktop.ts`: Mattermost sign-in and post, Overleaf sync and read (`overleaf_links.rs:155` is a stub), vault search, preference read (rubric 24).
- `write_local_artifact` has no production caller (rubric 22). Wire it to the SDK upload path or remove it.
- Command palette lacks Check for updates, Documentation, workspace folder actions, Show in file explorer and Keyboard shortcuts; rows show no shortcut hint (`jump-to-palette.tsx`; rubric 20). Help menu has no Keyboard shortcuts entry (`menu.rs:286-296`).
- Plan widget toggle, ink-unavailable reason and haptics setting need menu, palette and settings entries (rubric 20, 21).
- No UI lists, sizes or clears the artifact store, model cache or logs (rubric 22, 33).

**Feedback and progress**

- TeX compile runs up to 300 s with no progress or Cancel (`tex.rs:449`, `project-checks.tsx:96-118`; rubric 11). Add a cancel command (kill on drop) and elapsed time.
- PDF library indexing passes no AbortSignal and has no Cancel (`library-pdf-indexing.tsx:77`; rubric 11). A 2,000-paper run takes about 100 min. Status shows only in Settings (rubric 7).
- Model download shows no progress or Cancel, loads whole files into RAM per joiner (up to 512 MiB) and restarts instead of resuming from `.part` (`model_cache.rs:200,240`; rubric 11, 28). No size limit on the models folder.
- Raw OS and reqwest text reaches users: `fetch/safe.rs:295-311`, `sidecar.rs:324,384`, the TeX spawn error (`tex.rs:427-449`), `update_check.rs` codes (rubric 13). Plain words, detail to the log.
- `INK_NOT_AVAILABLE` gives no next step (`ink.rs:27,343`); say where to turn handwriting on. Ink availability is cached as false for the session (`recognisers.ts:65-70`); re-probe (rubric 10). Helper ready line without a version is not logged and its stderr is dropped (`ink.rs:640`).
- Sync status has no live region (`folder-remote-sync-panel.tsx:107`; rubric 15). Pull-first takes two clicks (rubric 16, 19). The search worker falls back silently (`workspace-search.ts:162`; rubric 13).
- Update check runs on every Settings mount with no off switch (`desktop-update-panel.tsx:31,65`; rubric 34).
- `read_at` (`repo.rs:253`) has no UI, so earlier file versions cannot be viewed or restored (rubric 1, 22).

**Artifacts**

- A missing, refused or 404 artifact renders nothing or a broken image; show a placeholder with its name, "not on this computer", and Retry (`experiment-panels.tsx:120,154`; rubric 13, 14).
- Desktop-local `app://artifacts/` entries are dead links on web and phone; label them "on desktop only" until synced (rubric 24).
- PDF artifacts download instead of opening in an in-app pdf.js view (rubric 18).
- `serve_local_artifact` reads the whole file and ignores Range (`local_artifacts.rs:113`); use `range::serve_file` (rubric 28). The writer has no 25 MB cap and nothing is cleaned when an experiment is deleted (rubric 33).

**Vault folder (from 2.7b and batch K reviews)**

- A re-watch that fails after a refused pick is dropped silently; say the folder is no longer watched (rubric 13).
- While adopting a new folder the old one is not watched for a moment; edits in that gap are missed.
- The old watcher is joined while the vault lock is held; a slow join stalls every vault command.
- A second folder pick while one is open reads like a cancel; return "busy" with a reason (rubric 13).
- A `vault_write` racing an adopt is reported as an outside change.
- No "folder not available: retry or choose another" screen when the remembered folder is missing (rubric 10).
- `Choice.warnings` (for example a `WeaveForge/` folder nested in the pick) never reach the page; show them (rubric 7).
- `forget` is not wired: add "Disconnect folder" in Settings (rubric 30).
- Every note open in an editor holds its outside edits, even with nothing unsaved; hold only notes with unsaved typing (rubric 2).
- Taking outside edits in is silent; show "3 outside edits taken in" with an undo (rubric 7).
- The review list does not say why each held edit was held (both changed, removed, open in an editor); show the reason per row (rubric 13).
- Each auto-apply previews the whole folder; preview only the changed paths, and back off while edits keep coming (rubric 26).
- `claimImportedFile` can claim a file that two notes point at; check for a duplicate before claiming.
- `Sidecar::spawn_with_host` has no caller until 2.8b-2/3 wire the host.
- The moved-since-preview base guard in `refreshMirrorBase` has no unit test; web tests cannot swap the container. Add a container override for tests.
- An outside edit held because its note was open waits for the next folder event; schedule an auto-apply when the last hold on a held note is released (rubric 1, 3).
- A file that moved again mid-apply keeps its old base, so its next plain folder edit reads as "both" and is held; record the applied digest as base instead (rubric 1).
- The workspace side of an auto-apply has no compare-and-set: a workspace write to a closed note between preview and apply (server sync, an agent, a late editor flush) is overwritten. Compare the note's digest with the preview's before each update and hold it if it moved.
- A note renamed or moved in the folder (same id, new path) is held like a copy. Tell a rename (old path gone) from a copy and take renames in without asking (rubric 1, 13).
- A note held only because it is open looks like a conflict in the folder panel. Label it "held: open in editor" (rubric 13).
- Nothing says outside edits were taken in. Show the applied count as a toast or a panel line (rubric 7, 13).
- Every auto-apply run reads the whole folder. Preview only the changed paths, or back off while changes keep coming (rubric 8, 26).
- If `claimImportedFile` fails after a create, the next run may create the note again (not verified). Claim first, or make the claim idempotent (rubric 1).
- Held outside edits (removed, edited on both sides, no record of the app's write) still need a click on Review; offer keep-mine / take-theirs inline (rubric 1, 10).
- Re-hash on every event: skip when size and mtime match the last digest (rubric 26).
- The 2 s max wait can read a file still being written by a slow program.
- The watch dies when the folder is renamed or the drive unplugged; detect and re-watch or say so (rubric 13).
- No UI for the model store or the cache size (rubric 30).
- Entries refused by the import (bad names, too big) vanish from the list without a reason (rubric 13).
- The `.weaveforge.bak` copy of a rewritten editor MCP config is never removed and may hold other servers' API keys (it keeps the original's mode since batch M); remove it once the rewrite is verified (rubric 1).
- Rewritten and skipped editor MCP configs are only logged; show them in the UI with the `.bak` path (rubric 7, 13).
- JSONC editor configs are skipped; rewrite them with `jsonc-parser` `modify`/`applyEdits` so comments survive.
- `host.rs` `HOST_URL_PREFIXES` and `mcp-connect.ts` install links can drift; add a cross-check test.
- Merge the shell integration tests into one test binary: each `tests/*.rs` links Tauri on its own (about 100 MB of debug info each).

**Other**

- Plan widget falls back to the first work area, not the primary one.
- Vault watcher: show a short "folder changed, N files reloaded" note (rubric 7).

**Embeddings (2.11)**

- transformers.js 4.3.0 cuts a long text after adding special tokens, so its closing `[SEP]` is lost. The native encoder (`crates/wf-store/src/embed.rs`) copies this so stored vectors stay comparable. If the index is ever rebuilt with the native encoder only, keep `[SEP]` (HF truncation) and re-embed.
- `MAX_TOKENS` is a fixed 512, right for both known models. transformers.js uses each tokenizer's `model_max_length`; read it (or `max_position_embeddings`) per model before adding a model with a smaller limit.
- The model id, pooling and query prefix live in both `crates/wf-store/src/embed.rs` and `apps/web/src/features/search/infrastructure/embedding-models.ts`. Pass them from the page or add a test that both lists agree (rubric 24).
- The model download shows no progress, cannot resume and has no size cap; the model cache has no UI to list or clear it (rubric 11, 22, 33).
- `embed.rs` load gate: make it per model (or hold it only around the open, not `ensure_files`) so an upgrade download never stalls a reload of the serving model; with no network timeouts yet (2.10d) a stalled download holds its gate indefinitely.
- `embed_unload` should take the load gate, so an unload racing a load cannot leave the model loaded.
- Two `NativeEmbedder`s sharing a model id unload each other on `dispose()`; refcount on the shell side.
- `upgradeInBackground`'s catch can dispose twice after `loadWithFallback` already released both.
- `NOT_LOADED` is matched as a string across Rust and TS; use a typed `ShellError` code.
- An `ensure_files` failure is not written to the app log.
- The shelf of loaded models has no cap (cap at 2, LRU of unheld entries, or reject unknown names); the load-gate map never shrinks.
- The native-to-worker fallback is not shown in the status, and `loadWithFallback` takes no `AbortSignal`.

**Desktop shell (2.13)**

- Mattermost sign-in popups, and script-driven main-window navigations to outside pages, open browser tabs with no throttle; share one cap of one per second.
- An app-made `blob:` popup (the compiled TeX PDF) opens as a plain window with no bridge and no navigation guard, and nothing logs it. WKWebView and WebKitGTK may open nothing for the default popup, and WebKitGTK has no PDF viewer; verify on each OS, and if it fails show the PDF in the page.
- A `mailto:` link is refused and logged (Electron parity); hand it to the OS mail app so it does something.
- The Mattermost window's `on_new_window` still uses its own http(s) check; route it through `open_outside` so one URL-shape rule covers every outside open.
- `shim::is_app_blob` allows app-made blob popups of any type; drop the `Allow` branch once the PDF shows in the page.
- Unlinking an Overleaf folder leaves its `overleaf-git` directory; prune orphans on unlink.
- A refused paste or an empty clipboard gives no feedback; toast it.
- Page-command strings (`edit-*`, `choose-workspace`, `search`) are spelled in Rust and TS; share one list or test them against each other.
- No test kills a TeX engine's whole process tree (Job Object / process group); add one with a child that spawns a grandchild.
- Overleaf sync edge cases untested: conflict on pull, push rejected as behind, status on an unborn branch, token redaction in a failed fetch.
- `wf-store` `SYNC_BRANCH` may be unused after branch-per-repo; drop it if nothing reads it.
- Any local process or web page can hit `127.0.0.1:53682/auth/callback?x` and make the shell emit a sign-in and steal focus. PKCE in the page stops a forged login; to stop the focus spam, deliver only while a sign-in is pending (set by the page when it starts one, cleared on first delivery or a timeout). Accept GET only.
- A taken sign-in port (a second instance) is only logged; tell the reader in the page to paste the link instead.
- `shim::APP_ORIGINS` is hard-coded; derive it from `useHttpsScheme` and the OS.
- Check that WebKitGTK and WKWebView call the main window's navigation guard for the top frame only; if subframes reach it, external http(s) iframes open in the browser instead.
- A sign-in that arrives before the page has loaded its bridge is lost (the page inbox only covers late subscribers); queue it in the shell until the page asks.

**Sync and storage (phase 3)**

- [bug] Folder mirror: when reading a file fails, `edited_since_base` treats it as unedited, so a held local edit can be overwritten. Same in the TypeScript; fix both, test first with a read fault.
- JS number printing (`JsPretty`) and `parse_number` lose precision for integers above 2^53, as JS does; decide whether ids that large can occur.
- Blob ranking sorts a `NaN` score unpredictably; rank NaN last.
- `instant.rs`: say in the docs that times without a zone are read as UTC.
- `sync_merge`: assert byte equality of the merged text, not only line equality.
- `git_remote`: add a test for `https://:@host/x` (empty user and password).
- Entity key order follows JS `Object.keys` (integer-like keys first); test it on both sides.
- TS sets `merged[f] = undefined` for a removed field, Rust drops the key; both serialize the same, keep a test.
- Fault sim: read faults in `FaultyFs`, convergence with a base, unstamped edge cases, entries for held paths, a departed path that is already gone, and asset write failures propagated.
- Report `failed_removes` from the mirror, and count `*.wftmp` files left behind.
- `Vault::write_file`: fsync the temp file and its parent folder.
- Folder mirror: treat read errors other than not-found as errors, and dedupe repeated paths.
- Fuzz: add round-trip properties (parse then print then parse).

## 11. Sources

- [Mozilla: autogenerating Rust-JS bindings with UniFFI](https://hacks.mozilla.org/2023/08/autogenerating-rust-js-bindings-with-uniffi/)
- [Ferrostar: cross-platform SDK in Rust](https://stadiamaps.com/blog/ferrostar-building-a-cross-platform-navigation-sdk-in-rust-part-1/)
- [Google: Rust in Android, move fast and fix things](https://blog.google/security/rust-in-android-move-fast-fix-things/)
- [TigerBeetle TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md)
- [TigerBeetle VOPR](https://docs.tigerbeetle.com/about/vopr)
- [Tauri issue #5889: memory vs Electron](https://github.com/tauri-apps/tauri/issues/5889)
- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [specta](https://github.com/specta-rs/specta) and [tauri-specta](https://docs.rs/tauri-specta)
- [cargo-mutants](https://mutants.rs)
