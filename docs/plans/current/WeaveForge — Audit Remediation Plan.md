# WeaveForge — Audit Remediation Plan

**Status:** working · **Branch:** `arena/01a0b6d4-weaveforge` · **Written:** after a line-by-line re-verification of every finding
**Source audit:** [`WeaveForge — Full Code Audit.md`](./WeaveForge%20—%20Full%20Code%20Audit.md) — 88 findings (31 `WF-*`, 57 numbered)
**Verification:** every finding re-read against the current source, and every Python claim re-run against the real SDK. The audit is wrong, stale, or actively harmful in 23 places; those are all listed in §2 and the work below uses the **corrected** fix, never the audit's sketch.

---

## Contents

1. [What this plan is](#1-what-this-plan-is)
2. [Verification results — what to trust](#2-verification-results--what-to-trust)
3. [Facts that change the fixes](#3-facts-that-change-the-fixes)
4. [Verification protocol](#4-verification-protocol)
5. [Phase 0 — baseline and test scaffolding](#phase-0--baseline-and-test-scaffolding)
6. [Phase 1 — correctness, data integrity, security](#phase-1--correctness-data-integrity-security)
7. [Phase 2 — the lexical extractor](#phase-2--the-lexical-extractor)
8. [Phase 3 — read path, database, hot paths](#phase-3--read-path-database-hot-paths)
9. [Phase 4 — contracts and types](#phase-4--contracts-and-types)
10. [Phase 5 — lifecycle and memory](#phase-5--lifecycle-and-memory)
11. [Phase 6 — structural decomposition](#phase-6--structural-decomposition)
12. [Phase 7 — guardrails, hardening, docs](#phase-7--guardrails-hardening-docs)
13. [Phase 8 — decisions, deferrals, won't-fix](#phase-8--decisions-deferrals-wont-fix)
14. [Findings the audit missed](#findings-the-audit-missed)
15. [Progress tracker](#progress-tracker)

---

## 1. What this plan is

The audit is a good map and an unreliable instruction manual. It found the right files and the right shapes, but a large minority of its proposed patches do not compile, do not do what the finding says, or would introduce a new bug. In three cases the premise is simply false and the code is already correct.

So this plan is organised around **outcomes that close findings**, not around the audit's section headings and not around its order. The order comes from four rules:

1. **Stop silent wrongness first.** Anything that loses data, writes a wrong status to the database, leaks a credential, strands a run as `running`, or shows a researcher a false curve, before anything perf-shaped.
2. **One file, one visit.** Findings that cluster in one file are done as one change with one review cycle — the Python SDK contributes 12 findings to a single 219-line file, the lexical extractor 9 to a 131-line file. Splitting those into per-finding commits would mean editing the same lines repeatedly and reviewing the same diff repeatedly.
3. **Concentrated rewrites before cross-cutting type changes.** A refactor that moves bugs around is worse than the bug; contracts (Phase 4) land before the structural splits (Phase 6) so the compiler, not a reviewer, enumerates the call sites.
4. **Guardrails last.** A gate written before the pattern is gone just fails the build.

Everything refuted, deferred, or needing a product decision is in §8 with the reason, so "not doing this" is a recorded decision rather than an omission.

### Ground rules for the agent

- Read `docs/building/design.md` §3–4 before changing a feature module. Dependencies point inward; the domain package holds no I/O, no `process.env`, no SDK.
- Pure logic and policy → `packages/core/src/` with tests under `packages/core/test/`. Hooks, components, adapters, and facades → `apps/web/src/`.
- Nothing over 800 lines (`npm run check:hygiene`). Split into a folder with an `index.ts` instead.
- Comments say *why*, in prose, and name the rule they serve. Match the surrounding density — the files in this repo are heavily and deliberately commented, and a terse patch stands out more than a wrong one.
- One signed commit per phase item (`git commit -s`; the DCO gate runs on every PR), conventional subject, ending with the repo's usual `Co-Authored-By` trailer.
- Every behaviour change ships with the test that would have caught it. Where no test home exists, Phase 0 creates one first — five of the areas this plan touches have **no test at all** today, which is exactly why the bugs survived.

---

## 2. Verification results — what to trust

88 findings. Tally: **38 confirmed as written**, **31 confirmed with a materially different fix**, **7 refuted or already fixed**, **12 advisory/unverifiable as framing**. No finding was adopted without reading the code.

### 2.1 Refuted, already fixed, or wrong about the mechanism

| ID | Audit claims | Reality |
|---|---|---|
| WF-P07 | Feature UI is statically imported into the shared layout/registry, so the graph/PDF/chart/Yjs libraries land in first-load JS | **Refuted.** The registry imports feature *descriptors*, not UI; routes statically import exactly one screen each (deliberate, documented in `scripts/generate-deployment-registry.mjs`). Force-graph is `next/dynamic`, pdf.js and Yjs are dynamically imported, uPlot is `void import("uplot")`. Only the missing CI size budget survives. |
| WF-P08 | Dead E2EE schema is still created on every fresh install; no migration removes it | **Already fixed.** Migration `0099_drop_e2ee_schema.sql` drops all nine key tables and the `*_enc` columns; `0123` drops the leftover `get_public_keys`; an integration test asserts it. What is stale is `README.md`'s claim that no migration does this. |
| WF-P09 | Per-step logging writes one row per call; chunks should become the write path | **Refuted on all three clauses.** The SDK buffers at 1000, chunks flushes at 5000, the ingest route downsamples before insert, and `0115`'s own comment explains why chunks are an *archive* written by a batch rollup rather than the append path. The real gap: nothing schedules the rollup. |
| BUG-02 | `useScreenData` refetches on every render because `load` is an inline closure | **Refuted.** All ten call sites pass a `useCallback(…, [])`; no site re-loads per render. The ref-stabilisation is still worth landing as hardening. |
| BUG-17 | `@track_experiment` cannot inject `run` into a positional parameter; the README's `def train(run, beta=4.0)` fails | **Refuted by execution.** `run` is positional-*or*-keyword, so `kwargs.setdefault` fills it; the README shape works. The real failure modes are positional-only parameters and a caller filling the run slot positionally. |
| BUG-18 | A failed index build sets `ready`, so consumers lose their fallback and get an empty result set | **Impact refuted.** Every consumer keeps an unconditional substring fallback (the palette and both ranked filters fall back per item), so the described empty-result path is unreachable. The proposed patch is behaviourally inert. |
| PERF-09 | `listStamps()` should take a `since` and push the predicate down | **Refuted.** The protocol rejects "changed since T" precisely because deletions are invisible; the caller needs the complete stamp set to compute `drop`. The proposed `gt("updated_at", …)` would also silently drop rows whose `updated_at` is null. |
| SEC-01 | `010.127.0.1` passes the guard as public while the stack dials loopback — a live SSRF bypass | **Bypass refuted** by measurement: `new URL()` canonicalises every non-canonical IPv4 form (octal, hex, integer) before the guard sees it, and `undici`'s parser agrees, so guard and socket always see the same address. Keep the hardening; drop the impact claim and fix the prescribed tests, which assert something false. |
| ARCH-05 | `fetchBlobs` is optional on `IPaperImageStore`, hence a duplicate batch-fetch fallback | **Premise refuted.** `fetchBlobs` is required (`zotero.ts`), no `fetchBlobs?` exists anywhere, and `git log -S` shows it never was optional. The facade fallback is unreachable dead code; the cited production bug was a `this`-binding mistake, not optionality. |

### 2.2 Confirmed, but the audit's patch is wrong or harmful

These are the ones that matter most: applying the audit literally would have *added* bugs.

| ID | The audit's patch | What it would do |
|---|---|---|
| BUG-01 | `tree: buildPageTree(merged.items)` | **Deletes every pinned/shared note from the vault screen.** `tree` is load-bearing: the screen derives `ownedIds` from it, so building it from merged items makes `pinnedPages` empty *and* removes pinned ids from `ownedNotes`. Correct fix in Phase 1. |
| BUG-09 | A shared `pushWith(client, paperId)` that filters to local annotations | **Drops the `{ live: true }` third argument**, turning the live Zotero write into a silent dry run. |
| BUG-03 | A single shared `seq` counter for the IDB restore and the network reload | **Permanently disables IndexedDB restore**, because the reload effect bumps the same counter before the IDB promise can settle. |
| WF-B04 | Stamp the terminal status first, then sync/flush | **Closes the mirror as `done` before the flush**, so a later downgrade to `failed` cannot reach it — the row says failed, the wandb run says done. `set_status` is what finishes the mirror. |
| ARCH-14 | `RunFinaliser.succeeded` ending `except Exception: self.failed(); raise` | Contradicts its own "never raises" docstring, re-raises the flush failure out of `with track(...)`, and shifts `warnings.warn` attribution by one frame. |
| PERF-01 | One regex with a captured path, tested inside the replacer | **Fails an existing test**: the capture group stops at `)`, and the suite feeds `a+b(1).png`. |
| PERF-02 | Keep `input.shares.some(...)` inside the pin loop | Doesn't remove the O(pins × shares) scan it set out to remove, *and* a naive one-pass index would silently drop blanket (project-wide) share grants, which the first loop deliberately skips. |
| PERF-03 | Change `computeRollup`'s signature to take a prebuilt index | A **breaking change to the public `@weaveforge/core` export** (2 app call sites + 13 test assertions), and it leaves the quadratic scan one level down in `extraction-table.ts` untouched. |
| PERF-04, BUG-05, ARCH-07 | Use `this.scoped(...)` / `PAPER_ID_COLUMNS` | **Neither exists.** `ProjectRepository` exposes only `db` and a `pid` getter. |
| PERF-05 | Fold the scope read and token resolution into one RPC returning `{ scopes, access_token }` | **Not implementable**: the token RPC returns a uuid and the JWT is HMAC-signed in Node with an app-only secret. It also deletes the documented two-halves check that exists so one edit cannot weaken both. |
| PERF-07 | Decode 64 KB and stop at `</head>` | **Changes behaviour**: `extractPageTitle` already clamps at 200 000 chars, so a title between 64 KB and 200 KB would be lost. Also the premise is wrong — `readCapped` *refuses* over-cap bodies rather than truncating. |
| MEM-02 | Clear `this.docs` when semantic search is off, and hand docs back from settings | References a non-existent `EMPTY_DOCS`, does not actually drop the copy (nobody calls `setSemanticIndex` when the arm is off), and **breaks re-enabling** because `ensure()` returns early. The settings panel never holds the docs. |
| MEM-06 | Memoise `openAppDb` and close it "alongside the other session-reset steps" | Closing inside the session-reset hook runs *before* the clears that reopen the connection. Memoising without `onversionchange`/`onclose` hands out a dead handle that every caller swallows. |
| SEC-03 | Return a generic body plus a `crypto.randomUUID()` correlation id | Breaks the repo's stated convention (`formatErrorForResponse` is documented as the one way a route writes `{ error }`) and erases the deliberate 503-vs-500 signal. |
| SEC-04 | Pass `[]` instead of `undefined` to `allowedTools` | **A no-op**: `[].length` is falsy, so the facade still falls back to the full tool list. Only the facade change matters. |
| BUG-12 | Treat a null `baseVersion` as unguarded | Misses the reachable path: `conflict()` persists a literal `serverVersion: 0`, which is what produces the unmatched `row_version=eq.0` guard. |
| BUG-13 | Add `{ status: "reauth" }` | Does not compile at the pump's `outcome.reason` site, contradicts a test that documents the current behaviour as intentional, and misdiagnoses the cause (a token frozen at `enable()` time). |
| WF-C02, WF-C04, WF-C09, WF-C10, ARCH-02, ARCH-12, ARCH-15 | Various | See the per-phase notes: the container has no `close()` (it closes `container.api`), `IMetricRepository` has two implementors and `append` has zero call sites, `describeRejection` has exactly one consumer in a `private: true` package, `IMetricRepository`'s port is already narrow, the screen-id registry the audit proposes would include a screen with no cache and omit one that has one, and both freshness constants already use the same clock. |

### 2.3 Counts the audit got wrong

| Claim | Actual |
|---|---|
| `PapersFacade` — 35 methods, 19 constructor deps | **39 public members** (35 methods + 4 getters), **16 deps**, and ~69 call sites across ~30 files (not "no call site changes") |
| ARCH-04 — a dozen inline `import("@weaveforge/core").X` per file | **86 occurrences across 34 tracked files**, max 10 in one file |
| ARCH-01 — six screen use-cases repeat the merge | **Seven** `Load*ScreenUseCase` files exist; the merge is *already* extracted in core. The residue is the surrounding orchestration. |
| WF-B11, WF-C03 — four `record()` call sites | **Three** (`:99`, `:103`, `:116`) |
| WF-C04 — `latestActivityAt` is fetch-all-rows because the port is row-shaped | It scopes and projects two columns already; the bug is the missing `MAX … GROUP BY`, not the port shape. `append` on that port has **zero** call sites. |
| ARCH-11 — four methods mutate staleness state | **Seven** |
| WF-B02 — PostgREST truncates at 1000 rows | PostgREST's own default is **unlimited**; the 1000 cap is Supabase platform config. This repo sets neither, so it bites the hosted deployment and not the self-hosted one. |
| WF-P01 — 20 experiments × 50k points = 1M rows transferred | The ingest route downsamples before insert (`planSeriesIngest`), so a 400k-step run stores ~40k points. The 1M figure only holds for writers bypassing the route. |
| BUG-11, BUG-02, BUG-05, BUG-06, BUG-07, BUG-08, BUG-10, ARCH-07, PERF-04, PERF-06, PERF-09 | cited line numbers | All drift; use the per-item files in this plan, not the audit's line ranges |

---

## 3. Facts that change the fixes

Six facts about the current tree determine several fixes at once, and none of them are in the audit.

1. **`experiment_metrics` is a view, not a table.** Migration `0114` dropped the table and `0115` replaced the view with a chunk-aware one that `unnest`-expands archived chunks and unions them with loose rows, de-duplicating by step. So: the audit's `create index … on experiment_metrics` cannot be applied at all; `select("*")` saves one column rather than three (`id` and `created_at` no longer exist); and every read pays a server-side expansion of every chunk. Any read fix must aggregate over the two base relations, not the view.
2. **The row cap is deployment configuration, not code.** PostgREST's `db-max-rows` defaults to unlimited and Supabase sets 1000. `supabase/config.toml` and the compose file set neither. So WF-B02/B03 are correctness bugs on the hosted deployment and pure cost on self-hosted — and the honest fix makes both independent of the setting.
3. **Missing metric activity is not a display bug — it is a write.** A missing map entry makes `isStaleRunningExperiment` fall back to `startedAt`, and the experiments facade then persists `status = "abandoned"`. Two-minute threshold. On top of that, reconciliation runs over the *merged* list, which includes other users' shared runs, so opening the screen can rewrite a colleague's run status.
4. **`set_status` is the only thing that finishes a mirror.** `Run.set_status` calls `mirror.finish(status)` and nulls the field. Every finalisation fix has to respect that ordering or it trades a stuck row for a lying remote run.
5. **The offline outbox has no production pump.** `SyncEngine.cycle()` is called only from tests; production runs exactly one pass, inside `enable()`, with an access token frozen at that moment. This changes the severity of BUG-12/BUG-13 and makes "wire the pump" a prerequisite for their real fixes.
6. **Five of the areas in scope have no test at all** — `use-screen-data`, `PapersFacade`, `ExperimentsFacade`, every `Load*ScreenUseCase`, `mergePinnedScreenData`, `CompactCrdtLogUseCase`, and the Supabase metric adapter. Phase 0 creates the harnesses; without them these fixes are unverifiable and will regress.

---

## 4. Verification protocol

Confirmed working in this checkout: `npm run test:core` → **1214 tests, 0 failures, ~62 s**. The full gate set is available and must be green per phase.

Per phase item:

```
npm run build:core          # packages/core must compile before apps/web typechecks
npm run typecheck           # all workspaces
npm run lint                # apps/web (eslint; react-hooks/exhaustive-deps is an error)
npm run test:core
npm run test:web            # node --import tsx --test "src/**/*.test.ts(x)"
npm run test:integration:web   # pglite: applies every supabase/migrations file
npm run check:boundaries    # check:solid, dry, api-route-tests, ui, hygiene, mcp-plugin, docs
cd python && ruff check weaveforge tests && mypy && pytest -q      # for python items
```

Then, before a phase is called done: `npm run check:all` (adds `test:desktop` and a real `next build`).

Rules that will bite if forgotten:

- `check:hygiene` fails a file over 800 lines, a doc naming a path that does not exist, and an API route that walks an unbounded array from the body.
- `check:api-route-tests` requires every route under `apps/web/src/app` to have a colocated `test/route.test.ts` that imports it. SEC-06 touches a route; the test must exist alongside.
- `check:docs` regenerates the architecture map and the boundary-checks table. Adding a gate means updating `package.json`, the CI step list **and** `docs/building/dev.md` — the CI file's own comment warns this list is written twice.
- Migration files are numbered sequentially, need a matching rollback under `supabase/migrations-rollback/`, and carry a `-- Reversal:` header. `0114`'s comment records that an unguarded re-run once silently reverted `0115` and lost data; new migrations must be re-runnable.

---

## Phase 0 — baseline and test scaffolding

**Goal:** a green baseline and the missing test homes, so every later fix has somewhere to prove itself. No source behaviour changes.

- **0.1 Record the baseline.** Run `npm run check:all` and store the result in the progress tracker. Anything already red is not ours to fix and must not be silently absorbed.
- **0.2 New test home: the screen-data hook.** `npm run test:web` picks up `src/**/*.test.ts`; `apps/web/src/lib/test/react-harness.ts` already exists. Add `apps/web/src/lib/test/use-screen-data.test.ts` covering: cache hit serves immediately, a fresh fetch is written through, an IDB restore is applied, a stale IDB payload does not clobber a completed fetch (BUG-03), and two overlapping reloads keep the newest answer (BUG-04). Also add `apps/web/src/lib/hooks/test/use-search-index.test.ts` if BUG-18 is taken.
- **0.3 New test home: the facades.** Copy the shape of `apps/web/src/container/test/ink-facade.test.ts` (node:test, no DOM) to `apps/web/src/container/test/experiments-facade.test.ts` and `papers-facade.test.ts`. These are the first tests either facade has had.
- **0.4 New test home: core collab.** Create `packages/core/test/features/collab/` with a fake `ICrdtUpdateStore`, so compaction ordering is testable without a database. There is currently no collab test directory at all.
- **0.5 New test home: screen loaders and the pinned merge.** Add `packages/core/test/features/library/merge-pinned-screen-data.test.ts` and one contract test per `Load*ScreenUseCase` parameterised over the six screens — the audit's own guardrail suggestion, and the only thing that would have caught BUG-01 and PERF-02's blanket-share trap.

**Done when:** baseline recorded, five new suites exist and pass, no production file touched.

---

## Phase 1 — correctness, data integrity, security

**Goal:** every finding that loses data, writes a wrong value, leaks a secret, or strands a run — at one-file scale, each independently shippable. No refactors.

### 1.1 CRDT compaction — right order, and be honest about what is protected — `WF-B01`, `WF-B08`
- Invert to watermark-first in `packages/core/src/features/collab/application/compact-crdt-log.use-case.ts`, and add the monotonic guard at the store: set only when the stored value is older.
- Correct the mechanism in the comment. There is no snapshot blob: the watermark is only a replay cursor (`listAfter` is strictly `id > watermark`), so the real hazard is that compaction deletes the full-state row that `persistTail` appends while reconstruction falls back to the entity row body — which the editor saves fire-and-forget, concurrently with teardown.
- **New** `packages/core/test/features/collab/compact-crdt-log.test.ts`: a store whose `setSnapshotUpto` throws must leave the watermark unmoved and the rows intact; a stale caller must not rewind a newer watermark.
- Deferred to §8: the transactional RPC and the body-durability ordering (both need a decision about teardown sequencing).

### 1.2 Python SDK — finalisation, injection, typing — `WF-B04`, `WF-B05`, `WF-B06`, `WF-B07`, `WF-B12`, `WF-C01`, `WF-C02`, `WF-C07`, `WF-C08`, `ARCH-14`, `BUG-15`, `BUG-16`, `BUG-17`
One change to `python/weaveforge/tracking.py`, because all thirteen findings are the same three problems.
- **One finaliser, both exits.** Extract a guarded helper; the success path gets guarded steps too, so a failing `sync`/`flush` can no longer skip the terminal status. Ordering must respect fact 4 above — the *row* status may be stamped first, but mirror finalisation must happen after sync/flush, or a downgrade can no longer reach it.
- **Guard from the moment of acquisition.** Open the `try` immediately after `_connect`, and close the mirror before re-raising if run creation fails. `_close_owned` currently sits outside the guarded region entirely.
- **Async support.** `inspect.iscoroutinefunction` branch with an `async with` wrapper, or a loud `TypeError`. Silently returning an un-awaited coroutine and stamping the run `done` is the worst of the three options. Note `pytest-asyncio` is not a dependency — drive the test with `asyncio.run`.
- **Bind, don't guess.** Hoist `inspect.signature(fn)`, then `sig.bind_partial(*args, **kwargs)`; inject only when absent from `bound.arguments`, and drive hyperparameter capture from the same bound arguments so positional calls are captured too. Handle `Parameter.kind.POSITIONAL_ONLY` explicitly — that, not the README shape, is the real injection failure.
- **Protocols instead of `getattr` sniffing.** Add `ExperimentPort` / `ArtifactPort` / `SupportsClose` and type the container. Note the code closes `container.api.close()`, not `container.close()`; the uploader path already fails loudly, and `MemoryContainer` has no `api` field, so widen the mypy target and add the field rather than pretending tests cover it.
- **A shared `_best_effort(what, action)`** replacing the four hand-rolled `try/except/warn` blocks (three in this file, one in `features/experiments/application/run.py`). Keep the warning text verbatim — tests assert it.
- Tests in `python/tests/test_run.py` and `test_run_flush.py`: a raising sync source still stamps a terminal status **and** finishes the mirror; run-creation failure closes an owned connection; a mirror is released when creation fails; an async function is either tracked or refused loudly; a positional run injection binds; positional hyperparameters are captured.

### 1.3 Screen-data hook — sequence the two async writers — `BUG-03`, `BUG-04`, `BUG-02`
- `apps/web/src/lib/hooks/use-screen-data.ts`: one monotonic request token shared by both paths, and the IDB restore applies only if no network load has completed since — **not** a counter that both effects bump (the audit's version disables restore forever). Prefer comparing the restored `fetchedAt` against the current entry's, which is self-describing.
- Move `load` out of the `reload` dependency list via a ref, even though no current call site needs it: it makes the hook's contract explicit and the audit's concern structurally impossible.
- Tests: the scenarios in 0.2.

### 1.4 The experiments screen must not write on load — `BUG-20`, `PERF-10`
- Split `reconcileAndLoad` into a pure read and a single-flight `reconcileStaleRuns`, called from a scheduler rather than from `loadScreenData`.
- **Filter to runs this user owns before writing any status.** Reconciliation currently walks the merged list, which includes other users' shared runs, and persists `abandoned` with no ownership check. This is the most serious finding in the audit's web half and the audit does not mention it.
- Bound the fan-out (upload and status writes) with the concurrency mapper that already exists privately in `apps/web/src/features/papers/infrastructure/zotero-web-api.ts` — export it rather than writing a second copy, and apply it to the same unbounded pattern in `container/facades/report.ts` and `container/facades/papers.ts`.
- Test: `experiments-facade.test.ts` from 0.3 — two concurrent calls produce one batch of writes; a shared run owned by someone else is never written.

### 1.5 Zotero preview and live push must send the same set — `BUG-09`
- One private helper taking the client and the selection; **keep `{ live: true }`** on the live client or the write becomes a silent dry run, and keep the two clients' differing result shapes honest.
- Test: preview and live push agree, and the live path still passes the live flag.

### 1.6 Vault ownership is derived from a tree that is never rendered — `BUG-01`
- The audit's patch deletes pinned notes. The real defect: `VaultScreenData.tree` is consumed *only* to compute `ownedIds`, and there is no folder-tree UI in this screen. Return an explicit `ownedIds` (or `pinnedIds`) from the use case, use it in `vault-screen.tsx`, and either delete the now-dead tree or build it from merged items once something renders it.
- Decide the sibling cases (`load-report-screen.use-case.ts` and `load-reading-lists-screen.use-case.ts` also build from pre-merge `owned`, but their trees *are* rendered) in §8 — they need a product call on whether shared sections belong in the tree.
- Test: one owned page, one pinned page, one share → the tree/flat/owned sets agree, and the pinned section still lists the pinned page.

### 1.7 Outbox guard when the base version is unknown — `BUG-12`
- Only guard on `row_version` when it is a real version, **and stop persisting a literal `0`** from `conflict()`'s catch — that is the reachable producer of the unmatched `row_version=eq.0`. Make "unknown" null through the conflicts store and the column.
- Test: an update with an unknown base version is not parked as a permanent conflict.

### 1.8 API auth must not return internals — `SEC-03`
- Both catches in `apps/web/src/app/api/sdk/_shared.ts` go through the existing `formatErrorForResponse` (detail to the server log, stable wording to the client, 503-vs-500 preserved). The audit's generic-body + UUID patch is a convention break.
- Test: extend the existing `_shared.test.ts` case to assert the body carries no driver text and that the 503 branch survives.

### 1.9 An empty tool registry must deny — `SEC-04`
- The fix is in `apps/web/src/container/facades/ai-assistant.ts`, not the container: `this.deps.allowedTools ?? AI_TOOL_NAMES` so `[]` denies. Passing `[]` from the container alone is a no-op.
- While there: the container never consults the generated MCP-enabled flag, so a deployment that disabled MCP still hands the facade the full allowlist.
- Test: an empty registry rejects a proposal with `tool_not_allowed`.

### 1.10 Outbound port allowlist — `SEC-02` (hard trim only)
- Drop `3000` and `5000`. **Keep `8000` and `8008`** — the audit's trim list omits them and they are the ordinary self-hosted dev ports the file's own comment protects.
- The operator escape hatch moves to §7: `packages/core` is deliberately `process.env`-free and I/O-free, and `checkUrlShape` has no options parameter, so a configurable allowlist is an API change at the app boundary, not a one-line edit in core.

### 1.11 IPv4 canonical form — `SEC-01` (hardening, not a bypass)
- Require canonical dotted-quad octets, and tighten `isIpAddress`'s "any colon means IPv6" shortcut. Frame it as defence-in-depth: the live bypass claimed by the audit and by `WF-B09`'s sibling finding is not reachable, because `new URL()` normalises first.
- Tests must assert the *primitive* (`isPublicAddress("010.0.0.1")`) — asserting `checkUrlShape("http://010.0.0.1/")` is refused would be asserting something false.

### 1.12 Two small leaks
- `apps/web/src/lib/recent-targets.ts`: guard the `setItem`. One caller is a navigation handler, so today a full disk aborts the navigation; the other three throw inside effects.
- `apps/web/src/backend/net/safe-fetch.ts`: cancel the response body on the non-OK path, as the redirect path already does. Every 403/404/5xx currently holds the socket.

### 1.13 Session reset must invalidate the search index — *audit missed*
- The reset hook clears caches and the project id but never invalidates the search index, and the container is never torn down. Sign out and in on a shared browser, and the previous user's documents are still rank-searchable in memory. Add the invalidation to the reset path and assert it.

### 1.14 Issue templates — `WF-C10`
- Port the two prompts that exist only in the `.md` forms (the SDK-extras question, the "new feature module" guidance) into the `.yml` forms, then delete `bug_report.md` and `feature_request.md`. `config.yml` does not govern the chooser, contrary to the audit.

### 1.15 The sync offer's one-time memory — `BUG-14`
- Coerce truthy strings on read. The audit's repro is unproven (the Electron store JSON round-trips booleans), but the type permits it and the fix is three characters.

**Phase 1 done when:** all items above are green on `npm run check:all`, each with its test, and the new suites from Phase 0 are passing.

---

## Phase 2 — the lexical extractor

**Goal:** one rewrite of a 131-line pure module that closes **nine** findings. This is the highest finding-per-line ratio in the audit, and the audit's own decomposition is close to right.

`packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts` — refactor into pure stages with explicit data flow, then fix the rules.

- **Decompose (`WF-C03`).** `harvestStated(doc)`, `harvestGuessed(plain)`, `mergeMentions(all)` owning the merge policy, `rankAndLimit(concepts, max)`, `projectMentions(kept)`. `extract()` becomes composition. The `record` closure currently mutates two collections from three call sites, which is how the merge-policy bug and the double parse hid.
- **One pass (`WF-P03`, `WF-C05`).** Collect `stated` keys at the point of recording; delete the second loop over every document. The two derivations already disagree on empty wikilink targets (`[[#Heading]]`), today inertly.
- **Lowercase once (`WF-P04`).** Thread the lowercased document into evidence extraction, and prefer passing the regex match index into a `snippetAt` so no re-search happens. Related **audit-missed bug:** `stripMarkdown` deletes `[[…]]` before `evidenceFor` runs, so a wikilink-only concept records empty evidence and the review queue's evidence pane is blank precisely for stated signals.
- **Store the key once (`WF-P05`).** Keep it on the mention/entry as an *optional* field so the public `ExtractedMention` type and the model-based extractor do not break; the model extractor, `mergeExtractions` and several fixtures construct mentions directly.
- **One regex pass (`WF-P06`).** A single alternation classifying by group. Careful: the acronym pass is *not* redundant (it yields `vae` where the phrase pattern yields `vae-based`), so the merged pattern must preserve the leading-acronym sub-match.
- **No boolean flag (`WF-C06`).** Split into `classifyStated` / `classifyGuessed` and state which rules each owns. The flag currently sits *after* the acronym rule, so it does not select a rule subset at all — and because hashtags are lowercased upstream, `#NeurIPS` and `[[ImageNet]]` are forced to `concept`.
- **Acronym allowlists (`WF-B10`).** Check known venue/dataset/metric acronyms before the "unknown acronym is a method" fallback. **Keep the allowlist variant** — returning `concept` for unknown acronyms breaks an existing green test asserting `GAN.kind === "method"`. Note `NEURIPS` is seven characters and never matched the acronym rule anyway.
- **A merge policy, not first-write-wins (`WF-B11`).** Stated signals win for name/aliases and for the keep decision; for `kind`, prefer the *more specific* of the two. The audit's `incoming.strength > entry.strength` overwrite would replace a correct `dataset` with the generic `concept` — a regression.

**Tests** in `packages/core/test/features/ai-assistant/concept-extraction.test.ts`: `[[#Heading]]`; a wikilink-only concept carries non-empty evidence; `#iclr` vs `ICLR`; `#NeurIPS`, `[[ImageNet]]`, `MNIST`, `BLEU` kinds; a stated signal upgrading a guessed name's casing without downgrading its kind; and the existing `GAN`/`VAE` cases stay green.

---

## Phase 3 — read path, database, hot paths

**Goal:** the curves are right, and the pages stop paying O(history).

### 3.1 Metrics — one migration, then one adapter — `WF-B02`, `WF-B03`, `WF-P01`, `WF-P02`
- **New migration** `supabase/migrations/0131_metric_read_rpcs.sql` (adds the aggregate RPC and the missing index; with a rollback file and a `-- Reversal:` header). The audit's DDL targets `experiment_metrics`, which is a view — indexes there cannot exist. Aggregate over `experiment_metric_points` unioned with an unnest of `experiment_metric_chunks`, `security invoker` so RLS applies, and add the missing `(experiment_id, wall_time desc) where wall_time is not null` index. There is no `wall_time` index anywhere today.
- `latestActivityAt` calls the RPC: one row per experiment, correct regardless of any row cap, and no O(points) transfer. Note in the comment that the RPC still expands chunks server-side — that is Postgres' work, not the browser's.
- `history` gets a column projection and a `maxPoints` budget on the port. **The audit's pagination loop is unsafe as written**: `if (page.length < PAGE) break` silently stops after page one when the server cap is below the page size. Read `Content-Range`, or size pages below the configured cap, or — better here — downsample in SQL and bound the response by construction.
- **Set `PGRST_DB_MAX_ROWS` explicitly** in the compose service so the deployment's behaviour is a decision rather than a default. Today the same code is correct on one deployment and silently wrong on the other.
- Tests: add `latestActivityAt` and empty-`append` cases to the shared metric contract (today it tests `history` only, so a fake can satisfy the "contract" with arbitrary behaviour), plus a pglite integration test since the in-memory contract cannot reproduce PostgREST paging.

### 3.2 Schedule the metric rollup — `WF-P09`'s real gap
- `scripts/rollup-metric-chunks.mjs` documents "nothing calls it automatically". No cron, no package script. So the archive stays empty and every point remains a 132-byte row instead of the 21-byte measured target — the storage work of `0114`/`0115` is unrealised in production. Add the schedule (or a documented operator step) and fix the two stale docstrings that still call the view "the curve table (migration 0016)".

### 3.3 Papers repository — scoping, projection, honest types — `BUG-05`, `BUG-06`, `BUG-07`, `BUG-08`, `PERF-04`, `PERF-09`
- The guard is missing on `listByIds`, **and** on `getById`/`delete` in the same class, **and** on the identical omission in `supabase-vault-page-repository.ts` — "the sole exception" is wrong. Add the guard to `ProjectRepository` as a real helper (the audit's `this.scoped` does not exist) so a new method cannot forget it, then apply it everywhere.
- Issue chunk reads concurrently and impose a deterministic order. The audit's "callers zip the response against their id list" is refuted — `applyDelta` re-emits in map order, pinned by an existing test — but the sequential round trips are real.
- Narrow the four dedupe lookups, keeping a projection that still satisfies `toDomain` (the audit's three columns cannot). Collapse them into one `findBy(column, value)` helper and delete `findByArxivBidx`/`findByDoiBidx`, which have zero callers.
- Fix the two non-null assertions on a function that returns `string | undefined` (not `null`, as the audit says). They are unreachable today because every caller guards truthiness — and note the audit's "skip the filter" patch would turn a DOI filter from "matches nothing" into "returns the whole library".
- **`PERF-09`: do not implement.** Documented design; the proposed `since` filter breaks deletion detection and drops null `updated_at` rows.
- `listSummaries` is annotated as returning full `Paper`s while selecting summary columns. The port is already narrow and the runtime behaviour is already pinned by a contract test — this is a local annotation fix, not the redesign the audit describes. Same cosmetic widening exists in the vault repository.

### 3.4 `stripUnresolvedImageRefs` — `PERF-01`
- One compile, one pass, with the unresolved paths joined into an alternation — **not** the audit's captured-group version, which fails the existing `a+b(1).png` test because the capture stops at `)`.

### 3.5 `mergePinnedScreenData` — `PERF-02`, feeding `ARCH-01`
- One pass over shares building exact grants *and* blanket grants, then OR per pin. The audit's "after" sketch still scans the share list per pin, and a naive resource-id index silently drops project-wide (blanket) grants, which the first loop deliberately skips. The blanket case is the trap; write the test that proves it.

### 3.6 `computeRollup` and the table around it — `PERF-03`
- Hoist the value index to once per table load. Prefer the non-breaking route: an optional prebuilt-index parameter, or memoise inside `flattenPaperRows` and pass it down — changing the required signature is a breaking change to the public core export with 15 call sites.
- **Fix the quadratic scan one level down too**: `extraction-table.ts` rescans every project value per paper, so fixing `computeRollup` alone leaves the grid quadratic.
- Add a time-budget test following the `paste-stress.ts` precedent.

### 3.7 API auth client reuse — `PERF-05`
- Hoist the service-role client to a lazily-initialised module singleton keyed to the environment it was built from (tests re-point env per case, so an unconditional singleton would silently keep talking to a stale URL).
- **Drop the RPC merge**: the token RPC returns a uuid and the JWT is signed in Node, so "one call returning `{ scopes, access_token }`" cannot exist — and the two-halves split is documented as deliberate. Correct the stale migration number in the comment (`0129`, not `0072`/`0130`).

### 3.8 The cheap ones
- `PERF-06` `screenForPath`: exact-match map first, no regex split. 
- `PERF-07` `fetchPageTitle`: decode a bounded prefix and stop at `</head>`, but **do not cap at 64 KB** — the title extractor already clamps at 200 000 chars and the gap is reachable. Avoid the second full-string `toLowerCase`.
- `PERF-08` `compressImage`: short-circuit when the input already fits the budget and format, and probe dimensions before re-encoding. Do **not** claim an EXIF bug: `imageOrientation` defaults to `from-image` in current engines and we could not verify a rotation failure. There is no `budget` parameter today — it has to be plumbed from the caller.

---

## Phase 4 — contracts and types

**Goal:** make the compiler refuse the bugs. Landed before the structural splits so those splits cannot move bugs around.

- **`ARCH-02` — required projections.** 6 web call sites plus a seventh in core (`manage-vault-page.use-case.ts`) and the optionality is on *two* ports, not one. The blockers are real: the in-memory paper repository lacks `listSummaries`, three core test fakes construct their own, and two contract suites encode optionality as legal — and those contract files must keep the literal string because `repository-contracts.test.ts` asserts it.
- **`ARCH-05` — delete the dead branch.** `fetchBlobs` is already required and the facade's fallback is unreachable. Pure deletion.
- **`ARCH-07` / `BUG-07` / `BUG-08`** land here if not already done in 3.3.
- **`ARCH-12` — one screen registry.** Seed it from the ten actual `useScreenData` keys, not the audit's list (which includes `dashboard`, which has no screen cache, and omits `report-overleaf`, which has one). There is also a **third** hand-maintained list — the `switch` in `prefetch-screen.ts` — and a live instance of the drift: `/report/overleaf` returns `null` from `screenForPath` even though the screen writes that cache key.
- **`ARCH-13` — extract `randomBytes`** beside `systemClock`/`uuidIds` and import it. Note there are four further inline re-wraps of the already-extracted adapters in the composition root; they belong in the same commit or the file is left half-migrated.
- **`ARCH-04` — one spelling for type imports.** 86 occurrences across 34 files, not "a dozen in one file". Enable `@typescript-eslint/consistent-type-imports` and hoist. **Blocker:** the boundary gates only scan `apps/web/src/features`, so `apps/web/src/container/**` is unchecked today — widen the gate root or the lint rule is the only enforcement.
- **`WF-C04` — split the metric port** into writer / history reader / activity reader. Blast radius is small and known: two implementors, `append` with zero call sites (delete it rather than carry it forward), one consumer each for the other two. The dashboard facade composes the readers.
- **`WF-C09` — move `describeRejection`** to the web presentation layer, with its test. One consumer, and the package is `private: true`, so there is no published-API risk. Keep the exhaustive `Record<UrlRejection, string>`.
- **`ARCH-15` — name the two cache policies** in one place and pass the fetch time explicitly. Both constants already use `Date.now()`, so the audit's "different clocks" is wrong; the real win is that the policy has one home and six call sites must state the timestamp.
- **`MEM-05` — one cache entry type** instead of two maps keyed identically. Not a live bug (every writer/ deleter touches both) but a maintenance hazard, and the IDB layer already has the envelope shape to unify with.

---

## Phase 5 — lifecycle and memory

**Goal:** module state stops outliving the container; the tab stops accumulating handles.

- **`MEM-01` + `MEM-03` together.** A teardown path already exists (`clearSessionCaches` → registered reset hooks), but `invalidateAllRepoCaches` only clears map *contents* — entries and their Maps accumulate per container, and 24 repos register per container. Deliver the disposer through the existing `register` hook rather than threading it through 24 `cacheRepo` call sites, delete the write-only `ProjectLwwInvalidator.caches` set, and **dispose on container recreation too** (`bootstrap.ts` rebuilds the container when the backend config changes, which never triggers a sign-out).
- **Two audit-missed leaks in the same file:** the session-reset hook list is push-only (one leaked closure per container), and `ProjectLwwInvalidator.watch` opens a realtime channel per container that is never unsubscribed on rebuild.
- **`MEM-06` — one IndexedDB connection per tab.** Memoise the open, and add `onversionchange`/`onclose` handlers — without them a memoised handle goes stale after another tab upgrades and every caller's `catch {}` swallows the failure, silently disabling every cache. Close it at the **end** of `clearLocalDeviceData`, not in the reset hook, which runs before the clears and would immediately reopen it. No IDB test harness exists (no `fake-indexeddb`); adding one is part of this item.
- **`MEM-02` — the retained corpus, done correctly.** The audit's patch cannot work. The real defects: `indexedDocuments()` is *already* stale after any incremental refresh (which poisons the semantic arm's revision check, so newly added notes are unfindable), and clearing it on disable breaks re-enable because `ensure()` returns early. Make the projection re-derivable on demand and stop retaining it; the settings panel never held the docs, so nothing can hand them back.
- **`BUG-10` — subscribe as a function of the project id.** The dead `watch()` call at container construction is real; the deeper issues are that the reset never unsubscribes the private channel and that the search index is never invalidated (1.13).
- **`BUG-11` — move the reset registration** after `workspace` is declared. The TDZ is real but unreachable (the span is straight-line synchronous), so this is hygiene: it kills a `no-use-before-define` hazard and a duplicate-hook accumulation.
- **`MEM-04` — preallocate in `readCapped`,** with the growth loop the audit's sketch omits, and without trusting `content-length` as a final size (it is the *encoded* length, and absent on chunked responses). The 12 MB/24 MB figure is the image path only.

---

## Phase 6 — structural decomposition

**Goal:** the splits, done once the contracts are tight.

- **`ARCH-03` — split `PapersFacade`.** Real numbers: 39 public members, 16 constructor deps, ~69 call sites across ~30 files. The audit's "keep the same import path so no call site changes" is false; budget the call-site work. Three members have zero callers today (`signedImageUrls`, and both Zotero push/ dry-run entry points) — decide delete-or-wire as part of the split, not after.
- **`ARCH-06` — `ImportLocalZoteroUseCase`** in the app's own application layer with the bridge injected. No core layering issue; one caller.
- **`ARCH-08` — one push-to-Zotero rule.** Both dependencies are already core ports. Note the two copies also differ in error handling (one try/catch, one not) and in return type — that difference is the reason to unify, not an accident to preserve.
- **`ARCH-09` — `AppendPaperNoteUseCase`.** The port already exists; **the same conflict rule is written three times**, so extract the rule, not just this one literal.
- **`ARCH-10` — one auth flow.** Keep both exported names so 28 call sites do not change. The status-policy divergence is only reachable for `tt_…` tokens (the non-token branch delegates), and the duplicated `getUser`/provisioning seam is the real dedup target.
- **`ARCH-11` — `WorkspaceSearch` decomposition.** Extract the projection, the PDF pruner, an index-state value object, and the ranking helper. **Fix the audit-missed bug first:** `refreshStale` clears the staleness set *before* awaiting the snapshot, so a rejection loses the kinds and the index stays silently stale.
- **`ARCH-01` — one pinned-screen loader** for the six screens, parameterised over the repository, the shareable type, and the projection. The merge itself is already in core; this is the orchestration around it, plus the membership map (three copies today).

---

## Phase 7 — guardrails, hardening, docs

**Goal:** every fix above is one refactor away from returning unless something notices.

- **Gates.** A `select("*")` rule in `check:dry` (catches `PERF-04` and every future over-fetch); a facade method / dep-count ceiling in `check:solid` for `ARCH-03`; a hook-dependency rule banning non-primitive deps for `BUG-02`; the registry-consistency test from 0.5. Remember the CI step list is written twice (`ci.yml` and `check:boundaries`) and `docs/building/dev.md` is generated.
- **`ARCH-04` lint rule** plus widening the gate root to `container/**`.
- **CI bundle budget** — the only survivor of `WF-P07`. `@next/bundle-analyzer` is already a devDependency; the analysis is manual today.
- **`SEC-05` / `WF-B09` — close the check-to-connect window.** Same finding twice in the audit. It needs a transport change, not the two-line agent patch: `undici` is not a dependency (only `undici-types`), and the module is shared with the Electron main process where a `dispatcher` is not guaranteed. Either add `undici` and scope the pinned agent to the server path, or switch this one call to `node:https.request({ lookup, servername })`. Update `docs/SECURITY.md`'s "known residual risk" section, and add an injectable connect seam so a test can prove the pinned address — the current `stubFetch` stubs global fetch, so it cannot.
- **`SEC-06` — per-user rate limit and streaming** for `/api/fetch-url?as=image`. No limiter exists anywhere in TypeScript (the only one is a SQL function for share links). `auth.userId` is server-verified, so a per-user bucket is sound; the bucket is per-process, and the compose file declares no replicas. The streaming variant costs the exact `Content-Length` header and the client still buffers, so it only removes the server-side copy — worth stating in the commit. `apps/web/src/lib/cache/single-flight.ts` already exists and collapses duplicate pastes more cheaply than a bucket. A route test is mandatory (`check:api-route-tests`).
- **`SEC-02` operator allowlist** — the env-driven escape hatch, at the app boundary rather than in the I/O-free core package.
- **`BUG-18` / `BUG-02` leftovers** — land as clarity if not already covered; neither changes behaviour.
- **Docs corrections.** `README.md`'s claim that no migration removes the E2EE tables is false; `supabase/migrations/README.md`'s table stops at `0094` while the chain runs past `0130`; the metric repository's docstring calls a view "the curve table (migration 0016)"; `_shared.ts` cites the wrong migration numbers. Four small corrections that otherwise send the next reader down the same wrong path this audit took.

---

## Phase 8 — decided

Every question below has an answer from the project owner (2026-02), so these are
scheduled work rather than open questions. The decisions and what each one commits
us to:

| Item | Decision | What it means |
|---|---|---|
| **Transactional CRDT compaction** (`WF-B01`/`B08`) | **Do it properly** | Add `compact_crdt_log(resource_type, resource_id, upto_id)`: one statement, its own owner-or-edit check in SQL, returns the rows deleted. The ordering fix alone is not enough — an RLS-filtered delete answers `204`, so a non-owner's compaction advances the shared watermark and makes the rows unsweepable for the owner afterwards. Also make the entity body durable **before** the tail is deleted |
| **Outbox pump** (`BUG-12`, `BUG-13`) | **Wire it** | `SyncEngine.cycle()` gets a production caller (reconnect, timer, wake), and the transport stops using the token captured at `enable()` time — `async () => (await client.auth.getSession()).data.session?.access_token`. With the loop cycling, `reauth` becomes reachable and `BUG-13` closes properly |
| **Shared rows in the tree** | **Include them** | `load-report-screen` and `load-reading-lists-screen` build their trees from the merged set, so a shared section or list appears in the tree rather than only in the flat projection |
| **Blanket share semantics** (`PERF-02`) | **Keep** | A share with no `resourceId` grants comment/edit on every pin whose owner is the sharer. Confirmed as intended; the two-index `grantIndex` is the implementation that preserves it |
| **Row-cap policy** | **Leave `PGRST_DB_MAX_ROWS` unset** | The self-hosted PostgREST default (unlimited) stands, and the compose comment stays as the record. The reads are correct under either setting, which is why this is a preference and not a correctness question |
| **`PERF-09`** | **Won't fix** | Filtering delta reads by "updated since the watermark" cannot see deletions — a deleted row has no `updated_at` to report. The full stamp read is what makes deletion detection work |
| **`WF-P09` as written** | **Won't do** | Chunks are a compaction format written by the rollup, not an append format; a chunk per step rewrites a growing array every step. The real gap was the missing schedule, closed in Phase 3.2 |
| **`BUG-17`** | **Fixed, plus user-facing report** | The injection is fixed (`bind_partial`). The residue question became a decision of its own: errors a person can be shown should carry a **report-to-GitHub** affordance that files an issue with redacted logs, so the owner can act on them |
| **`ARCH-03` timing** | **Done** | Sliced per concern: fields, then Zotero. Ten call sites, not 69 |
| **`WF-P08`** | **No work** | Fixed by migration `0099`; only the docs were wrong, corrected in Phase 7 |
| **The `select("*")` sweep** | **Finish it** | All 45 sites named, and the `check:dry` baseline deleted so the rule is a plain ban rather than a ratchet |
| **The bundle lead** | **Dynamic-import `katex`** | `components/markdown/markdown.tsx` is loaded by four route modules and statically imports `katex`; the maths renderer moves behind a dynamic import (or the plain renderer splits from the maths one) |

**Work still open from these decisions:** the CRDT RPC and body durability, the
outbox pump, the merged trees, the error-report affordance, and the bundle change.
Each is scheduled below in the order it was agreed.

---

## Findings the audit missed

All verified against source; these are why several phases are larger than the audit implies.

1. **Experiments reconciliation writes other users' run status** — `setStatus(…, "abandoned")` over the merged shared list, no ownership check. Most serious audit-missed item.
2. **Sign-out leaves the previous user's documents searchable** — the session reset never invalidates the in-memory search index and the container is never torn down.
3. **CRDT compaction is a silent no-op for non-owner collaborators** (RLS-filtered delete returns 204) and deletes the full-state row the reconstruction path depends on.
4. **The offline outbox never cycles** — `SyncEngine.cycle()` is test-only, and the token is frozen at `enable()`.
5. **The metric chunk archive is never populated** — nothing schedules the rollup.
6. **`safeFetch` never cancels the body on non-OK responses** — sockets held for every 403/404/5xx.
7. **Wikilink concepts record empty evidence** — `stripMarkdown` removes `[[…]]` before evidence extraction.
8. **`refreshStale` clears staleness before awaiting** — a rejected snapshot silently loses the pending refresh.
9. **`indexedDocuments()` is already stale** after any incremental refresh or PDF index, poisoning the semantic arm's revision check.
10. **Session-reset hooks accumulate** (push-only) and container recreation leaks a realtime channel and 24 cache entries.
11. **`IMetricRepository.append` has zero call sites** and the contract suite never tests `latestActivityAt`, so the "contract" passes with arbitrary read-model behaviour.
12. **Two more unbounded fan-outs** beside `PERF-10` (`facades/report.ts`, `facades/papers.ts`), and a private `mapWithConcurrency` that already exists.
13. **The `experiment_metrics` view expands every chunk on every read**, and there is no `wall_time` index anywhere.
14. **The conflict store persists `serverVersion: 0`**, which is the reachable producer of BUG-12's phantom conflict.
15. **`graphDegrees` / projection duplication is a third site**, and `collapseToEntities` is imported only by a test.
16. **mypy excludes `python/tests`** and `MemoryContainer` has no `api` field, so the container-typing work is not verifiable without widening the target.
17. **Coverage gaps**: no tests for `use-screen-data`, `PapersFacade`, `ExperimentsFacade`, any `Load*ScreenUseCase`, `mergePinnedScreenData`, `CompactCrdtLogUseCase`, or the Supabase metric adapter.

---

## Progress tracker

Every one of the 88 findings is assigned to exactly one phase below, and the counts add to 88.

| Phase | Items | Findings closed | Status |
|---|---|---|---|
| 0 — baseline & scaffolding | 5 | 0 (creates the missing test homes) | **done** |
| 1 — correctness, integrity, security | 15 | 30 | **done** |
| 2 — lexical extractor | 1 (9 fixes) | 9 | **done** |
| 3 — read path, DB, hot paths | 8 | 19 | **done** |
| 4 — contracts & types | 10 | 9 | **done** |
| 5 — lifecycle & memory | 7 | 7 | **done** |
| 6 — structural decomposition | 7 (+`PERF-04`) | 7 (+1 latent bug) | **done** |
| 7 — guardrails, hardening, docs | 8 | 6 | **done** |
| 8 — decisions | 10 | 1 (plus 7 refuted / won't-fix recorded) | open questions — the only phase left |

Phase 1 carries the most findings because so many of them are one-file changes; Phase 0 carries none, but it is why the rest are verifiable at all.

### Phase 0 — what landed, and two scope adjustments

- Baseline recorded. `npm run test:core` → 1214 pass / 0 fail. `npm run check:all` is **red before any change of ours**, at `check:docs`: `docs/building/architecture-map.md` had drifted (line counts from earlier commits). Fixed by regenerating the generated blocks, which is routine here and is its own commit.
- New test homes: `apps/web/src/lib/test/use-screen-data.test.ts` (+ a reusable `apps/web/src/lib/test/fake-indexeddb.ts`, which the Phase 5 IndexedDB work needs too), `apps/web/src/container/test/experiments-facade.test.ts`, `packages/core/test/features/collab/compact-crdt-log.test.ts`, `packages/core/test/features/library/merge-pinned-screen-data.test.ts`, and `apps/web/src/features/vault/test/load-vault-screen.use-case.test.ts`.
- **Adjustment 1:** `papers-facade.test.ts` is not created here. A smoke test for a 39-member facade that `ARCH-03` is going to split would be written twice; it lands with the split in Phase 6.
- **Adjustment 2:** the parameterised `Load*ScreenUseCase` contract test is written for the vault loader (the one `BUG-01` concerns) rather than for all six. A single parameterisation over six differently-shaped use cases is only cheap once `ARCH-01` unifies them in Phase 6; the per-screen shape is verified now, the shared shape then.
- `ProjectContext` and `ProjectState` are now exported from the project provider. Additive, and the reason the screen-data hook can be tested at all — it throws outside a provider, and standing the provider up needs a container.

### Phase 1 — what landed

| Item | Findings | Test that proves it |
|---|---|---|
| 1.1 compaction order + monotonic watermark | WF-B01, WF-B08 | `packages/core/test/features/collab/compact-crdt-log.test.ts` (5) + `apps/web/src/backend/test/crdt-snapshot-watermark.test.ts` (4, real Postgres through the local client) |
| 1.2 Python exit paths, binding, ports | WF-B04, B05, B06, B07, B12, C01, C02, C07, C08, ARCH-14, BUG-15, BUG-16, BUG-17 | `python/tests/test_run.py` (+8 cases) and `test_run_flush.py` |
| 1.3 screen-data sequencing | BUG-02, BUG-03, BUG-04 | `apps/web/src/lib/test/use-screen-data.test.ts` (5) |
| 1.4 reads stop writing; ownership; bounded fan-out | BUG-20, PERF-10 | `apps/web/src/container/test/experiments-facade.test.ts` (7) |
| 1.5 Zotero preview/live parity | BUG-09 | `pushAnnotationsToZotero` keeps `{ live: true }` — the audit's patch dropped it, so the review here is what matters; a facade test lands with `ARCH-03` |
| 1.6 vault ownership set | BUG-01 | `apps/web/src/features/vault/test/load-vault-screen.use-case.test.ts` (2) |
| 1.7 outbox guard for an unknown base version | BUG-12 | `apps/web/src/features/offline-sync/test/postgrest-transport.test.ts` (+2) |
| 1.8–1.11 security (auth bodies, tool allowlist, ports, IPv4) | SEC-01, SEC-02, SEC-03, SEC-04 | `packages/core/test/net/url-safety.test.ts` (+2 groups), `apps/web/src/app/api/sdk/test/_shared.test.ts` |
| 1.12 two leaks | — (audit-missed) | `apps/web/src/lib/test/recent-targets.test.ts`; `safe-fetch` body cancel has no unit seam (the stub replaces fetch) |
| 1.13 search index on session reset | — (audit-missed) | `WorkspaceSearch.invalidate()` is covered at `apps/web/src/features/search/test/workspace-search.test.ts:107`; the container wiring has no test, because no test can import the composition root |
| 1.14 issue templates | WF-C10 | none automated (`check:hygiene` does not cover `.github/ISSUE_TEMPLATE`) |
| 1.15 sync offer coercion | BUG-14 | `apps/web/src/features/offline-sync/test/sync-offer.test.ts` (existing suite; the harness already accepts a string preference) |

Known gaps after Phase 1, recorded rather than hidden: the Zotero push rule and the composition root still have no direct test (Phases 3 and 6); `safe-fetch`'s socket behaviour is not observable through the existing fetch stub; `check:docs` was stale before this work.

### Phase 2 — what landed

One rewrite of `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`, closing 9 findings. The file is now `prepare` → `harvestStated` → `harvestGuessed` → `mergeMentions` → `rankAndLimit` → `projectMentions`, and `extract()` is five lines of composition.

| Item | Finding | How it was closed |
|---|---|---|
| Decompose into stages | WF-C03 | The `record` closure that mutated two collections from three call sites is gone; each stage is a pure function of the one before it |
| One pass, one derivation of "stated" | WF-P03, WF-C05 | `strength` is set where a signal is harvested and read for both the keep decision and the merge; the second loop over every document is deleted |
| Lowercase once, carry the match index | WF-P04 | `prepare()` lowercases each document once; evidence comes from `snippetAt(index)`, not a re-search |
| Store the key once | WF-P05 | Keys are computed at harvest and carried on the internal mention and entry, so no stage re-normalises a name |
| One scan for both patterns | WF-P06 | One regex, read from the inside — see the correction below |
| No boolean flag | WF-C06 | `classify(name, strength)` with the fallback each path deserves; the old flag sat *after* the acronym rule, so it never selected a rule subset |
| Acronym tables | WF-B10 | Venue, dataset and metric acronyms are checked before the "an acronym is a method" default. `NEURIPS` (seven letters) never matched the old pattern at all |
| Merge policy | WF-B11 | Stated wins the name and the keep decision; the kind is never replaced by a less informative one |

**Three corrections to the audit's proposed fixes, made while implementing them.**

1. **`WF-P06`'s "single alternation" would have lost concepts.** The two passes this replaces were not redundant: for `VAE-based`, the phrase pattern stops at `VAE-based` while the acronym pass adds `VAE`, and a merged alternation that lets the phrase branch win at each position drops the acronym entirely. The implementation scans once with the phrase pattern and reads the all-caps tokens *inside* each match, which reproduces both passes' contributions from one scan. The regression is pinned by a test.
2. **`WF-B11`'s "upgrade when the stronger signal arrives" would have downgraded kinds.** A stated tag that no rule recognises classifies as the generic `concept`, so a plain strength comparison replaces a recognised `method` or `dataset` with the vaguer answer. The implemented rule is *never less informative*: a kind a rule recognised beats any fallback, and equal-information kinds are decided by `KIND_INFORMATIVENESS`, with the stated signal breaking ties.
3. **`WF-B10`'s impact was narrower than stated.** The guessed path rejects anything under three characters, so two-letter acronyms (`AI`, `ML`) never became concepts at all; and `NEURIPS` was dropped rather than mislabelled. The tables are needed for the ≤6-letter acronyms the pattern *could* match, plus the longer ones it could not.

**Two defects found while testing, both in the same function and neither in the audit.**

- `[[#Overview]]` was being harvested as a **hashtag concept**. The hashtag reader is a plain regex and cannot tell a heading target from a tag, so linking to a section of a note coined a concept called "overview". The wikilinks are now blanked (length-preserving) before the hashtag scan, which is also what makes `[[#Heading]]` behave as `WF-C05` assumed it did.
- A wikilink-only concept carried **empty evidence**, because stripping markdown is what removes `[[…]]` and the snippet was read from the stripped text only. Evidence now falls back to the raw text. This was on the plan as an audit-missed item; it is closed here.

**Note on evidence for the three internal fixes.** `WF-P03`, `WF-P04` and `WF-P05` change no observable output, so there is no behavioural test that can fail without them — their evidence is the shape of the code and the review of it. What their absence *could* have cost is pinned instead: the acronym-inside-a-hyphenated-phrase test guards the single-scan rewrite, and the evidence tests guard the two derivations of "stated" collapsing into one.

### Phase 3 — what landed

**3.1 The metric read path** (`WF-B02`, `WF-B03`, `WF-P01`, `WF-P02`) — one migration, `0131_metric_activity_rpc.sql`, with two read functions and the index that was missing:

- `latest_metric_activity(uuid[])` computes one row per experiment from **both stores** — the hot rows and the chunk archive — with `security invoker` so RLS still decides visibility. This is the finding whose failure mode is a database *write*: a missing entry made the experiments screen mark a live run abandoned.
- `metric_history(uuid, text, int)` takes a point budget and reduces server-side by stride, keeping each series' first and last sample. A stride, not an average: averaging a loss curve smooths away the spikes a spike is the reason to plot. Below the budget nothing is dropped.
- `experiment_metric_points (experiment_id, wall_time desc) where wall_time is not null` — the audit's index DDL could not be applied at all, because `experiment_metrics` is a **view** over `experiment_metric_points` and `experiment_metric_chunks` since `0114`/`0115`.

`history()` without a budget now pages by **rows received** rather than by page size. The audit's `if (page.length < PAGE) break` stops after the first page on any deployment whose row cap is below the page size, because a capped response *is* a short page.

**3.2 The rollup nothing ran** (`WF-P09`'s real gap) — two npm scripts and `docs/running/metrics-maintenance.md`, with a suggested cron, the queries that show whether it is working, and an honest statement that not running it costs space rather than data.

**3.3 The papers repository cluster** (`BUG-05`, `BUG-06`, `BUG-07`, `BUG-08`, `PERF-04`, `PERF-09`) — the project filter is now one helper every read goes through, in the papers *and* vault repositories; chunk reads are issued together with a deterministic order; four dedupe copies collapse into one; `listSummaries` is typed as the summary it fetches. `PERF-09` was already refuted and is documented in place.

**3.4–3.8 The hot paths** (`PERF-01`–`PERF-08`) — one-pass image stripping, one share-grant index, one value index per table, one service-role client per config, a map lookup instead of a route scan, a bounded decode, and no canvas round trip for a file that is already small and already in a format we would have produced.

**Measured, not asserted:** on a 400-row table with 20 000 field values and three rollup columns, building the rows took **5624 ms** before `PERF-03` and **5 ms** after — the same data the audit computed as "30 million map inserts". That measurement is why the guard is a 1500 ms budget rather than a micro-benchmark: it separates the two shapes by three orders of magnitude.

**Two more defects found by the work itself, in the local PostgREST client:**

- It did not implement `.range()` at all, so any paged read threw `range is not a function` on the local backend only. Paging is how a caller reads a table larger than one response, and the client exists to speak the same protocol the browser repositories speak.
- An array bound to a *function argument* was sent as JSON, which Postgres reads as `malformed array literal`. That broke the new `latest_metric_activity` **and** `record_blob_access_many`, which no test had exercised on that path.

**Deviation, recorded:** `PERF-04`'s projection cannot be narrowed to the three columns the audit proposed. The port promises a `Paper` and a dedupe hit is handed straight back to the caller as the paper it found, so fewer columns behind a wider type is the same lie `listSummaries` used to tell. The lookup now uses the full list projection; a narrower port for the citation-linking caller is the real fix and belongs with Phase 4's contract work.

### Phase 4 — what landed

| Item | Finding | How it was closed |
|---|---|---|
| Required card projections | ARCH-02 | `listSummaries` is required on both ports; the six web fallbacks and the seventh in core are gone, along with two contract suites' "when present" branches |
| Dead batch-fetch branch | ARCH-05 | `fetchBlobs` is required on the port; the fallback was unreachable |
| Screen registry | ARCH-12 | `SCREEN_IDS`, seeded from the ten real cache keys; the invalidation map is typed by it, the prefetch switch is exhaustive over it, and `/report/overleaf` is finally a screen |
| Injected adapters in one place | ARCH-13 | `randomBytes` joined the clock and the id generator, in `lib/system.ts` rather than a directory about papers |
| Inline core type imports | ARCH-04 | 95 across 40 files hoisted to top-level `import type`; a `check-dry` rule keeps them out, and both boundary gates now search `container/**` |
| Metric port split | WF-C04 | Writer, history reader and activity reader, composed for the adapters; the facade depends on the two readers, and its test fails to compile if that widens back |
| Cache policy and entry | ARCH-15, MEM-05 | Two freshness numbers in one module with the distinction written down; one cache entry type, with `fetchedAt` required so a caller says which moment it means |
| Prose out of the policy module | WF-C09 | The reason codes stay in core as the contract; the sentences live beside the fetch that shows them |
| `ARCH-07`, `BUG-07`, `BUG-08` | — | Closed in Phase 3, where the papers repository was already open |

**Two decisions worth recording.**

**The audit's ESLint rule is the wrong enforcement for `ARCH-04`.** `@typescript-eslint/consistent-type-imports` is not enabled by `next/core-web-vitals`, and switching it on flags *every* value import used only as a type across the whole app — a hundred-plus unrelated files, leaving `lint` red for a preference this finding is not about. The gate bans the pattern the finding names (`import("@weaveforge/core").X`) and nothing else; a type query against a lazy-loaded sibling module is the local convention there. The more valuable half of the item was the second one: both boundary gates now search `apps/web/src/container`, so the ~70 files that wire the features together are no longer the only ones no rule looks at (677 files searched before, 702 after).

**The `PERF-04` narrow port is deferred, deliberately.** What the finding asked for is fixed: the four dedupe lookups no longer `select("*")`, and `listSummaries` no longer claims to be a full paper. What remains is an *addition* — a narrower lookup returning just the identity and status, for the two citation-linking callers that read nothing else — and it is a new API rather than a defect. It belongs with the structural work in Phase 6, where those callers are being touched anyway, and where a benchmark can show what the columns cost.

Baseline: `npm run test:core` → 1214 pass / 0 fail.

### Phase 5 — what landed

| Item | Finding | How it was closed |
|---|---|---|
| Registrations are disposable | MEM-01 | `registerRepoCacheEntry` returns a disposer, delivered through the register hook the invalidator already offered rather than threaded back through `cacheRepo` → `wireBackend`'s twenty-four call sites |
| The write-only cache set | MEM-03 | `ProjectLwwInvalidator.caches` deleted; nothing ever read it |
| Container teardown | — | `createAppContainer` returns `dispose()`, and `bootstrap` calls it when it replaces a container — after the new one is built, so a bad config cannot tear the app down |
| Session hooks stop accumulating | *audit missed* | `registerSessionReset` returns a disposer, and the container holds it, so a rebuild no longer leaves a generation whose hook runs on every later sign-out |
| The realtime channel is released | BUG-10, *audit missed* | `ProjectLwwInvalidator.dispose()` leaves the channel; the session reset calls it, and so does container teardown. The reset had nulled the project id without telling the invalidator, and a rebuild dropped it with the channel still joined |
| Module hooks are cleared | *audit missed* | `clearProjectCacheHooks()`, or the next container's writes are reported to the previous one's invalidator |
| The reset registers after what it reaches | BUG-11 | Moved below `workspace`; the TDZ was unreachable but free to remove |
| One IndexedDB connection | MEM-06 | Memoised, with `onversionchange`/`onclose` handlers — without them a memoised handle goes stale after another tab upgrades and every caller swallows the failure — and closed at the **end** of the device wipe |
| The semantic corpus | MEM-02 | Projected on demand instead of retained; that fixes the staleness (the retained copy meant a note added after the build could never be found semantically) *and* the re-enable the audit's own patch would have broken |

**Three of these seven were not in the audit.** The container never had a teardown path at all: `bootstrap` rebuilt it on every provider change and dropped the reference, so the accumulated repository registrations, the session hook and the joined private channel all survived together. The audit described the symptom (memory grows, invalidation walks dead entries) and proposed the fix for one of the three.

**The IndexedDB item needed a test harness to be verifiable.** Phase 0's `fake-indexeddb` grew `close`, `onversionchange` and a `versionChange()` trigger, so the memoisation and the stale-handle recovery are under test rather than review. The module's own test caught a mistake in the fix: comparing `opening` (the promise) against the database made the handlers never clear the memo, which is the exact failure they exist to prevent.

Baseline: `npm run test:core` → 1214 pass / 0 fail.

### Phase 6 — what has landed, and what is left

| Item | Finding | How it was closed |
|---|---|---|
| The lost staleness | *audit missed* | `refreshStale` cleared the staleness set **before** awaiting the snapshot, so a read that rejected lost the kinds for good: the index served the old rows, nothing was marked stale, and no later `ensure()` looked again. Cleared last now, per kind |
| One append-note use case | ARCH-09 | In core, with the port it satisfies (`IAiPaperNoteAppender`) already existing. The revision rule it contained was written **three** times; `proposalApplies` is that rule, as a generic type predicate so callers keep their own row type |
| One push-to-Zotero rule | ARCH-08 | The two copies had drifted on the part that matters: the facade swallowed a failed push, the composition root let it escape a *confirmed* proposal after the paper was already added. One use case, with a stated outcome |
| The local-Zotero import | ARCH-06 | An application-layer use case with the desktop bridge injected, so the branch a browser user hits is testable without Electron |
| One auth flow | ARCH-10 | Both surfaces now share the mint → verify → answer sequence. The relay surface answered 503 for *every* failure, so a bug of ours reached clients as "try again later"; one policy now (503 only for a missing JWT secret), and one refusal wording per surface |
| One pinned-screen preamble | ARCH-01 | `loadPinnedScreenData` takes the resource type once instead of six screens spelling it twice, and `buildListMembership` replaces the map built by hand in four places |
| The `PapersFacade` split | ARCH-03 | Four concerns became three classes: custom fields to `PaperFieldsFacade`, everything Zotero to `ZoteroFacade`. The audit's 69-call-site estimate was the *whole* facade's surface — the two extracted slices have ten call sites between them, across four files |
| `WorkspaceSearch`'s four pieces | ARCH-11 | The projection, the extracted-text pruning, the stale/index state and the related-document helper are four modules beside a 438-line class (was 542). The state object is where the class's one real bug lived, and its invariant is now testable without a snapshot, a worker or IndexedDB |
| The narrow identity port | `PERF-04` | `IPaperIdentityLookup` — `{ id, title, status }`, three columns, for the citation linker and the reader's reference panel. Both were reading less than they were given: the linker reads only the id |

**Three decisions taken while doing this phase, recorded here rather than in a commit message.**

1. **`signedImageUrls` is deleted, not moved.** Nothing has ever called it: the note and paper editors read blobs (`fetchImageBlobs`). The two Zotero entry points are *kept* — the live one is the only path to a documented capability — but they moved into `ZoteroFacade` with a test that asserts on the requests, because the audit's own patch for them dropped `{ live: true }` (BUG-09).
2. **The facade dep-count gate is not shipped yet.** The plan put it in Phase 7 for this split, and it cannot be written as the line-counting regex the other gates use: anonymous types inside method signatures read as dependencies (the count for `ai-assistant.ts` comes out at 51 that way), and a count taken only inside the constructor's `deps` block would fail that file immediately — which is a second refactor, not a gate. The gate and that facade belong together, in Phase 7.
3. **`PERF-04`'s port did not narrow the whole reader chain, and that was checked rather than assumed.** `ResolvedReference.inLibrary` was typed `Paper`, so narrowing it meant confirming that nothing read more than the identity: the popover and the panel read `.status`, and the one place that spreads `title`/`authors`/`year` builds its resolution from a *freshly added* paper, not from this lookup. A `Paper` still satisfies `PaperIdentity`, so those paths were untouched.

**One recurring cost worth naming.** Hand-rolled test fakes of `IPaperRepository` have now broken twice on a port change (`manage-vault-page` in Phase 4, `manage-relations` here), both times at runtime rather than compile time, because core's tests are not type-checked. Both were replaced with the shipped in-memory repository. If a third appears, the fix is to type-check core's tests rather than to write another fake.

Baseline: `npm run test:core` → 1214 pass / 0 fail.

### Phase 7 — what landed

| Item | How it was closed |
|---|---|
| Facade size ceiling | `check:solid` measures each facade's members and constructor dependencies **with the TypeScript parser** and fails past a per-file limit. `PapersFacade` had reached 39 members with nothing to stop it one method at a time; `ai-assistant.ts` is at 39 today, so its limit is its current size — a ratchet that may only come down. The first draft counted indentation and read `dashboard.ts` as one member and twenty-two dependencies |
| `select("*")` rule | `check:dry` bans a starred projection in any adapter. Its first run found **45 sites across 17 adapters** — the house style, not one finding. Eighteen are fixed; the rest are a counted ratchet (see the debt note below) |
| CI gate parity | `check:ci-parity` closes the list written twice. CI runs the gates as separate steps so a PR can see which rule rejected it, which means the list lives in `ci.yml` and in `check:boundaries`; the failure mode is one-directional and silent — a gate in the script and not the workflow stops gating merges with a green build. Scoped to the `id: gate_*` steps, because `check:deployment-surface` and `check:release-drafts` deliberately run after the build and need a token and the network. It found its own step missing on the first run |
| Bundle budget | `check-bundle-budget.mjs` measures every route's first-load JS from `.next/app-build-manifest.json` and fails past a per-route ratchet, as a CI step after the build and in `check:all`. What it measured is in the script's header: `/reader` is 207 KB and `/graph` 342 KB — **pdf.js and the force graph are already behind dynamic imports**, the half of `WF-P07` the audit could not confirm. The heavy routes are the list screens (`/papers` 483 KB, `/report` 475, `/notes` 467), and the lead is concrete: `components/markdown/markdown.tsx` statically imports `katex` and is loaded by four route modules |
| `SEC-05` / `WF-B09` | The connect is pinned. `pinnedRequest` dials the vetted IP while presenting the hostname as TLS SNI, as the `Host` header and as the certificate name, and supplies a `lookup` returning the same address; redirect hops resolve, check and pin again. Node's `http`/`https`, not `undici`, because this module is shared with the Electron main process where a dispatcher is not guaranteed. Tests assert the pinned address, because the old `stubFetch` could not |
| `SEC-06` | A per-user token bucket on `/api/fetch-url?as=image`: twenty in a burst, one refilled every two seconds. Per process, which suffices because the deployment serves the web app from one; multi-instance would need the counter in Postgres. **The streaming variant stays undone on purpose** — it removes the server-side copy and not the client's, and costs the exact `Content-Length` header |
| `SEC-02` | The allowlist had already been trimmed (Phase 1): no `3000`, no `5000`. `docs/SECURITY.md` now says what the policy is and where an operator extends it |
| `BUG-18` | **Not "already covered"** — a failed index build still set `ready` in a `.finally`, so every caller took the ranked path, got an empty result set, and lost its substring fallback with no retry. It flips only on success now. The hook takes an injected container and schedules with `globalThis`, which is what made the failure branch reachable only in production |
| `BUG-02` | Already fixed in Phase 1: the effect depends on `[cacheKey, screen]` and reads `loadRef.current()`, so an inline closure no longer re-issues the load |
| Docs corrections | The E2EE claim (`0099` drops all seven tables — it said no migration did), the migration table stopping at `0094` while the chain runs to `0131`, `_shared.ts`'s migration numbers (`0129`, not `0130`), this folder's description of itself, and the same class elsewhere: `README.md`'s prerequisites, setup steps, `0001…0117` and "900+ tests"; `docs/running/backend.md`'s "today the default is Supabase"; `docs/running/storage/README.md`'s "default today" and "Phase 1 target" |
| `ARCH-04` rule, widened gate roots, registry test | Landed in Phase 4, which is what those items asked for |

**Debt taken on, counted rather than hidden.** Twenty-seven `select("*")` sites remain across sixteen adapters, listed by file and count in `check-dry.mjs`. They are the reads whose row type is named by a mapper a few lines away rather than at the call, so each needs a person; the gate forbids a new one and forbids any of those counts rising.

**The deployment reality, checked rather than assumed.** The stack is self-hosted Postgres + PostgREST + Realtime on OCI with MinIO blobs, and Supabase Auth issuing the tokens. Where a code default really is still `supabase` — the blob provider with no env set, the PostgREST backend *provider id* — the docs now say so and distinguish it from what the deployment runs, instead of pretending a default changed.

After Phase 0 + Phase 1, `npm run check:all` is **green end to end** — typecheck, lint, all seven boundary gates, core, web, pglite integration, desktop tests, a real `next build` and the bundle budget:

| Suite | Before | After Phase 1 | After Phase 2 | After Phase 3 | After Phase 4 | After Phase 5 | After Phase 6 | After Phase 7 |
|---|---|---|---|---|---|---|---|---|
| core | 1214 | 1231 | 1239 | 1248 | 1247 | 1247 | 1267 | 1267 |
| web | 1428 | 1439 | 1439 | 1466 | 1474 | 1487 | 1510 | 1523 |
| pglite integration | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| desktop | 237 | 237 | 237 | 237 | 237 | 237 | 237 | 237 |
| python (`pytest`) | 76 | 84 (+3 skipped) | 84 (+3 skipped) | 84 (+3 skipped) | 84 (+3 skipped) | 84 (+3 skipped) | 84 (+3 skipped) | 84 (+3 skipped) |
| files the boundary gates search | 675 | 675 | 676 | 677 | 702 | 702 | 705 | 713 |

Core goes 1248 → 1247 because one test moved out of it: `describeRejection`'s completeness assertion now lives beside the prose it checks.

One thing it needs: `npm run docs:generate`, because the generated line counts in `docs/building/architecture-map.md` move with every source commit — including the commits that fix things. That is why `check:all` was red before any of this work started.
