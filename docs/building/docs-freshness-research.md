# Keeping the docs fresh: research note (draft)

Draft for review, 2026-11-15. The question: how should the repo keep its
documentation from going out of date, automatically, from now on?

## What we already have

| Layer | What | Where | Fails CI? |
| --- | --- | --- | --- |
| 1 | Generated blocks between `<!-- generated:id -->` markers; atlas `{{TOKEN}}` figures | `scripts/update-docs.mjs`, `scripts/build-atlas.mjs`, inputs `scripts/lib/areas.mjs`, `user-facts.mjs`, `repo-stats.mjs` | Yes (`check:docs`) |
| 2 | Bold UI names in `docs/using` steps must exist as labels in `apps/web/src`, `crates`, Overleaf locales | `scripts/check-ui-names.mjs`, `scripts/lib/ui-names.mjs` | Yes (`check:docs`) |
| 3 | `covers:`/`checked:` front matter on `docs/using` pages; warn when covered code changed after `checked` | `scripts/check-docs-freshness.mjs`, `scripts/lib/doc-freshness.mjs`, job `docs-freshness` in `ci.yml` | No, warns |
| 4 | Same-PR rule: user-visible change updates its `docs/using` page | `.github/PULL_REQUEST_TEMPLATE.md`, `.agents/README.md` | No, a checkbox |

`check:docs` runs inside `check:boundaries` and as gate `gate_docs` in
`ci.yml`; the git hooks (`.githooks/pre-commit`, `pre-push`) regenerate and
stage only the files in `scripts/lib/generated-docs.mjs`.

## What was built (2026-11-15)

R1, R2, R3, R4 and R6 below are in place and block; R5 is not built. All run
in `npm run check:docs`, so in the pre-push hook and in CI job
`build-and-test`, a required check on `main`.

| Item | Check | Fails on |
| --- | --- | --- |
| R1 | `scripts/check-doc-refs.mjs` | a path or file name in any tracked doc that is not in the repo |
| R2 | `scripts/lib/test/repo-stats.test.mjs` | a `crates/*` dir or mobile shell missing from `AREAS` |
| R3 | `scripts/check-docs-coupled.mjs`: `--unpushed` in the pre-push hook, and CI step "Docs change with the code they cover" as backstop | a push or PR that changes code a `docs/using` page `covers:` without touching that page; a `docs-ok: <reason>` line in a commit message (or, in CI, the PR body) waives it |
| R4 | `scripts/check-core-docs.mjs` | a `crates/wf-core/src` module no `docs/building/core` page names, or a core page the README does not link |
| R6 | `scripts/check-doc-links.mjs` | a relative Markdown link to a missing file or heading |

## 1. Why the docs went stale anyway

Measured on `docs/accuracy-pass` (HEAD 536867f2b) with a throwaway scan of
every backticked path and identifier in the 140 tracked docs pages:

- **914 repo paths, 14 do not exist. 2,902 identifiers, 89 are not in the
  source.** 34 of the 89 are on `docs/building/core` pages, 40 on the
  architecture map.

What follows are the causes, each with a concrete example.

1. **Generators refresh numbers, not inventories.** `areas.mjs` is a hand-kept
   list. At HEAD it has no `crates/*`, `packages/wf-wasm` or `apps/relay`
   rows, so the code map and the atlas kept regenerating correct line counts
   for a pre-port picture: `docs/atlas.html` at HEAD mentions `wf-core` 0
   times, and the architecture map mentions crates in one line (108). Every
   `--check` passed, because the check compares output to its own input, and
   the input list was the stale part. The rows are being added by hand in the
   working tree right now. Nothing would stop the next crate from being missed
   the same way.
2. **The checks only look at `docs/using`.** Layers 2 to 4 skip all 88
   `docs/building/core` pages and the architecture map. Those pages were
   written during the TS to Rust port, while names kept moving. Examples:
   - `core/papers.md` lists `paperToRow`, `paperRowToDomain`, but the code has
     `paper_to_row` in `crates/wf-core/src/papers/paper_row.rs`.
   - `core/error-report.md` names `redactReport`/`redactReportAndCap`, but
     only `redact_report` exists (`crates/wf-wasm/src/error_report.rs`).
   - `core/sharing.md` names `generateShareLinkToken`, but the code has
     `share_link_token`.
   - `core/reading-lists.md` (`readingListToRow`, ...),
     `core/postgrest_transport.md` (`postgrestParseRows`, ...),
     `core/ink.md` (`pickCandidates`, `ink_constants`).
   - Missing paths: `crates/wf-wasm/src/reader_annotation_rows.rs`
     (`core/reader-annotation-rows.md`), `packages/wf-wasm/src/bindings.ts`
     (`core/wf-bindings.md`, `core/puller_plan.md`),
     a `nord` theme stylesheet (`themes.md`),
     a `timer` feature folder (`dev.md`).

   Any of these is a one-line `git grep` away from being caught.
3. **Feature claims are prose, not labels.** Layer 2 checks only bold names in
   numbered steps. A sentence like "import RIS files" or "archive a project" is
   not a label, so nothing checks it. Only a reader, or a model reading page
   and code side by side, can catch this kind of drift.
4. **The freshness warning is too coarse to be heeded.** `covers:` lists
   directories, and the check compares dates across all history. Today it warns
   on 8 of the 33 pages, one day after they were all checked. The trigger is
   any commit under, for example, `apps/web/src/features/reader`. That noise
   level teaches people to skip the annotations. It also lives in its own job,
   so it never shows in the PR diff where the change is.
5. **The same-PR rule is memory, not a gate.** It is a template checkbox and an
   agent note. Long port lanes renamed hundreds of functions without opening
   the pages that named them.
6. **A fragile check gets bypassed.** `check-ui-names.mjs` fails locally
   without the Overleaf submodule (`**Git integration**`, plus `General`/`OK`
   from `desktop.md`). A check that fails for environment reasons is the first
   one people learn to skip.

The general lesson: a generated block keeps a fact fresh only if (a) the
generator's input is itself checked for completeness, and (b) the hand prose
around it is held to something the machine can verify.

## 2. Approaches, ranked for this repo

FP = false-positive rate. Size = rough new code including tests.

### R1. Checked code references ("docs as tests" for names). Highest value.

- **Build:** `scripts/check-doc-refs.mjs` plus `scripts/lib/doc-refs.mjs`.
  - Every backticked token that looks like a repo path (`apps/`, `crates/`,
    `packages/`, `scripts/`, `db/`, ...) must be a tracked file or directory.
  - On `docs/building/**`, every backticked identifier (`snake_case`,
    `camelCase`, `a::b`) must appear as a word in tracked source (`.rs`, `.ts`,
    `.tsx`, `.mjs`, `.sql`) outside `*.md`.
  - Optional third rule: `npm run x` in any doc must be a `package.json`
    script.
  - Allowlist file `scripts/doc-refs-allow.txt` for build outputs and local
    files (`apps/web/.env.local`, `*/target/*`, `packages/wf-wasm/pkg`) and
    deliberate prose names (`__version__`, `versionCode`).
  - Skip fenced blocks marked as illustrative (for example `text` or `sh`
    output) to keep FP down.
- **CI:** append to `check:docs` in `package.json`, so it runs in `gate_docs`
  and pre-push. It fails the build.
- **Size:** about 120 lines plus about 80 lines of `node --test` tests in
  `scripts/lib/test/`.
- **FP:** low for paths (the scan found 14, of which about 5 are gitignored
  build outputs, all handled by the allowlist). Moderate for identifiers until
  the scan covers the whole tree. A first pass flagged `decodeWire`, which
  lives in `apps/shell/bridge`. Scanning `git ls-files` across the whole repo
  fixes that.
  - The architecture map's IPC table shows both `db_query` and its JS name
    `dbQuery`. Either generate that table (it is already a generated block,
    so exclude generated blocks from the check) or derive JS names
    snake-to-camel.
- **Would have caught:** every renamed function on the core pages (`paperToRow`,
  `redactReport`, `generateShareLinkToken`, ...), all 14 dead paths, and
  `nord.css`/`timer/`.

### R2. Inventory completeness for generator inputs and coverage maps. High value.

- **Build:** two assertions in `scripts/check-doc-refs.mjs` (or
  a new test in `scripts/lib/test/`):
  - **(a) Every code root has a row.** Every top-level code root
    (`crates/*`, `apps/*`, `packages/*`, `python/*`) above about 500 lines must
    be a `dir` in `AREAS`. A new crate then fails CI until it has a row.
  - **(b) Every module is claimed.** Every `crates/wf-core/src/<module>` and
    `crates/wf-store/src/<module>` must be claimed by the `covers:` list of
    exactly one `docs/building/core/*.md` page. This means giving core pages
    the same front matter as `docs/using`, reusing `frontMatter()` from
    `scripts/lib/doc-freshness.mjs`.
- **CI:** part of `check:docs`. It fails the build.
- **Size:** about 60 lines of checks. Adding `covers:` to 88 pages is a
  one-off scripted pass of about 1 line each.
- **FP:** near zero. Thresholds and an explicit `ignore` list in `areas.mjs`
  cover the rest.
- **Would have caught:** the missing Rust rows in the atlas and architecture
  map (the most visible staleness), and any new wf-core module shipped without
  a page. Today about 71 of 112 wf-core top-level modules are never named by
  path in `docs/building`. Many are mentioned only in prose, so the true gap
  needs `covers:` to measure.

### R3. Diff-coupled docs (Swimm-style), replacing date-based freshness. Medium-high.

- **Build:** change `scripts/check-docs-freshness.mjs` to work from the PR
  diff (`git diff --name-only base...head`) instead of dates.
  - **Signal:** a page whose `covers:` files changed in this PR while the page
    did not.
  - **Granularity:** allow file globs in `covers:` (for example
    `crates/wf-core/src/papers/paper_row.rs`), so pages can be narrower than a
    feature directory.
  - **Output:** one sticky PR comment listing the pages, so nobody has to dig
    through annotations.
  - **Escape hatch:** a `docs-unaffected: <page>` line in the PR body, or a
    label, acknowledges a page without editing it.
  - **Scope:** extend to `docs/building/core`.
- **CI:** the existing `docs-freshness` job. Keep it warn-only at first.
  Optionally fail later, honouring the escape hatch. That is the Swimm "verify"
  model, where minor drift is auto-synced and the rest fails until a person
  reviews it.
- **Size:** about 80 lines, plus a small `actions/github-script` step for the
  comment.
- **FP:** medium (most code changes do not alter what a page says). The escape
  hatch keeps the cost to one click, and diff scope removes today's
  "8 warnings after one day" noise.
- **Would have caught:** port lanes that rewrote `papers/`, `sharing.rs`,
  `error_report.rs` without opening their core pages. Each PR would have listed
  the page.

### R4. Generate reference lists from source; keep only the "why" by hand. Medium.

- **Build:** core pages currently hand-list functions and files ("What lives in
  Rust", file-by-file bullets). Hand-kept lists like these are what goes stale.
  - **Generated list:** produce the per-module file list (from `mod.rs` /
    `//!` module docs) as a `generated:` block via `update-docs.mjs`.
  - **Function names:** point readers to `cargo doc` output instead of
    restating names.
  - **Rustdoc gates:** turn on `#![deny(rustdoc::broken_intra_doc_links)]` in
    `wf-core`/`wf-store` and run `cargo doc --no-deps` in the `rust` job.
    Doc comments that link `[paper_to_row]` then fail on rename.
  - **Doctests:** `cargo test --doc` makes examples executable.
  - **TS side:** TypeDoc is not worth it; residual TS is shrinking.
- **CI:** `update-docs.mjs --check` (exists) and the `rust` job in `ci.yml`
  (`scripts/lib/rust-gates.mjs`).
- **Size:** about 100 lines for the generator. Moving lists into `//!` comments
  is per-module churn, best done as pages are touched.
- **FP:** none (it is compiler-checked).
- **Would have caught:** stale file lists such as
  `reader_annotation_rows.rs`. It removes the class rather than detecting it.

### R5. Periodic LLM drift audit. Medium. The only thing that catches prose claims.

- **Build:** `.github/workflows/docs-audit.yml` on a weekly `schedule` and
  `workflow_dispatch`.
  - **Input:** for each page that R3 or the date check flags (not all 140, to
    cap cost), send the page plus its `covers:` files to a model with a fixed
    prompt: "list each claim this page makes that the code does not support;
    quote the sentence and the file".
  - **Output:** one GitHub issue per run, with a checklist. It never blocks.
  - **Secret:** needs an API key secret, so ask before adding it.
- **Cost:** tokens per run, about 10 to 20 pages times about 30k tokens, small
  but recurring. Plus triage time.
- **FP:** medium to high on wording; low on hard claims like "you can import
  RIS". Treat the output as a review queue, not truth.
- **Would have caught:** RIS import and project archive claims in
  `docs/using`. R1 to R3 cannot see those.

### R6. Internal link and anchor check (lychee). Cheap, narrow.

- **Build:** `lycheeverse/lychee-action` with `--offline --include-fragments`
  over `docs/**/*.md` in PRs, so only relative links and `#anchors` are
  checked: fast and deterministic. External links go in a weekly non-blocking
  run.
- **Size:** about 15 lines of YAML plus `lychee.toml` excludes.
- **FP:** low offline. External links flake, hence weekly and non-blocking.
- **Would have caught:** links to moved or renamed pages after the docs folder
  reorganisation (`aa50099a9`). It complements R1, which checks backticked
  paths but not markdown links.

### Lower value here

- **Vale:** checks style and terminology, not truth. It could enforce banned
  pre-port terms ("Supabase" in data-layer docs, "PGlite"), which is a cheap
  win, but it is a separate tool and config. A 10-line regex list inside R1
  does the same job.
- **CODEOWNERS on `docs/`:** one maintainer, so it adds no reviewer. Skip.
- **More PR checkboxes:** layer 4 shows checkboxes are ticked, not acted on.
  R3 replaces them with a computed list.
- **Doctests/snippet embedding (embedme, markdown-magic):** the docs have few
  code snippets. Worth it only for `docs/building` how-to commands. Cover
  those with the `npm run x` rule in R1.
- **Doc Detective (UI docs as executable browser tests):** would test
  `docs/using` steps end to end, but duplicates the e2e suite and the live
  demo views. Not worth the setup now.
- **Freshness review cadence (`checked:` older than N days, rotate):** already
  half-built. Keep the date as a weekly report input for R5, not a PR signal.

## 3. Minimal first PR

**Title:** `docs(sync): check code references and generator inventories (layer 5)`

1. **R1, paths and identifiers.**
   - Add `scripts/check-doc-refs.mjs`, `scripts/lib/doc-refs.mjs`,
     `scripts/doc-refs-allow.txt`, and tests in
     `scripts/lib/test/doc-refs.test.mjs`.
   - **Rules:** paths across `docs/**/*.md`; identifiers on
     `docs/building/**` only, skipping generated blocks. Scan `git ls-files`
     source, skipping `node_modules`/`target`.
   - Fix the about 14 paths and 34 core-page names it reports in the same PR.
     They are all renames to the Rust names.
2. **R2a, AREAS completeness.** Every `crates/*`, `apps/*`, `packages/*` root
   above a line threshold has an `AREAS` row. Lands with the Rust rows already
   in the working tree. It is a test in `scripts/lib/test/`, so `check:docs`
   picks it up.
3. **R6, offline lychee.** Add one step to the docs gate in `ci.yml`:
   relative links and anchors only, failing the build.

Wire 1 and 2 into `check:docs` (already in `check:boundaries`, `gate_docs` and
pre-push). Document all three in `.agents/README.md` next to the same-PR rule.
**Size:** about 300 lines of scripts and tests, plus the doc fixes.

**Done when:**
- `npm run check:docs` passes on the fixed tree.
- Reverting `papers.md` to `paperToRow` fails it.
- Deleting the `crates/wf-core` row from `areas.mjs` fails it.
- Breaking an anchor fails lychee.

**Next PRs, in order:**
- R2b + R3: `covers:` on core pages; diff-based PR comment.
- R4: rustdoc intra-doc links in the `rust` job.
- R5: weekly LLM audit, after you approve the API secret.
- Separately: make `check-ui-names` skip, not fail, when the Overleaf submodule
  is absent, or fetch the locale file in CI. That addresses cause 6.

## Sources

- Swimm, code-coupled docs and CI verify/auto-sync:
  https://docs.swimm.io/new-to-swimm/benefits-of-code-coupled-documentation ,
  https://docs.swimm.io/ide-integrations/vs-code/ide-plugins-vscode-keep-docs-up-to-date
- Doc Detective, "docs as tests": https://github.com/doc-detective/doc-detective
- lychee link checker: https://github.com/lycheeverse/lychee
- rustdoc lints (`broken_intra_doc_links`), doctests:
  https://doc.rust-lang.org/rustdoc/lints.html
- Vale prose linter: https://vale.sh
