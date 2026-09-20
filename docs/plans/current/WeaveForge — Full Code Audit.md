# WeaveForge Code Audit

Repository: [Satwik-Miyyapuram/weaveforge](https://github.com/Satwik-Miyyapuram/weaveforge) · branch `main`

Total findings: 31 · Fixed: 0

## Bugs & Fixes

### WF-B01 — CRDT compaction deletes updates before advancing the snapshot pointer — data-loss window

**File:** `packages/core/src/features/collab/application/compact-crdt-log.use-case.ts`

**Problem:** CompactCrdtLogUseCase.execute() calls crdtStore.deleteUpTo(...) FIRST and input.setSnapshotUpto(...) SECOND. If the process dies, the network drops, or setSnapshotUpto rejects after the delete succeeded, the durable update log rows are gone but the recorded snapshot watermark still points at the old position. Any client that loads the snapshot and then replays updates 'from snapshotUpto onwards' will replay from a watermark for which the intervening updates no longer exist.

**How discovered:** Read the use-case directly: the two awaits are sequenced delete-then-persist with no transaction, no compensation, and no error handling between them. Collaborative editing is backed by Yjs over crdt_updates (per docs/using/collaborative-editing.md), so the update log is the durability story.

**Why:** Yjs documents are reconstructed as snapshot + tail of updates. The invariant that keeps this safe is: never destroy an update until the fact that it is baked into a snapshot is durably recorded. Writing in the opposite order makes the destructive step happen before the bookkeeping step, so every compaction has a crash window in which shared notes can silently lose the most recent edits for any client that cold-loads.

**Fix:** Invert the order — persist the watermark first, then delete — or wrap both in a single Postgres transaction (an RPC doing UPDATE snapshot_upto + DELETE in one statement is ideal). deleteUpTo is naturally idempotent, so with the inverted order a crash between the two steps only leaves harmless already-compacted rows that the next compaction sweeps.

**Severity:** Critical · **Confidence:** Verified in source

**Current (delete before bookkeeping):**

```ts
async execute(input) {
  if (input.snapshotUptoId <= 0) return;
  await this.deps.crdtStore.deleteUpTo(     // destructive step first
    input.resourceType, input.resourceId, input.snapshotUptoId);
  await input.setSnapshotUpto(input.snapshotUptoId); // crash here => lost updates
}
```

**Fixed (watermark first, delete is idempotent cleanup):**

```ts
async execute(input) {
  if (input.snapshotUptoId <= 0) return;
  await input.setSnapshotUpto(input.snapshotUptoId); // durable bookkeeping first
  await this.deps.crdtStore.deleteUpTo(              // safe: replay never needs these now
    input.resourceType, input.resourceId, input.snapshotUptoId);
}
// Better still: one Postgres RPC that does both inside a transaction.
```

---

### WF-B02 — latestActivityAt() returns silently wrong data once metric rows exceed the PostgREST row cap

**File:** `apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts`

**Problem:** latestActivityAt() selects ALL (experiment_id, wall_time) rows for the given experiments ordered by wall_time desc, then keeps the first row per experiment in JS. Supabase/PostgREST truncates responses at max-rows (default 1000) without an error. As soon as the listed experiments hold more than ~1000 recent metric points combined, any experiment whose newest point is not inside the first 1000 rows is simply absent from the returned map — the dashboard shows it as having no recent activity, which is false.

**How discovered:** Read the repository adapter: the query has .order(wall_time desc) but no .limit(), no aggregate, and no pagination; the per-experiment max is computed client-side with 'if (out.has(id)) continue'. Combined with PostgREST's silent row cap, correctness depends on the total row count staying under the cap — which a single long training run breaks on day one.

**Why:** A per-group MAX() computed in application code requires the full group to be present. PostgREST caps result sets silently, so the code path degrades from 'correct' to 'wrong' with no exception and no log line. One active run logging every step floods the top of the wall_time ordering and starves every other experiment out of the window.

**Fix:** Compute the aggregate where the data lives. Add a Postgres view or RPC (SELECT experiment_id, MAX(wall_time) FROM experiment_metrics WHERE experiment_id = ANY($1) GROUP BY experiment_id) and call it via .rpc(). One row per experiment comes back regardless of history size — this also erases the transfer cost flagged in WF-P01.

**Severity:** High · **Confidence:** Verified in source

**Current (fetch everything, group in JS):**

```ts
const recent = await rows(
  this.db.from(TABLE)
    .select("experiment_id, wall_time")
    .in("experiment_id", [...experimentIds])
    .not("wall_time", "is", null)
    .order("wall_time", { ascending: false }),  // no limit; capped at 1000 silently
);
for (const row of recent) {
  if (out.has(row.experiment_id)) continue;      // needs the FULL set to be correct
  ...
}
```

**Fixed (aggregate in Postgres via RPC):**

```sql
create or replace function latest_metric_activity(ids uuid[])
returns table (experiment_id uuid, last_wall_time timestamptz)
language sql stable as $$
  select experiment_id, max(wall_time)
  from experiment_metrics
  where experiment_id = any(ids) and wall_time is not null
  group by experiment_id
$$;
-- adapter: await this.db.rpc("latest_metric_activity", { ids: [...] })
```

---

### WF-B03 — history() silently truncates metric curves at the row cap — charts render partial data

**File:** `apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts`

**Problem:** history(experimentId, metric?) does select('*') with ordering but no .range()/.limit() handling. A run that logged more than max-rows points (1000 steps of val_loss is nothing for a training job) gets its curve silently cut off. The compare view and overlaid charts then draw a curve that ends early, which for a researcher reads as 'training stopped/diverged here' — a quietly misleading result in a tool whose whole job is showing runs truthfully.

**How discovered:** Read the adapter: no pagination loop, no limit awareness, no warning to the caller. The Python SDK is the writer and logs per step (README example logs 1000 steps in a toy loop), so real curves exceed the cap routinely.

**Why:** PostgREST enforces max-rows server-side and returns a 200 with a partial body. Code that assumes 'select returns all rows' is correct only below the cap; above it there is no error path, so the bug is invisible in tests with small fixtures and appears only on real workloads.

**Fix:** Page through results with .range(offset, offset + PAGE - 1) in a loop until a short page is returned (correctness), and layer WF-P02's downsampling on top so the browser never needs 100k points to draw an 800px chart. If migration 0115's metric chunks are the intended read path, port history() to read chunks instead of raw rows.

**Severity:** High · **Confidence:** Verified in source

**Fixed (paginate until short page):**

```ts
const PAGE = 1000;
const all: MetricRow[] = [];
for (let from = 0; ; from += PAGE) {
  let q = this.db.from(TABLE)
    .select("metric, step, value, wall_time")   // project only what toDomain needs
    .eq("experiment_id", experimentId)
    .order("metric").order("step")
    .range(from, from + PAGE - 1);
  if (metric) q = q.eq("metric", metric);
  const page = await rows<MetricRow>(q);
  all.push(...page);
  if (page.length < PAGE) break;
}
return all.map(toDomain);
```

---

### WF-B04 — Python SDK: a run whose sync/flush fails on the success path is stuck as 'running' forever

**File:** `python/weaveforge/tracking.py`

**Problem:** In track(), the success path runs run.sync(...) for each sync source, then run.flush(), then run.set_status(status_on_success) — in that order, unguarded, inside the else: block. If a sync source or the flush raises (network blip, bad TensorBoard path, server hiccup), set_status is never reached and the except BaseException handler does NOT fire (it only guards the yield). The experiment stays 'running' in the dashboard forever even though training finished.

**How discovered:** Read tracking.py. The docstring of _finalise_failed explicitly states the invariant — 'the status is written first, so a flush that cannot reach the server can no longer leave the run marked running forever' — and then the success path three lines above violates that exact invariant.

**Why:** try/except/else semantics: exceptions raised in the else clause are not caught by the except clause. The failure path was hardened (status first, both steps guarded) but the success path was written as the happy path only, so the two finalisation paths enforce different invariants. This is duplication-by-divergence: the same concept (finalise a run) implemented twice with different guarantees.

**Fix:** Extract one _finalise(run, outcome) used by both paths that (1) always stamps a terminal status first, guarded, (2) then attempts sync + flush, and (3) if success-path sync/flush raised, downgrades the status to 'failed' (guarded) and re-raises so the user sees the error. See WF-C01 for the structural refactor.

**Severity:** High · **Confidence:** Verified in source

**Current (else-block is unguarded; status last):**

```python
else:
    if sync:
        for source_id, ref in dict(sync).items():
            run.sync(source_id, ref)   # raises => set_status never runs
    run.flush()                        # raises => set_status never runs
    run.set_status(status_on_success)
```

**Fixed (terminal status can no longer be skipped):**

```python
else:
    run.set_status(status_on_success)      # stamp terminal state first
    try:
        for source_id, ref in dict(sync or {}).items():
            run.sync(source_id, ref)
        run.flush()
    except Exception:
        _best_effort("mark the run failed", lambda: run.set_status("failed"))
        raise                               # surface the real error to the user
```

---

### WF-B05 — Python SDK: track() leaks the HTTP connection pool when run creation fails

**File:** `python/weaveforge/tracking.py`

**Problem:** track() opens its own connection (ctx = container or _connect(project)) and only closes it in the finally: of the try block that starts AFTER _start_run(...). _start_run performs network I/O (container.manage_experiment.add) and _open_mirror can raise TypeError. If either raises — auth error, project not found, bad mirror id — the context manager exits before reaching its try/finally, and the httpx pool the call opened is never closed.

**How discovered:** Read the control flow in track(): connect → _open_mirror → _start_run all execute before the try: that owns the finally: _close_owned(ctx). Any exception in that prologue skips cleanup entirely.

**Why:** Resource acquisition and the guard that releases it are separated by fallible code. In long-lived processes (notebooks, sweep drivers calling track() in a loop against a flaky server) each failed attempt strands sockets and file descriptors.

**Fix:** Acquire the connection inside the guarded region — wrap everything after _connect in try/finally (or use contextlib.ExitStack registering _close_owned immediately after connecting, and mirror.close right after _open_mirror).

**Severity:** High · **Confidence:** Verified in source

**Fixed shape (guard from the moment of acquisition):**

```python
ctx = container or _connect(project=project)
owns_connection = container is None
try:
    mirror = _open_mirror(mirror_id, sources, name, config or {})
    try:
        run = _start_run(ctx, name, ..., mirror=mirror)
    except BaseException:
        if mirror is not None:
            _best_effort("close the mirror", mirror.close)
        raise
    ...  # existing yield / finalisation logic
finally:
    if owns_connection:
        _close_owned(ctx)
```

---

### WF-B06 — Python SDK: an opened mirror run is orphaned if experiment creation fails

**File:** `python/weaveforge/tracking.py`

**Problem:** track() evaluates _open_mirror(...) as an argument to _start_run(...). Python evaluates arguments first, so the mirror (e.g. a live wandb run) is opened before the WeaveForge experiment exists. If container.manage_experiment.add(...) then raises, nothing closes the mirror: the wandb run is left open/running on the remote service with no owner.

**How discovered:** Read the call site: mirror=_open_mirror(...) inline in the _start_run call, with no surrounding try that could close it; the only thing that ever closes the mirror is the Run, which is never constructed on this path.

**Why:** Two remote resources are created in sequence with no compensation for partial success. The second failing strands the first — the classic two-phase acquisition problem, solved by acquiring into a scope that can release (ExitStack) rather than into an argument list.

**Fix:** Open the mirror as a named resource inside the guarded region (see the WF-B05 fixed shape): open mirror → try to start run → on failure, best-effort mirror.close() (or mirror.finish(failed)) before re-raising.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-B07 — @track_experiment silently misbehaves on async training functions

**File:** `python/weaveforge/tracking.py`

**Problem:** The decorator's wrapper is synchronous: with track(...) as run: result = fn(*args, **kwargs). Applied to an async def train(), fn(...) merely returns a coroutine — the context manager then immediately flushes and stamps the run 'done' before a single training step executed. The returned coroutine is also not a dict, so summary metrics are never recorded. No error is raised; the user just gets an empty, instantly-'done' experiment.

**How discovered:** Read track_experiment(): there is no inspect.iscoroutinefunction branch and only one synchronous wrapper. Async training entry points are common with modern data loaders and RL frameworks.

**Why:** Decorators that wrap 'call fn and use its return value' semantics must special-case coroutine functions, because calling one performs no work. The failure mode is silent by construction — everything 'succeeds', just meaninglessly.

**Fix:** Detect coroutine functions and emit an async wrapper (async with / await), or at minimum raise TypeError('track_experiment does not support async functions yet') so the failure is loud instead of silent.

**Severity:** Medium · **Confidence:** Verified in source

**Fixed (dedicated async wrapper):**

```python
if inspect.iscoroutinefunction(fn):
    @wraps(fn)
    async def async_wrapper(*args, **kwargs):
        cfg = _captured_config(kwargs)
        with track(name or fn.__name__, config=cfg, **track_kwargs) as run:
            if wants_run:
                kwargs.setdefault(inject, run)
            result = await fn(*args, **kwargs)
            if isinstance(result, dict):
                run.log_summary(result)
            return result
    return async_wrapper
```

---

### WF-B08 — CRDT compaction has no monotonicity guard — a stale caller can move the snapshot watermark backwards

**File:** `packages/core/src/features/collab/application/compact-crdt-log.use-case.ts`

**Problem:** The only validation on snapshotUptoId is '<= 0 return'. Two clients can compact concurrently (co-editing means multiple writers by design). If a client holding an older snapshot calls execute() after a newer compaction ran, setSnapshotUpto happily rewinds the watermark to the older id. Clients then replay updates from a rewound watermark — at best redundant work, at worst inconsistent reconstruction depending on how the loader treats the range.

**How discovered:** Read the use-case: no read of the current watermark, no compare, no CAS. The collab docs describe multi-user live documents, so concurrent compaction attempts are a normal condition, not an edge case.

**Why:** A watermark is only safe if it is monotonic. Enforcing monotonicity in application code requires read-compare-write (racy) — the reliable place is the database: a conditional UPDATE ... SET snapshot_upto = $1 WHERE snapshot_upto < $1, which also composes with the WF-B01 transactional fix.

**Fix:** Make setSnapshotUpto conditional/monotonic at the SQL layer (WHERE snapshot_upto < new_value; skip delete when 0 rows updated). Combined with WF-B01's ordering fix, compaction becomes a single idempotent, monotonic RPC.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-B09 — DNS-rebinding window: url-safety's contract is only as strong as address pinning at fetch time

**File:** `packages/core/src/net/url-safety.ts (contract) + fetch-for-paste callers`

**Problem:** url-safety.ts is deliberately pure policy: its header says 'the caller resolves the hostname and asks about every address it got back'. That check-then-fetch shape is vulnerable to DNS rebinding unless the subsequent fetch connects to the exact vetted IP: an attacker's domain answers a public A record for the resolver's lookup, then a private one (127.0.0.1, 169.254.169.254) for the connection's lookup. The policy module cannot prevent this by design — the guarantee lives in the caller.

**How discovered:** Read the module contract and the README's description of fetch-for-paste (used by both the API route and the Electron main process). The policy file is excellent; the risk is the seam it explicitly delegates: whether callers connect to the resolved-and-vetted address or re-resolve.

**Why:** Between validation-time resolution and connect-time resolution there is a second, attacker-controlled DNS answer (TTL 0). Node's fetch/undici re-resolves unless given a pinned address via a custom lookup/Agent. Redirect hops multiply the windows — each hop needs shape-check + resolve + pinned connect.

**Fix:** In fetch-for-paste: resolve once, run isPublicAddress over every returned address, then connect to that vetted IP (undici Agent with a custom lookup that returns the pinned address, preserving Host/SNI from the original hostname). Re-apply the full pipeline on every redirect hop (maxRedirects is already in the limits object). Add a regression test with a stub resolver that flips answers between calls.

**Severity:** High · **Confidence:** Needs verification

---

### WF-B10 — Concept classifier labels every 2–6 letter acronym a 'method' — ICLR and MNIST become methods

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** classify() checks /^[A-Z]{2,6}$/ first and returns 'method' before any other rule runs. Venue acronyms (ICLR, ACL, CVPR), dataset acronyms (MNIST, GLUE, COCO) and metric acronyms (BLEU, AUC) all get kind 'method'. The dataset/metric/venue keyword rules below can never fire for acronyms.

**How discovered:** Read classify(): rule order makes the acronym branch shadow every later branch for all-caps tokens; the later branches match words like 'dataset'/'accuracy' that acronyms never contain anyway.

**Why:** Rule precedence encodes 'acronym implies method', which is false for the most common acronyms in research writing. Since concepts seed the wiki/graph, systematic miskinding puts venues and datasets in the wrong buckets everywhere downstream.

**Fix:** Check small known-acronym lists (venues: ICLR/NEURIPS/ICML/ACL/CVPR...; datasets: MNIST/CIFAR/COCO/GLUE...; metrics: BLEU/AUC/MAP...) before falling back to 'method' for unknown acronyms — or return 'concept' for unknown acronyms and let the model extractor refine the kind.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-B11 — A concept's kind is frozen by whichever mention is seen first — a deliberate #tag cannot correct a guess

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** record() does counts.get(key) ?? { name, kind, ... } — name and kind are set on first insertion and never reconsidered. If 'Transformer' is first harvested as a capitalised-phrase guess and later appears as an explicit #transformer tag (which the module's own comments call a stated, deliberate signal), the tag's kind and casing are discarded.

**How discovered:** Read record(): the merge strategy for an existing entry only adds to entry.documents; the code's comment hierarchy ('signals the user authored deliberately come first') is honored per-document by loop order, but not across documents or across the aggregate.

**Why:** First-write-wins is the wrong merge policy when signals have explicit priority. The module already defines the priority (stated > guessed) for the keep/drop decision, but not for the kind/name decision — an inconsistency within one function.

**Fix:** Carry a source strength on each record call (stated vs guessed) and upgrade the stored entry's kind/name when a stronger signal arrives: if (incoming.strength > entry.strength) { entry.kind = incoming.kind; entry.name = incoming.name; }.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-B12 — @track_experiment: passing the run positionally while it is also injected raises TypeError

**File:** `python/weaveforge/tracking.py`

**Problem:** wrapper does kwargs.setdefault(inject, run) whenever the function declares a 'run' parameter. If the caller supplies that parameter positionally (e.g. re-invoking the wrapped function with an explicit run, or 'run' not being first), Python receives the argument twice — once positionally, once via kwargs — and raises TypeError: got multiple values for argument 'run'.

**How discovered:** Read wrapper(): setdefault only protects against a keyword collision, not a positional one; *args is passed through blindly.

**Why:** The injection decision is made against the signature but the actual binding of *args to parameters is never inspected, so the guard checks the wrong namespace.

**Fix:** Bind arguments properly before injecting: bound = signature.bind_partial(*args, **kwargs); if inject not in bound.arguments: kwargs.setdefault(inject, run). This also fixes hyperparameter capture for positional args (see WF-C07 note).

**Severity:** Low · **Confidence:** Verified in source

---

## Speed & Space Optimizations

### WF-P01 — latestActivityAt() downloads the entire metric history of every listed experiment to compute one MAX per group

**File:** `apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts`

**Problem:** To answer 'when did each experiment last log?', the adapter pulls every (experiment_id, wall_time) row for all requested experiments over the network and reduces to a per-experiment max in the browser. For 20 experiments averaging 50k logged points that is a ~1M-row transfer to produce a 20-entry map — on a code path that runs when the experiments list renders.

**How discovered:** Read the query: select of raw rows, order desc, no aggregate, no limit; the reduction ('if out.has(id) continue') happens client-side. Transfer cost is O(total points logged), while the information content is O(number of experiments).

**Why:** Aggregation is being done on the wrong side of the wire. Postgres computes MAX...GROUP BY over an index in milliseconds without shipping rows; shipping raw rows makes list-page latency scale with total training history — the one quantity guaranteed to keep growing for the life of a thesis.

**Fix:** Same RPC as WF-B02: SELECT experiment_id, MAX(wall_time) ... GROUP BY experiment_id, backed by an index on (experiment_id, wall_time DESC). Transfer drops from O(points) to O(experiments); this single change likely dominates every other dashboard optimization.

**Severity:** Critical · **Confidence:** Verified in source

**Supporting index:**

```sql
create index if not exists experiment_metrics_exp_wall_idx
  on experiment_metrics (experiment_id, wall_time desc)
  where wall_time is not null;
```

---

### WF-P02 — history() ships every logged step with select('*') — charts need at most a few thousand points

**File:** `apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts`

**Problem:** The curve query selects all columns of all rows for an experiment. A 200k-step run with 5 metrics is a million rows requested for a chart that is ~800 physical pixels wide. Payload includes columns toDomain may not even use (id, user_id, created_at). Today the row cap hides the cost by truncating (WF-B03); once pagination fixes correctness, the full transfer cost lands unless downsampling lands with it.

**How discovered:** Read the adapter: select('*'), no column projection, no limit/downsample parameter on the port. The README's compare view overlays multiple runs, multiplying the cost per screen.

**Why:** Rendering needs a bounded number of points per pixel column; fetching more is pure waste in transfer time, JSON parse time, and chart-library layout time. Overlaid comparisons multiply it by the number of runs compared.

**Fix:** Two layers: (1) project only the columns toDomain maps (metric, step, value, wall_time); (2) downsample server-side — either a bucketed SQL aggregate (group steps into N buckets, avg or min/max per bucket) or read the pre-chunked representation migration 0115 introduced. Expose maxPoints on the read port so the chart declares its budget.

**Severity:** High · **Confidence:** Verified in source

**Bucketed downsample (SQL sketch):**

```sql
select metric,
       (step / greatest(1, (max_step / $buckets)))::int as bucket,
       avg(value) as value,
       max(step)  as step
from experiment_metrics, (select max(step) as max_step from experiment_metrics
                          where experiment_id = $1) m
where experiment_id = $1
group by metric, bucket
order by metric, step;
```

---

### WF-P03 — Lexical extractor parses every document twice — hashtags and wikilinks are extracted two times per doc

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** extract() loops over request.documents once to record concepts (calling extractHashtags + extractWikilinks per document), then loops over ALL documents a second time solely to rebuild the set of 'stated' concept keys — calling extractHashtags and extractWikilinks again on the same text. Every regex pass over every document runs twice.

**How discovered:** Read the two consecutive for-loops over request.documents; the second exists only because the stated-set wasn't collected during the first pass, where the exact same extraction results were already in hand.

**Why:** The stated set is a byproduct the first loop already computes and throws away. On a vault-sized corpus (hundreds of pages fed to the wiki planner) this doubles the dominant cost of the whole extraction for zero benefit — and it is also a DRY hazard: two call sites that must agree on how 'stated' is derived (see WF-C05).

**Fix:** Add stated.add(conceptKey(...)) inside the first loop where tags and links are already being recorded, and delete the second loop entirely.

**Severity:** Medium · **Confidence:** Verified in source

**Fixed (collect during the single pass):**

```ts
const stated = new Set<string>();
for (const document of request.documents) {
  ...
  for (const tag of extractHashtags(raw)) {
    stated.add(conceptKey(tag));                 // collected here, once
    record(tag, document.id, classifyTag(tag), evidence);
  }
  for (const link of extractWikilinks(raw)) { /* same pattern */ }
}
// second loop over request.documents: deleted
```

---

### WF-P04 — evidenceFor() lowercases the whole document for every single mention

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** evidenceFor(text, needle) begins with text.toLowerCase().indexOf(needle.toLowerCase()). It is called once per recorded mention, and each call allocates a fresh lowercase copy of the entire document and scans it from the start. A 50KB note with 80 mentions allocates ~4MB of throwaway strings and does 80 full scans.

**How discovered:** Read evidenceFor and its call sites inside the per-document loops: the receiver text ('plain') is identical across all calls for a document, but the lowercase conversion lives inside the callee, so it cannot be amortized.

**Why:** A per-call invariant (the lowercased document) is computed inside the loop body. Worse, for regex-harvested phrases the match offset was already known from re.exec — the position is being re-discovered by a second search that also had to pay the lowercase cost.

**Fix:** Lowercase once per document and pass it in (evidenceFor(plain, plainLower, needle)) — or better, thread the match index from the regex loop straight into a snippetAt(text, index, length) function so no re-search happens at all.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-P05 — conceptKey() recomputed four times per concept across the extraction pipeline

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** The same normalization is recomputed in record(), in the stated-set builder, in the survivors filter (conceptKey(entry.name)), in the kept-set builder, and per-mention in the final mentions.filter(conceptKey(mention.conceptName)). For M mentions that last filter alone is M extra normalizations of strings whose keys were known when the mention was created.

**How discovered:** Traced every conceptKey call site through extract(); mentions never store their key even though record() computes it on the line above the mentions.push.

**Why:** Normalization results are cheap individually but the pipeline discards and recomputes them at every stage; storing the key once removes a whole class of 'did every stage normalize identically?' bugs along with the waste.

**Fix:** Store key on the mention and on the aggregate entry at record() time; every later stage compares precomputed keys (kept.has(mention.key)).

**Severity:** Low · **Confidence:** Verified in source

---

### WF-P06 — Two separate full-text regex passes (capitalised phrases, then acronyms) over the same document

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** The phrase loop runs CAPITALISED_PHRASE over the full plain text, then restarts from position 0 with ACRONYM over the same text. Acronyms are also a subset of what the first pattern can match, so many tokens are matched twice and rejected once by the seenInDoc set.

**How discovered:** Read the for (const re of [CAPITALISED_PHRASE, ACRONYM]) loop: two exec-loops over identical input, with dedupe patching up the overlap afterwards.

**Why:** Regex scanning is the hot inner loop of this extractor; a single alternation pass halves it and removes the overlap-then-dedupe dance.

**Fix:** Combine into one pattern with named groups (or keep two patterns but run them over the text in a single merged pass), classifying by which group matched.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-P07 — Keep force-graph, PDF reader, chart, and Yjs code out of the initial bundle

**File:** `apps/web/src/features/{graph,reader,experiments,collab}/ui`

**Problem:** The app ships an Obsidian-style force graph, a PDF reader with annotations, metric charting, and a Yjs CRDT editor. Each of these pulls a heavyweight browser-only library. If any of them is imported statically from a module that participates in the shared layout or the feature registry, it lands in the first-load JS for every page — including sign-in.

**How discovered:** Architecture-level: registry.ts builds nav across features, which is exactly the pattern that accidentally makes a static import graph reach every feature's UI. Not confirmed against each import site — hence advisory.

**Why:** Force-graph (canvas/WebGL), pdf.js (~1MB+), charting and Yjs together can triple first-load JS. Next.js only splits what is dynamically imported or route-isolated; a registry that imports feature UI eagerly defeats route splitting.

**Fix:** Audit with next build + @next/bundle-analyzer. Ensure the registry maps to next/dynamic(() => import(...), { ssr: false }) component references, not direct imports. Load pdf.js worker via worker-src URL, and Yjs only inside the editor route. Set a size budget in CI so regressions fail the build.

**Severity:** Medium · **Confidence:** Advisory

---

### WF-P08 — Dead E2EE schema (migrations 0037–0041, 0089–0095) still created in every fresh install

**File:** `supabase/migrations/`

**Problem:** The README states these migrations created client-side E2EE key tables, the feature was dropped, nothing reads them — and no migration removes them. Every new self-hosted install provisions dead tables, indexes, and their RLS policies; every schema reader (and every security reviewer) must rediscover that they are inert.

**How discovered:** Stated directly in the repository README's Database section; confirmed against the migrations listing.

**Why:** Dead schema is dead code with a maintenance surface: backup size, migration replay time, pg_dump noise, and — worse — RLS policies on key-material tables that people must keep auditing even though the answer is 'unused'.

**Fix:** Ship one migration (e.g. 0118_drop_e2ee_tables.sql) that drops the unused tables/policies, with a guard comment for anyone who somehow wrote to them. Update the migrations README so the tombstone is documented once, in code.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-P09 — Metric writes: ensure per-step logging buffers into batched inserts matched to the chunked storage (0115)

**File:** `python/weaveforge/features/experiments + supabase migration 0115`

**Problem:** run.log_metric is called per training step; migration 0115 introduced 'experiment metric chunks' on the storage side, while the web adapter still reads the per-point experiment_metrics table (verified in supabase-metric-repository.ts). If the SDK's flush inserts point-rows while storage optimizes for chunks — or if any path still writes one row per log call — both write amplification and the read-side problems above persist.

**How discovered:** Cross-referenced the migrations README (0115 metric chunks) with the verified read path, which targets the row-per-point table from migration 0016. The SDK's flush internals were not fetched — hence advisory on the write side.

**Why:** One row per training step is the single biggest space/write cost in an experiment tracker: 500k steps × 5 metrics = 2.5M rows per run, plus index bloat. Chunked storage (one row per N steps per metric, values packed as arrays/bytea) cuts row count by 100–1000× and makes the read path a handful of rows.

**Fix:** Make chunks the one canonical representation: SDK buffers points and flushes fixed-size chunks; web reads chunks (fixing WF-B03/WF-P02 at the root); keep the point table only as a legacy-read fallback until backfilled, then drop it.

**Severity:** Medium · **Confidence:** Advisory

---

## Clean Code · SOLID · DRY

### WF-C01 — Run finalisation exists twice with different guarantees — extract one finaliser (root cause of WF-B04)

**File:** `python/weaveforge/tracking.py`

**Problem:** The 'finish a run' concept is implemented twice: _finalise_failed (status first, every step guarded, never raises) and the inline else-block in track() (status last, nothing guarded). Two implementations of one responsibility, holding different invariants — and the divergence is precisely the WF-B04 bug.

**How discovered:** Compared the else-block against _finalise_failed while reading track(); the docstring of the failure path documents an invariant the success path violates.

**Why:** DRY is not about identical text, it is about one authority per rule. The rule 'a run must always end in a terminal status, stamped before fallible I/O' currently has two authorities that disagree. Any future change (say, a new terminal status) must be remembered in both places.

**Fix:** One _finalise(run, *, status, sync=None, strict) used by both paths: stamp status first (guarded), then sync/flush (guarded on the failure path, raising on the success path after downgrading status). track()'s body shrinks to orchestration only.

**Severity:** High · **Confidence:** Verified in source

---

### WF-C02 — container: Any + nested getattr chains in a py.typed SDK — define Protocols for the ports (DIP/ISP)

**File:** `python/weaveforge/tracking.py`

**Problem:** The SDK ships py.typed, yet its front door types the container as Any and discovers capabilities by string: getattr(getattr(container, 'artifacts', None), 'upload', None) and getattr(getattr(container, 'api', None), 'close', None). Misspell 'artifacts' in a refactor and uploads silently vanish — the getattr chain returns None and the Run just has no uploader.

**How discovered:** Read _start_run and _close_owned. Both reach two levels deep into an untyped object; neither failure mode is observable (both degrade to None/no-op).

**Why:** Dependency Inversion asks the high-level module to name the interface it needs; here it instead sniffs at runtime, so type-checking (which the project explicitly ships to users) is blind exactly at the seam where in-memory test containers are swapped for real ones. Law of Demeter: track() needs 'an uploader' and 'a closer', not knowledge that they hang off .artifacts and .api.

**Fix:** Define small Protocols — SupportsExperiments (manage_experiment), SupportsArtifacts (upload), SupportsClose — type the container parameter as an intersection-ish Protocol, and let mypy verify both the real container and the in-memory test one. Runtime getattr sniffing disappears.

**Severity:** High · **Confidence:** Verified in source

**Protocol-based ports:**

```python
class ExperimentPort(Protocol):
    def add(self, data: NewExperimentInput) -> Experiment: ...

class TrackingContainer(Protocol):
    manage_experiment: ExperimentPort
    artifacts: ArtifactPort | None
    def close(self) -> None: ...

def track(..., container: TrackingContainer | None = None, ...):
```

---

### WF-C03 — LexicalConceptExtractor.extract() does six jobs in one method (SRP)

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** One method strips markdown, harvests stated signals (tags/links), harvests guessed signals (regex phrases), aggregates counts via a captured closure (record), derives the stated-set, filters/ranks, applies the maxConcepts cap, and re-filters mentions. The record closure mutates two collections from four call sites, which is why the merge-policy bug (WF-B11) and the double-parse (WF-P03) could hide in plain sight.

**How discovered:** Read extract() end to end; counted distinct responsibilities and the shared mutable state threading through them.

**Why:** SRP at function scale: each of these stages has its own reasons to change (markdown syntax, signal sources, ranking policy, output shaping). Fusing them means every change risks every stage, and none of the stages can be unit-tested in isolation — in a codebase whose README leads with 'Built TDD + SOLID'.

**Fix:** Decompose into pure functions with explicit data flow: harvestStated(doc), harvestGuessed(plain), mergeMentions(all) (owning the merge policy — fixes WF-B11 by design), rankAndLimit(concepts, max), projectMentions(kept). extract() becomes a five-line composition.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-C04 — IMetricRepository mixes the curve store with a dashboard read-model (ISP)

**File:** `packages/core (IMetricRepository) + apps/web experiments infrastructure`

**Problem:** One port carries append (writer: Python SDK), history (chart read), and latestActivityAt (list-page 'freshness' read-model). Every implementor — including in-memory test doubles — must implement all three, and the aggregate-shaped query is forced through a row-shaped repository interface, which is exactly why it was implemented as fetch-all-rows (WF-P01/WF-B02).

**How discovered:** Read the adapter implementing all three methods; the third returns a Map keyed by experiment — a read-model shape, not a repository-of-rows shape.

**Why:** Interface Segregation: clients should not depend on methods they don't use — and interfaces shape implementations. A row-repository interface invites row-fetching implementations; a read-model port invites a SQL aggregate. The wrong port made the slow implementation the path of least resistance.

**Fix:** Split into MetricWriter (append), MetricHistoryReader (history with a maxPoints budget), and ExperimentActivityReader (latestActivityAt backed by the WF-B02 RPC). The dashboard facade composes the two readers; the SDK sees only the writer.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-C05 — The definition of a 'stated' concept lives in two loops that must stay in sync (DRY)

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** 'Stated' (user-authored tag or wikilink) is derived twice: implicitly in the first loop (which records them) and explicitly in the second loop (which rebuilds the set from scratch). Today the second loop trims wikilink targets slightly differently territory: the first loop checks target.trim() truthiness before recording, the second adds conceptKey(link.target) unconditionally — the two derivations already disagree on empty-target links.

**How discovered:** Diffed the two loops line by line: loop one skips empty trimmed targets; loop two does not, so the stated-set can contain keys for links that were never recorded.

**Why:** Two derivations of one concept drift — they already have. Every future change to what counts as 'stated' (aliases? case rules?) must be applied twice, and a miss produces subtle keep/drop differences in the concept list rather than an error.

**Fix:** Single derivation: collect stated keys in the first pass at the exact point of recording (also the WF-P03 perf fix). One code path, one truth, second loop deleted.

**Severity:** Medium · **Confidence:** Verified in source

---

### WF-C06 — classify(name, fromTag) — boolean-flag parameter switching between two behaviors

**File:** `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`

**Problem:** classify takes fromTag: boolean and branches on it mid-rule-list. A flag argument means the function has two callers wanting two behaviors — the definition of a function doing two things. Call sites read as classify(tag, true) / classify(phrase, false), which is meaningless at a glance.

**How discovered:** Read classify() and its call sites; the boolean selects which rule subset applies.

**Why:** Flag parameters couple both behaviors into one body, invite a third flag later, and hide intent at call sites. Splitting yields two smaller functions, each trivially testable, with self-describing names.

**Fix:** classifyStated(name) and classifyGuessed(name), sharing the keyword-rule helpers they actually have in common. Call sites become self-documenting.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-C07 — Hyperparameter capture inspects kwargs only — positional args are silently not captured

**File:** `python/weaveforge/tracking.py`

**Problem:** capture_hyperparams iterates kwargs.items(), so train(lr=1e-4, batch=64) captures both, while train(1e-4, 64) — the same call, same function — captures nothing. Whether config appears in the dashboard depends on the caller's calling convention, not on the function's signature.

**How discovered:** Read wrapper(): only the kwargs dict is examined; *args is never bound to parameter names.

**Why:** The feature's contract ('simple keyword hyperparameters are captured') encodes an implementation detail as a user-facing rule. inspect.signature is already imported and used one line above (wants_run) — the tool to do this properly is in hand.

**Fix:** Use sig.bind_partial(*args, **kwargs).arguments as the capture source, filtering the same scalar types. This also provides the binding needed by the WF-B12 fix — one binding, two bugs closed.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-C08 — Best-effort try/except-warn appears three times in one module — extract a helper

**File:** `python/weaveforge/tracking.py`

**Problem:** _finalise_failed contains two copies and _close_owned a third of the same shape: try: <step> except Exception as exc: warnings.warn(f'weaveforge: could not <verb> ({exc})', stacklevel=N). Three hand-rolled copies of one policy (never mask the training error), each with its own stacklevel to keep correct.

**How discovered:** Pattern-counted within tracking.py while reading the finalisation code.

**Why:** The policy 'guarded, warn, continue' is a single decision that should have a single owner; today changing the warning format or adding structured logging means three edits, and the copies can drift (stacklevel already differs by call depth).

**Fix:** def _best_effort(what: str, step: Callable[[], None]) -> None with the try/warn inside; the three sites become one-liners, and WF-B04/WF-B05 fixes reuse it.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-C09 — User-facing English copy inside the core policy module (describeRejection)

**File:** `packages/core/src/net/url-safety.ts`

**Problem:** url-safety.ts is otherwise an exemplary pure-policy module (worth calling out: the IPv6 normalisation commentary and fail-closed defaults are excellent). But describeRejection returns finished English sentences from the domain layer — presentation copy compiled into @weaveforge/core, consumed by web, desktop, and potentially the Python-facing API.

**How discovered:** Read the module: every other export is policy; this one is prose for 'the person who pasted the URL'.

**Why:** SRP across layers: the reason codes (UrlRejection union) are the domain contract; sentences are a UI concern (tone, i18n, platform wording). Baking strings into core means a copy tweak re-ships the domain package and forks per-surface wording later.

**Fix:** Keep the UrlRejection union in core; move describeRejection into the web/desktop presentation layer (a simple Record<UrlRejection, string> beside the paste UI). Core stays prose-free.

**Severity:** Low · **Confidence:** Verified in source

---

### WF-C10 — Duplicate issue templates: both .md and .yml versions of bug_report and feature_request ship together

**File:** `.github/ISSUE_TEMPLATE/`

**Problem:** The template directory contains bug_report.md AND bug_report.yml, feature_request.md AND feature_request.yml. GitHub presents both variants in the 'New issue' chooser, so contributors see two near-identical options per type and the two formats drift independently.

**How discovered:** Listed .github/ISSUE_TEMPLATE in the repository tree: four templates for two issue types.

**Why:** Same DRY rule as code: two sources of truth for one form. The .yml issue-forms are the modern, structured format; the .md ones are the legacy freeform format kept around, probably unintentionally, after the migration.

**Fix:** Delete the two .md templates (config.yml already governs the chooser). One form per issue type remains.

**Severity:** Low · **Confidence:** Verified in source

---


# WeaveForge — code audit

Source: https://github.com/Satwik-Miyyapuram/weaveforge (`main`)

- **Repository:** Satwik-Miyyapuram/weaveforge @ main
- **Reviewed:** v0.6.0 · monorepo (core, web, python, desktop scripts)
- **Method:** Line-by-line read of the files listed under Scope, plus call-graph tracing between them
- **Bias:** Paths that run on every screen load, every write, or every network hop

**Findings: 57** — 14 high, 27 medium, 16 low.
Severity legend: `critical`, `high`, `medium`, `low`.

Every finding below follows one shape: problem, how it was discovered, why it happens, how to fix it, severity.

## Contents

- **Bugs & correctness** (20): BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12, BUG-13, BUG-14, BUG-15, BUG-16, BUG-17, BUG-18, BUG-19, BUG-20
- **Security** (6): SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06
- **Speed** (10): PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, PERF-07, PERF-08, PERF-09, PERF-10
- **Space & memory** (6): MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06
- **SOLID / DRY / clean code** (15): ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ARCH-08, ARCH-09, ARCH-10, ARCH-11, ARCH-12, ARCH-13, ARCH-14, ARCH-15

## Summary

| Category | Critical | High | Medium | Low | Total |
| --- | --- | --- | --- | --- | --- |
| Bugs & correctness | 0 | 5 | 11 | 4 | 20 |
| Security | 0 | 1 | 4 | 1 | 6 |
| Speed | 0 | 3 | 3 | 4 | 10 |
| Space & memory | 0 | 2 | 1 | 3 | 6 |
| SOLID / DRY / clean code | 0 | 3 | 8 | 4 | 15 |
| **All** | **0** | **14** | **27** | **16** | **57** |

## Scope — what was actually read

#### packages/core — domain & policy

- `packages/core/src/net/url-safety.ts` — SSRF policy: scheme, port, host, IPv4/IPv6 classification
- `packages/core/src/features/papers/application/parse-paper-ref.ts` — arXiv/DOI/URL classification of pasted references
- `packages/core/src/features/papers/application/compute-rollup.ts` — Rollup aggregation over related papers' fields
- `packages/core/src/features/papers/application/add-paper.use-case.ts` — Dedupe-on-add orchestration
- `packages/core/src/features/library/application/merge-pinned-screen-data.ts` — Pinned/share merge used by six screens
- `packages/core/src/features/library/application/sync-offer.ts` — One-time offline-sync offer state

#### apps/web — application layer

- `apps/web/src/create-app-container.ts` — Composition root (27 KB)
- `apps/web/src/bootstrap.ts` — Container lifecycle, lazy loading
- `apps/web/src/container/facades/papers.ts` — Papers facade (35 methods)
- `apps/web/src/features/papers/application/load-papers-screen.use-case.ts` — Papers screen load + merge
- `apps/web/src/features/vault/application/load-vault-screen.use-case.ts` — Vault screen load + tree build
- `apps/web/src/features/experiments/application/load-experiments-screen.use-case.ts` — Experiments screen load + merge
- `apps/web/src/features/search/application/workspace-search.ts` — Search index lifecycle, staleness, hybrid query
- `apps/web/src/features/offline-sync/infra/postgrest-transport.ts` — Outbox transport, version guards

#### apps/web — infrastructure & lib

- `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts` — Papers persistence, projections, delta read
- `apps/web/src/backend/net/safe-fetch.ts` — Guarded outbound fetch with per-hop re-check
- `apps/web/src/backend/net/fetch-for-paste.ts` — Title and image fetch on a user's behalf
- `apps/web/src/app/api/fetch-url/route.ts` — Authenticated outbound fetch route
- `apps/web/src/app/api/sdk/_shared.ts` — API token scopes and caller resolution
- `apps/web/src/lib/cache/project-lww-invalidator.ts` — Realtime LWW cache invalidation
- `apps/web/src/lib/cache/cache-invalidation-map.ts` — Write → repos/screens invalidation map
- `apps/web/src/lib/cache/screen-cache.ts` — In-memory screen payload cache
- `apps/web/src/lib/cache/screen-cache-idb.ts` — Versioned screen payload persistence
- `apps/web/src/lib/cache/app-idb.ts` — Shared IndexedDB handle for five stores
- `apps/web/src/container/facades/experiments.ts` — Experiments facade, stale-run reconciliation, artifact signing
- `apps/web/src/features/collab/application/collab-session.ts` — Collab session contract
- `apps/web/src/lib/hooks/use-screen-data.ts` — Stale-while-revalidate screen hook
- `apps/web/src/lib/hooks/use-search-index.ts` — Search index warm-up hook
- `apps/web/src/lib/hooks/use-submit.ts` — Shared form submit state
- `apps/web/src/lib/markdown-image-refs.ts` — Unresolved image reference stripping
- `apps/web/src/lib/image-compress.ts` — Client-side image compression
- `apps/web/src/lib/recent-targets.ts` — Jump-palette recents in localStorage
- `apps/web/src/lib/screen-for-path.ts` — Pathname → screen id
- `apps/web/src/lib/outbound-fetch.ts` — Browser/desktop outbound fetch seam
- `apps/web/src/lib/semantic-scholar-fetch.ts` — Shared retry policy for the S2 relay
- `apps/web/src/lib/perf.ts` — Dev-only timings
- `apps/web/src/lib/workspace-changes.ts` — Workspace change listener bus
- `apps/web/src/lib/client-runtime-recovery.ts` — Service-worker/cache recovery

#### scripts & tooling

- `scripts/check-dry.mjs` — DRY gate (allowlist assertions, per-kind branch rule)
- `scripts/lib/search.mjs` — Shared ripgrep/Node search used by every boundary gate

#### python SDK

- `python/weaveforge/tracking.py` — track/track_experiment entry points, finalisation, mirrors


---

## 1. Bugs and fixes

### BUG-01 — The notes tree is built before pinned pages are merged in

**severity:** High

**category:** Bugs & correctness · **area:** apps/web · vault screen · **effort:** S

**files:** `apps/web/src/features/vault/application/load-vault-screen.use-case.ts`, `apps/web/src/features/papers/application/load-papers-screen.use-case.ts`

**problem:**

A note that reached this project through a share (a library pin, or a share granted to you) appears in the flat list but is missing from the folder tree, so the two panes disagree about what the vault contains.

**how discovered:**

Diffing `LoadVaultScreenUseCase.execute()` against `LoadPapersScreenUseCase.execute()`. Both run the same four-way load and the same `mergePinnedScreenData` call, but papers hands the merged list to the view model and vault hands the pre-merge `owned` array to `buildPageTree`.

**why:**

`mergePinnedScreenData` is the only place that knows how to fold pinned/shared rows into an owned list. `owned` is the raw `pages.listSummaries()` result, which by construction holds only rows this project owns. Building the tree from it silently drops every extra the merge added — the merge is not wrong, its result is just not used for the tree.

**fix:**

Build the tree from the merged list, and derive membership from merged ids so a pinned page also shows its list badges:

```ts
const merged = await mergePinnedScreenData({ /* … */ });
return {
  tree: buildPageTree(merged.items),
  flat: merged.items,
  // …
};
```

Then add a contract test: given one owned page, one pinned page and one share, both `tree` and `flat` contain two ids.

<details><summary>before / after</summary>

```ts
return {
  tree: buildPageTree(owned),   // pre-merge
  flat: merged.items,          // post-merge
  lists,
  membership,
  pinnedSharedBy: merged.pinnedSharedBy,
  vaultCanComment: merged.canComment,
  vaultCanEdit: merged.canEdit,
};
```

```ts
return {
  tree: buildPageTree(merged.items),
  flat: merged.items,
  lists,
  membership,
  pinnedSharedBy: merged.pinnedSharedBy,
  vaultCanComment: merged.canComment,
  vaultCanEdit: merged.canEdit,
};
```

</details>

**impact:** Shared notes stop vanishing from the tree; one line plus a contract test.

### BUG-02 — `useScreenData` refetches on every render when `load` is an inline closure

**severity:** High

**category:** Bugs & correctness · **area:** apps/web · data hooks · **effort:** S

**files:** `apps/web/src/lib/hooks/use-screen-data.ts:58-92`

**problem:**

Every screen that calls `useScreenData("papers", () => container.papers.loadScreenData())` re-issues the full screen load on each render, because the arrow function is a new value every time.

**how discovered:**

Tracing the dependency chain in the hook: `useCallback(..., [cacheKey, load, screen])` → `useEffect(..., [reload])`. `load` is not stabilised anywhere in the hook, and every call site in the app passes an inline lambda.

**why:**

The hook takes a *function* as a dependency and promises nothing about its identity. React re-creates the callback whenever any dep changes, a new `load` identity makes `reload` new, and the effect that calls `reload` re-runs. The screen cache absorbs the cost most of the time (so it looks like a re-render, not a bug), but any state update in the child — typing in a filter box, opening a dialog — re-triggers the network path and resets `loading`.

**fix:**

Keep the callback in a ref and key the effect on the cache key only. The ref pattern makes the hook's contract explicit: `load` may be any closure.

```ts
const loadRef = useRef(load);
loadRef.current = load;
const reload = useCallback(async () => { /* uses loadRef.current() */ },
  [cacheKey, screen]);
```

<details><summary>before / after</summary>

```ts
const reload = useCallback(async () => {
  /* … */
  const fresh = await load();
  /* … */
}, [cacheKey, load, screen]);

useEffect(() => { void reload(); }, [reload]);
```

```ts
const loadRef = useRef(load);
loadRef.current = load;          // latest closure, stable identity

const reload = useCallback(async () => {
  /* … */
  const fresh = await loadRef.current();
  /* … */
}, [cacheKey, screen]);        // load is no longer a dep

useEffect(() => { void reload(); }, [reload]);
```

</details>

**impact:** Removes a whole class of redundant screen loads; typing in a filter no longer hits the network.

### BUG-03 — An IndexedDB payload restored after reload can overwrite fresher data

**severity:** High

**category:** Bugs & correctness · **area:** apps/web · data hooks · **effort:** S

**files:** `apps/web/src/lib/hooks/use-screen-data.ts:24-42`

**problem:**

Open a screen (network load completes), let the IDB read resolve a moment later, and the week-old stored payload replaces the data that just arrived.

**how discovered:**

Reading the two effects in order. The IDB effect only bails when `getScreenCache(cacheKey) != null` *at mount time*; it has no guard for writes that happen while its promise is in flight, and it stamps the cache with `cached.fetchedAt` — which also makes the stale payload count as fresh for two minutes.

**why:**

Two asynchronous writers (`idbGetScreenCache` and `load()`) race with no ordering rule. Whichever resolves last wins, and the IDB read is slower than it looks on a cold start. The `fetchedAt` stamping is correct in isolation but makes the loss worse: it suppresses the background revalidation that would have repaired it.

**fix:**

Adopt the IDB value only if no network load has completed since the effect started. A monotonic counter is enough:

```ts
const seq = useRef(0);
useEffect(() => {
  const mine = ++seq.current;
  void idbGetScreenCache<T>(cacheKey).then((cached) => {
    if (mine !== seq.current || cached == null) return;
    setScreenCache(cacheKey, cached.value, cached.fetchedAt);
    setData(cached.value);
  });
}, [cacheKey]);
```

**impact:** Cold-start screens can no longer regress to a stale payload.

### BUG-04 — Concurrent `reload()` calls resolve in arrival order, not request order

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · data hooks · **effort:** S

**files:** `apps/web/src/lib/hooks/use-screen-data.ts:44-86`

**problem:**

Two overlapping loads — a manual refresh racing the mount load, or a fast project switch — leave the slower response in state.

**how discovered:**

`reload` has no request identity: `setData(fresh)` runs for whichever promise settles last.

**why:**

Without a sequence token there is no way to distinguish "the newest answer" from "the last answer to arrive". Project switches make this reachable in normal use because the cache key changes while the previous request is still in flight.

**fix:**

Reuse the same `seq` ref as BUG-03: capture it at the start of `reload` and drop the result unless it still matches.

**impact:** Switching projects never shows the previous project's screen.

### BUG-05 — `SupabasePaperRepository.listByIds` does not scope by project

**severity:** High

**category:** Bugs & correctness · **area:** apps/web · papers repository · **effort:** M

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:60-72`

**problem:**

A batch read by ids returns rows from every project the credentials can see. On the hosted path RLS hides it; on a self-hosted Postgres or a local folder backend, the same call returns other projects' papers into this project's sync, search index and prefetch.

**how discovered:**

Reading every method in the class side by side: `list`, `listSummaries`, `listStamps`, `findByArxivId`, `findByArxivBidx`, `findByDoi`, `findByDoiBidx` all guard on `this.pid`. `listByIds` is the sole exception.

**why:**

`ProjectRepository` provides the `pid` getter but does not enforce it; each method is responsible for applying it. The delta-sync and prefetch paths call `listByIds` with ids they believe belong to the project, so the missing filter is invisible until two projects share a database without RLS.

**fix:**

Apply the same guard as its siblings, and — better — move the guard into `ProjectRepository` so no method can forget it:

```ts
protected scoped<T extends { eq: (c: string, v: string) => T }>(query: T): T {
  return this.pid ? query.eq("project_id", this.pid) : query;
}
```

Then `listByIds` becomes `this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS).in("id", chunk))`.

<details><summary>before / after</summary>

```ts
for (let start = 0; start < ids.length; start += ID_CHUNK) {
  out.push(...(await rows<PaperRow>(this.db
    .from(TABLE)
    .select(PAPER_LIST_COLUMNS)
    .in("id", ids.slice(start, start + ID_CHUNK) as string[]))).map(toDomain));
}
```

```ts
const chunks = chunkIds(ids, ID_CHUNK);
const pages = await Promise.all(
  chunks.map((chunk) =>
    rows<PaperRow>(
      this.scoped(this.db.from(TABLE).select(PAPER_LIST_COLUMNS))
        .in("id", chunk)
        .order("id", { ascending: true }),
    ).then((r) => r.map(toDomain)),
  ),
);
return pages.flat();
```

</details>

**impact:** Closes a cross-project read and makes the whole repository family consistent.

### BUG-06 — `listByIds` awaits 200-id chunks one at a time and returns rows unordered

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · papers repository · **effort:** S

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:60-72`

**problem:**

A 2 000-id delta read costs ten sequential round trips, and the returned array is in whatever order Postgres chose — not the order of the ids asked for.

**how discovered:**

The chunk loop `await`s inside the loop body. Nothing in the method orders the result, unlike `list()`/`listSummaries()`, which both add `.order("created_at").order("id")` precisely because an unstable order was already biting the card grid.

**why:**

Chunking exists to keep the `in (...)` list inside the URL length limit, not to serialise. And any caller that zips the response against its id list — the sync merger, the search rehydrator — pairs the wrong row with the wrong id when the order differs.

**fix:**

Issue the chunks concurrently and impose a deterministic order (see the `after` sample on BUG-05). If callers need input order, return a `Map<string, Paper>` instead of an array so the pairing is explicit.

**impact:** Delta sync of a large library goes from N sequential requests to one parallel batch.

### BUG-07 — `normalizeDoi(...)!` is asserted non-null and then handed to PostgREST

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · papers repository · **effort:** S

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:78-80, 108-112`

**problem:**

A filter DOI that fails normalisation produces `.eq("doi", undefined)`. Depending on the client version that is either a request error or a filter that silently matches nothing — and the caller cannot tell which.

**how discovered:**

Two non-null assertions on a function whose contract allows a null return (`normalizeDoi` returns `string | null`).

**why:**

The assertion converts a legitimate "this is not a DOI" outcome into a type error the compiler cannot see. `parsePaperRef` deliberately classifies junk as `kind: "url"`, so unnormalisable values really do reach these methods.

**fix:**

Handle the null case explicitly: skip the filter in `list`, return `null` from `findByDoi`.

```ts
if (filter?.doi) {
  const doi = normalizeDoi(filter.doi);
  if (doi) query = query.eq("doi", doi);
}
```

**impact:** Removes two lying assertions and the ambiguous failure behind them.

### BUG-08 — `listSummaries()` is typed as full papers but selects summary columns

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · papers repository · **effort:** M

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:33-45, 88-92`, `packages/core/src/features/papers/domain`

**problem:**

The compiler believes every element has `abstract`, `bibtex` and `metadata`. Any code path that reads one and writes the entity back persists `undefined` over real data.

**how discovered:**

Comparing the selected column list with the declared return type. This is the exact failure the codebase's own comments describe as *review-2 F6* — a card edit writing `body: ""` over a note — reintroduced through the repository boundary.

**why:**

`toDomain` maps absent columns to `undefined` without complaint, so nothing fails at runtime. The projection is a performance win (which is why it exists); the bug is claiming the wider type for it.

**fix:**

Return `PaperSummary[]` and make the projection method required on `IPaperRepository` (see ARCH-02), so callers stop writing `listSummaries?.() ?? list()` and get the narrow type by construction.

**impact:** The type system starts protecting the summary/full distinction instead of erasing it.

### BUG-09 — The Zotero dry-run previews a different set than the live push writes

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · papers facade · **effort:** S

**files:** `apps/web/src/container/facades/papers.ts`

**problem:**

"Show me what would happen" lists every annotation; the button that actually writes only sends locally created ones. A user who confirms based on the preview gets a different result.

**how discovered:**

Reading the two methods side by side. Both load the annotations, construct a client and call `push`; only the row filter differs — and only one of them has it.

**why:**

The dry-run path was written first against a `DryRunZoteroAnnotationWriteBack` that takes the full list; the live path later added the `origin` filter for safety without revisiting the preview. Two copies of one sequence (see ARCH-06) drifted.

**fix:**

One private method takes the client and the row selection; both entry points pass the same selection.

```ts
private pushWith(client: AnnotationWriteBack, paperId: string) {
  return this.deps.readerAnnotations.list(paperId)
    .then((anns) => client.push(paperId, anns.filter((a) => a.origin === "local")));
}
```

**impact:** Preview and reality agree; the write-back path has one implementation.

### BUG-10 — Realtime invalidation subscribes before a project exists and never retries

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · cache invalidation · **effort:** M

**files:** `apps/web/src/create-app-container.ts`, `apps/web/src/lib/cache/project-lww-invalidator.ts:118-160`

**problem:**

The container is built before any project is selected, so the first `watch()` call is a no-op. Cross-tab cache invalidation only works if some later code path calls `projects.watchLww(id)`; a restore/deep-link path that assigns `projectContext.projectId` directly gets no subscription at all.

**how discovered:**

Following the order of statements in `createAppContainer`: `setActiveProjectIdForCache(pid)` → `projectLww.watch(backend.db, pid())`, with `projectContext` declared as `{ projectId: null }` a few lines above.

**why:**

`watch` is written as "switch channels", which makes calling it early look harmless. But it is the only place the socket is created, and the only other caller is one facade method — a coupling that is invisible from either file.

**fix:**

Make subscription a function of the project id and call it from the one place the id changes:

```ts
// project-context.ts
export function setProjectId(id: string | null) {
  projectContext.projectId = id;
  onProjectIdChange(id);      // single fan-out point
}
```

Register `projectLww.watch(db, id)` as a listener. Then any path that sets a project — facade, restore, deep link — subscribes, and a test can assert it.

**impact:** One place changes the active project; stale-cache bugs stop depending on which screen you entered from.

### BUG-11 — `registerSessionReset` closes over `workspace` before it is declared

**severity:** Low

**category:** Bugs & correctness · **area:** apps/web · composition root · **effort:** S

**files:** `apps/web/src/create-app-container.ts`

**problem:**

If a session reset fires while the container is still being constructed, the callback throws `ReferenceError: Cannot access 'workspace' before initialization` and the remaining reset steps (provider key, folder handle) never run.

**how discovered:**

Reading the callback body against the declaration order. It is safe today only because nothing can fire a reset mid-construction.

**why:**

Temporal dead zone. The binding exists but is uninitialised until the `const` executes, so the code is correct by timing rather than by construction — and lint rules for `no-use-before-define` will flag it the moment someone enables them.

**fix:**

Move the `registerSessionReset(...)` call to after `workspace` is created, or inject a getter (`() => workspace?.resetSnapshotBaseline()`). Prefer moving the call: ordering that matters should be visible in the order of the statements.

**impact:** Removes a latent ReferenceError and a lint violation from the composition root.

### BUG-12 — Outbox updates guard on `row_version=eq.0` when the base version is unknown

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · offline sync · **effort:** S

**files:** `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`

**problem:**

An update whose `baseVersion` was never recorded is guarded against version 0. No live row has version 0, so the PATCH matches nothing and the op is reported as a conflict forever — it can never drain from the outbox.

**how discovered:**

Reading `dispatch()`: the guard is built from `entry.baseVersion ?? 0`, and `send()` treats `rows.length === 0` as `this.conflict(entry)`.

**why:**

`?? 0` turns "unknown" into a specific, wrong version. For a delete the same guard also silently no-ops instead of tombstoning.

**fix:**

Distinguish the two cases. A missing base version means "last write wins, no guard":

```ts
const guard = entry.baseVersion == null
  ? `?id=eq.${encodeURIComponent(entry.rowId)}`
  : `?id=eq.${encodeURIComponent(entry.rowId)}&row_version=eq.${entry.baseVersion}`;
```

If an unguarded write is genuinely unacceptable, classify the op as `refused` with a reason instead of parking it as a conflict.

**impact:** Queued edits stop dead-lettering as phantom conflicts.

### BUG-13 — A 401/403 from the sync transport parks the outbox with no re-authentication

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · offline sync · **effort:** M

**files:** `apps/web/src/features/offline-sync/infra/postgrest-transport.ts:40-56`

**problem:**

An expired access token is reported as `offline`. The queue retries on a backoff that will never succeed until something else refreshes the session, and nothing distinguishes "no network" from "not authorised any more".

**how discovered:**

`send()` maps 401 and 403 to the same `{ status: "offline" }` as a thrown fetch.

**why:**

`accessToken` is read per request precisely because it expires, but the transport has no way to say "the credential was the problem". The outbox then applies network-retry semantics to an auth failure.

**fix:**

Add a distinct outcome (`{ status: "reauth" }`) and let the sync loop ask the session layer for a fresh token before the next attempt. Keep `offline` meaning the network.

**impact:** Long-lived queues recover on their own after a token refresh.

### BUG-14 — The one-time offline-sync offer can reappear because the preference is compared with `=== true`

**severity:** Low

**category:** Bugs & correctness · **area:** apps/web · offline sync · **effort:** S

**files:** `apps/web/src/features/offline-sync/application/sync-offer.ts`

**problem:**

If the shell hands the preference back as the string `"true"` — which its own signature permits (`string | boolean | null`) — the offer is treated as never shown and is presented again after every upgrade.

**how discovered:**

The bridge type says `string | boolean | null`; the read coerces with `=== true` and the write stores a boolean. The two halves agree only if the bridge round-trips JSON faithfully.

**why:**

A one-time prompt whose memory is a single boolean is exactly the thing that must not depend on a serialisation detail; the module's own comment says an app that asks twice teaches people to dismiss without reading.

**fix:**

Coerce on read:

```ts
const truthy = (v: string | boolean | null) => v === true || v === "true" || v === "1";
```

**impact:** The offer really is once per device.

### BUG-15 — Python SDK: a failure after `yield` leaves the run marked `running` forever

**severity:** High

**category:** Bugs & correctness · **area:** python SDK · **effort:** S

**files:** `python/weaveforge/tracking.py`

**problem:**

If `run.sync(...)`, `run.flush()` or `run.set_status(...)` raises on the success path, the exception propagates with the experiment still `running` and any buffered curves unsent.

**how discovered:**

Reading `track()`: the `else:` branch after `yield` has no guard, and `_finalise_failed` is only called in the `except BaseException` branch — which covers the user's training code, not the finalisation itself.

**why:**

The author already reasoned carefully about this for the failure path (status first, then flush, both guarded, never masking the caller's exception). The success path is the same I/O on the same possibly-dead network and was left unguarded.

**fix:**

Wrap the success path in the same guarded finalisation:

```python
try:
    if sync:
        for source_id, ref in dict(sync).items():
            run.sync(source_id, ref)
    run.flush()
    run.set_status(status_on_success)
except Exception:
    _finalise_failed(run)
    raise
```

<details><summary>before / after</summary>

```python
else:
    if sync:
        for source_id, ref in dict(sync).items():
            run.sync(source_id, ref)
    run.flush()
    run.set_status(status_on_success)
finally:
    if owns_connection:
        _close_owned(ctx)
```

```python
else:
    try:
        if sync:
            for source_id, ref in dict(sync).items():
                run.sync(source_id, ref)
        run.flush()
        run.set_status(status_on_success)
    except Exception:
        _finalise_failed(run)      # status first, then a guarded flush
        raise
finally:
    if owns_connection:
        _close_owned(ctx)
```

</details>

**impact:** No run is ever stranded in `running`; buffered metrics survive a dead network.

### BUG-16 — Python SDK: `track()` leaks the connection it opened if the run cannot be started

**severity:** Medium

**category:** Bugs & correctness · **area:** python SDK · **effort:** S

**files:** `python/weaveforge/tracking.py`

**problem:**

A bad `mirror=` name (raises `TypeError` by design) or a failed `manage_experiment.add(...)` leaves the HTTP pool open, because the `finally` that closes it has not been entered yet.

**how discovered:**

Ordering inside `track()`: `run = _start_run(...)` sits above `try:`, and `owns_connection` is computed above that.

**why:**

Ownership is established (`owns_connection = container is None`) before the resource is safely held. The close lives in the wrong scope.

**fix:**

Open the `try` immediately after deciding ownership:

```python
ctx = container or _connect(project=project)
owns_connection = container is None
try:
    run = _start_run(ctx, name, /* … */)
    try:
        yield run
    /* … */
finally:
    if owns_connection:
        _close_owned(ctx)
```

**impact:** One exit path for every failure, including the ones before the run exists.

### BUG-17 — Python SDK: `@track_experiment` cannot inject `run` into a positional parameter

**severity:** Medium

**category:** Bugs & correctness · **area:** python SDK · **effort:** M

**files:** `python/weaveforge/tracking.py`

**problem:**

For `def train(run, beta)` — the documented shape, with `run` first — `kwargs.setdefault` cannot fill a positional parameter, so the call fails with `TypeError: train() missing 1 required positional argument`.

**how discovered:**

The signature check accepts any parameter named `run`, but the injection only ever writes into `kwargs`. The README example is `def train(run, beta=4.0)`, which is exactly the shape that breaks when called as `train(beta=4.0)`.

**why:**

Presence of the name and the ability to supply it are two different questions. Binding is what answers the second one.

**fix:**

Bind before calling and pass positionally:

```python
sig = inspect.signature(fn)
wants_run = inject in sig.parameters
# …
if wants_run:
    bound = sig.bind_partial(*args, **kwargs)
    bound.arguments.setdefault(inject, run)
    args, kwargs = bound.args, bound.kwargs
result = fn(*args, **kwargs)
```

**impact:** The decorator matches its own documentation for every parameter position.

### BUG-18 — `useSearchIndex` reports ready even when the index build failed

**severity:** Low

**category:** Bugs & correctness · **area:** apps/web · search · **effort:** S

**files:** `apps/web/src/lib/hooks/use-search-index.ts`

**problem:**

A failed build (worker cannot start, IDB corrupt, snapshot read refused) sets `ready`, so consumers stop showing their substring fallback and instead get an empty result set from the ranked path — with no retry.

**how discovered:**

`finally` runs on both paths, and the returned query function only checks the `ready` flag before delegating to `getContainer().search.search(...)`.

**why:**

`ready` conflates "finished" with "succeeded". The silent-failure design is deliberate (a failed build costs ranking, not the search box) but it requires the fallback to stay active, which this flag prevents.

**fix:**

Set the flag in `then` only, and let callers keep their fallback:

```ts
void getContainer().search.ensure()
  .then(() => { if (!cancelled) setReady(true); })
  .catch(() => { /* keep the caller's substring fallback */ });
```

**impact:** A broken index degrades to substring search instead of to nothing.

### BUG-19 — `rememberRecentTarget` writes to `localStorage` unguarded

**severity:** Low

**category:** Bugs & correctness · **area:** apps/web · lib · **effort:** S

**files:** `apps/web/src/lib/recent-targets.ts`

**problem:**

In Safari private mode, or once the origin is over quota, `setItem` throws `QuotaExceededError` from inside a navigation handler — aborting the navigation the user asked for, to record a recent-visit nicety.

**how discovered:**

`readRecentTargets` guards its parse with `try/catch`; the writer does not guard the write.

**why:**

The asymmetry is the bug: the read is treated as fallible (correctly) and the write as infallible (incorrectly). Storage is a shared, finite, sometimes-disabled resource.

**fix:**

Wrap the write and drop the value on failure:

```ts
try { localStorage.setItem(key(projectId), JSON.stringify(next)); } catch { /* quota or private mode */ }
return next;
```

**impact:** A full disk can no longer break navigation.

### BUG-20 — The experiments screen performs writes as part of loading it

**severity:** Medium

**category:** Bugs & correctness · **area:** apps/web · experiments facade · **effort:** M

**files:** `apps/web/src/container/facades/experiments.ts`

**problem:**

Opening the experiments screen writes to the database. Two tabs, or React's double-invoked effect in development, both see the same stale runs and both issue the same status updates — duplicate rows in the sync log, duplicate peer broadcasts, and a cache-invalidation storm triggered by a read.

**how discovered:**

`loadScreenData()` delegates to `reconcileAndLoad()`, which filters `status === "running"`, reads metric activity and then `Promise.all(stale.map(setStatus))`. The name `load` does not suggest a mutation, and neither does the hook that calls it.

**why:**

Reconciliation is a background maintenance job that was attached to the cheapest available call site. But a load path runs on mount, on refocus, on project switch and on every LWW invalidation, so a maintenance action placed there is the action that runs most often. The `.catch(() => null)` per write shows the author knew these could fail — and a failed write means the next load tries again, forever.

**fix:**

Separate the two concerns and make the write path idempotent and single-flight:

```ts
// facade
loadScreenData() { return this.deps.load.execute(); }          // pure read

reconcileStaleRuns() {                                          // called from a scheduler
  if (this.reconciling) return this.reconciling;
  this.reconciling = this.doReconcile().finally(() => { this.reconciling = null; });
  return this.reconciling;
}
```

Call `reconcileStaleRuns()` from one place — an interval, or the first mount of the session — rather than from the load. Add a test that two concurrent calls produce one batch of writes.

**impact:** Reads stop mutating; stale-run cleanup happens once, not once per mount.


## 2. Security

### SEC-01 — `parseIpv4` accepts leading zeros, so the SSRF guard and `fetch` can disagree

**severity:** High

**category:** Security · **area:** packages/core · outbound URL policy · **effort:** S

**files:** `packages/core/src/net/url-safety.ts`

**problem:**

`http://010.127.0.1/` (or `http://2130706433/`) passes the shape check as a *public* address while the HTTP stack resolves it as loopback — a filter bypass into `127.0.0.1`.

**how discovered:**

Reading `parseIpv4` against what runtimes do with ambiguous IPv4 text. The function validates each octet as 1-3 digits and `<= 255`, and only then sums them as decimal; it never checks the canonical form.

**why:**

Historically a leading zero means octal in inet-addr parsing (`010` → 8), and Node/undici will happily parse several non-canonical forms. A guard that reads `010.0.0.1` as `10.0.0.1` while the socket dials `8.0.0.1` is not a guard. The same class covers the single-integer form (`2130706433`), which contains no dot at all and so is classified as a hostname.

**fix:**

Require the canonical dotted-quad form before deciding anything about it, and reject anything else outright:

```ts
if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(value)) return null;
const octets = value.split(".").map(Number);
if (octets.some((o) => o > 255 || /^0\d/.test(String(o)))) return null;  // no octal, no padding
```

Add these as table tests in the core suite: `010.0.0.1`, `1.2.3.04`, `2130706433`, `0x7f.0.0.1` must all be refused.

<details><summary>before / after</summary>

```ts
for (const part of parts) {
  if (!/^\d{1,3}$/.test(part)) return null;
  const octet = Number(part);
  if (octet > 255) return null;
  octets.push(octet);
}
```

```ts
for (const part of parts) {
  // Canonical dotted-quad only: a leading zero means octal to a resolver,
  // and a padded octet is how "10.0.0.1" and "8.0.0.1" stop being the same string.
  if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
  const octet = Number(part);
  if (octet > 255) return null;
  octets.push(octet);
}
```

</details>

**impact:** Closes a real SSRF bypass in the guard that every outbound fetch goes through.

### SEC-02 — The outbound port allowlist includes the ports a self-hoster's own stack listens on

**severity:** Medium

**category:** Security · **area:** packages/core · outbound URL policy · **effort:** S

**files:** `packages/core/src/net/url-safety.ts`

**problem:**

`3000` is the port the hosted WeaveForge app itself runs on in development and `5000` is a common API port. Allowing them means an authenticated paste can reach those services on any *public* host, including a self-hoster's own mis-exposed node.

**how discovered:**

Reading the allowlist against the deployment docs in the repo (the app is served from a Next server; the desktop app serves a local API on `127.0.0.1:27123`).

**why:**

An allowlist is the right shape, but it was written for "ports a self-hoster legitimately reaches" without separating *inbound* conveniences from *outbound* ones. The two sets are not the same, and the smaller the list the smaller the internal-reach surface.

**fix:**

Trim to `""`, `80`, `443`, `8080`, `8443` and make anything else opt-in through an environment allowlist the operator sets deliberately:

```ts
const extra = (process.env.WEAVEFORGE_OUTBOUND_PORTS ?? "").split(",").filter(Boolean);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443", ...extra]);
```

**impact:** Smaller blast radius, with an explicit operator-controlled escape hatch.

### SEC-03 — API auth returns raw internal error text to the client

**severity:** Medium

**category:** Security · **area:** apps/web · API auth · **effort:** S

**files:** `apps/web/src/app/api/sdk/_shared.ts`

**problem:**

Any exception inside `requireSdkUser` — a missing env var, a driver error, a stack-bearing wrapper — is serialised into the response body. That is configuration and topology disclosure to anyone holding a token.

**how discovered:**

The `catch` block distinguishes 503 vs 500 by string-matching the message and then returns that same message verbatim.

**why:**

The status-code reasoning is careful and correct; the body is not. `formatError` exists to produce a *human* message for logs and toasts, and a route response is neither.

**fix:**

Log the detail server-side, return a stable code and a correlation id:

```ts
const id = crypto.randomUUID();
console.error(`[api-auth ${id}]`, err);
return NextResponse.json({ error: "Authentication is unavailable.", requestId: id }, { status });
```

**impact:** Internal detail stays in the logs; support gets a correlation id instead.

### SEC-04 — An empty generated MCP tool registry silently means "no tool restriction"

**severity:** Medium

**category:** Security · **area:** apps/web · composition root · **effort:** S

**files:** `apps/web/src/create-app-container.ts`

**problem:**

When the generated registry is empty — a build without the MCP plugin, or a codegen step that has not run — `allowedTools` is `undefined`, which the AI facade reads as "no allowlist". The tool surface widens precisely when the operator has configured nothing.

**how discovered:**

The ternary's `undefined` branch. Its intent is clearly "no tools are configured", but `undefined` is also the natural spelling of "unrestricted" for an optional parameter.

**why:**

An optional parameter cannot express three states (unset / empty / populated) and the code needs all three. Absence of configuration must fail closed.

**fix:**

Pass the empty array and make the facade's contract explicit:

```ts
allowedTools: GENERATED_MCP_TOOL_NAMES as readonly AiToolName[],   // may be []
```

In `AiAssistantFacade`, treat `[]` as "deny every tool" and reserve `undefined` for a value that is never produced in application code (tests only). Add a test that an empty registry rejects a proposal.

**impact:** The AI tool surface can only ever be narrowed by configuration, never widened by its absence.

### SEC-05 — The documented DNS-rebinding window in `safeFetch` is still open

**severity:** Medium

**category:** Security · **area:** apps/web · outbound fetch · **effort:** M

**files:** `apps/web/src/backend/net/safe-fetch.ts`

**problem:**

The name is resolved and checked, then `fetch(url)` resolves it again. A name with a short TTL can answer with a public address for the check and `169.254.169.254` for the connect.

**how discovered:**

`checkUrlReachable(url, options.resolve)` → `await fetch(url, …)`. The `resolve` injection exists for tests, not for the real request path, so the validated addresses are thrown away.

**why:**

The comment is honest that this needs a custom agent that dials the address already validated. It is a known gap, not an oversight — but it is also the one remaining step between the guard and full protection, and it is small.

**fix:**

Pin the connection to the checked address with an undici dispatcher whose `lookup` returns the validated list:

```ts
const agent = new Agent({ connect: { lookup: (host, opts, cb) => cb(null, validated.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }))) } });
await fetch(url, { dispatcher: agent, /* … */ });
```

Keep the per-hop re-check; this closes the check→connect gap rather than replacing it.

**impact:** Turns a mitigated gap into a closed one for the server-side fetch path.

### SEC-06 — `/api/fetch-url?as=image` buffers whole images and has no per-user limit

**severity:** Low

**category:** Security · **area:** apps/web · API routes · **effort:** M

**files:** `apps/web/src/app/api/fetch-url/route.ts`, `apps/web/src/backend/net/fetch-for-paste.ts`

**problem:**

Every image paste allocates the full payload in memory on the server, and an authenticated caller can drive that repeatedly — a bandwidth and memory amplifier dressed as a paste feature.

**how discovered:**

`fetchRemoteImage` returns a `Uint8Array`; the route then re-wraps it. The route is authenticated, which stops anonymous scanning, but nothing rate-limits an authenticated user.

**why:**

The desktop path needs the bytes in memory (they cross the Electron boundary as a buffer), so the shared function returns them. The route inherits that shape even though it could stream.

**fix:**

Two changes: (1) give the route a per-user token bucket keyed by `auth.userId` (a few requests per second, burst of ~10); (2) add a streaming variant of the fetch for the route so the response is piped rather than buffered. The hardening headers already on the response (`CSP: default-src 'none'; sandbox`, `nosniff`) are correct and should stay.

**impact:** Removes a per-request multi-megabyte allocation and an unbounded egress path.


## 3. Speed

### PERF-01 — stripUnresolvedImageRefs compiles one regex per path and rescans the body each time

**severity:** High

**category:** Speed · **area:** apps/web · markdown lib · **effort:** S

**files:** `apps/web/src/lib/markdown-image-refs.ts`

**problem:**

A note with 30 figures whose blobs never arrived runs 30 regex compilations and 30 full scans of the note body. Every note and every report section pays this on each render of its preview.

**how discovered:**

Reading the loop: the RegExp is constructed inside `for (const path of paths)`, so its compilation cannot be cached, and each `replace` walks the whole string.

**why:**

The body is scanned once per missing path rather than once total. Cost is O(unresolved × body) in both CPU and allocation, because every `replace` produces a new string. It is also the only place in the repo that builds a regex from user-controlled text inside a loop.

**fix:**

Compile once, capture the path, decide inside the replacer — one pass, one allocation per surviving image:

```ts
const re = new RegExp('!\\[[^\\]]*\\]\\(' + escapeRegExp(prefix) + '([^)\\s]+)\\)', 'g');
return body.replace(re, (whole, path) => (urls.has(path) ? whole : ''));
```

<details><summary>before / after</summary>

```ts
let next = body;
for (const path of paths) {
  if (urls.has(path)) continue;
  const ref = escapeRegExp(prefix + path);
  next = next.replace(new RegExp('!\\[[^\\]]*\\]\\(' + ref + '\\)', 'g'), '');
}
return next;
```

```ts
// One compiled pattern, one pass: the path is captured and tested against
// the resolved-url map inside the replacer instead of being re-scanned per id.
const re = new RegExp('!\\[[^\\]]*\\]\\(' + escapeRegExp(prefix) + '([^)\\s]+)\\)', 'g');
return body.replace(re, (whole, path) => (urls.has(path) ? whole : ''));
```

</details>

**impact:** Image-heavy notes stop re-scanning their own body; previews get measurably cheaper.

### PERF-02 — mergePinnedScreenData is O(pins × shares) and reduces the share list twice

**severity:** High

**category:** Speed · **area:** packages/core · library · **effort:** S

**files:** `packages/core/src/features/library/application/merge-pinned-screen-data.ts`

**problem:**

For every pinned resource the function walks the entire share list twice with `.some(...)`. A lab with 200 pins and 400 shares runs 160 000 predicate evaluations on every screen load — and six screens use this helper.

**how discovered:**

The second loop calls `input.shares.some(shareAllowsComment)` and `input.shares.some(shareAllowsEdit)` inside `for (const [resourceId, ownerId] of pinnedSharedBy)`. The first loop already computed the same answers per resource id.

**why:**

Both loops answer one question — "does any share grant this resource comment/edit?" — with different strategies. The first indexes by resource id as it goes; the second re-scans. That is both the slow path and a duplicate implementation of one rule.

**fix:**

Reduce the shares once into a map, then OR into it. Extract `shareGrantsFor(shares, resourceType)` so both passes call the same function:

```ts
const grants = shareGrantsFor(input.shares, input.resourceType);
for (const [resourceId, ownerId] of pinnedSharedBy) {
  const g = grants.get(resourceId) ?? { comment: false, edit: false };
  g.comment ||= input.shares.some((s) => shareAllowsComment(s, input.resourceType, resourceId, ownerId));
  g.edit ||= input.shares.some((s) => shareAllowsEdit(s, input.resourceType, resourceId, ownerId));
  grants.set(resourceId, g);
}
```

<details><summary>before / after</summary>

```ts
for (const [resourceId, ownerId] of pinnedSharedBy) {
  const comment = input.shares.some((s) =>
    shareAllowsComment(s, input.resourceType, resourceId, ownerId));
  canComment.set(resourceId, comment || canComment.get(resourceId) === true);
  const edit = input.shares.some((s) =>
    shareAllowsEdit(s, input.resourceType, resourceId, ownerId));
  canEdit.set(resourceId, edit || canEdit.get(resourceId) === true);
}
```

```ts
// One pass over the shares builds the grants; the pin pass only ORs into it.
const grants = shareGrantsFor(input.shares, input.resourceType);
for (const [resourceId, ownerId] of pinnedSharedBy) {
  const g = grants.get(resourceId) ?? { comment: false, edit: false };
  g.comment ||= input.shares.some((s) => shareAllowsComment(s, input.resourceType, resourceId, ownerId));
  g.edit ||= input.shares.some((s) => shareAllowsEdit(s, input.resourceType, resourceId, ownerId));
  grants.set(resourceId, g);
}
```

</details>

**impact:** Screen loads in a busy lab stop scaling with pins × shares.

### PERF-03 — computeRollup rebuilds the value index for every row and every column

**severity:** High

**category:** Speed · **area:** packages/core · paper fields · **effort:** M

**files:** `packages/core/src/features/papers/application/compute-rollup.ts`

**problem:**

The module's own comment says it is called once per row per rollup column, and each call runs `indexValues(values)` over the project's entire field-value set. A 500-paper table with 20 000 values and 3 rollup columns performs 30 million map inserts.

**how discovered:**

`indexValues(values)` sits inside the exported `computeRollup`. The comment above it documents the O(N × M) problem it solved for the lookup — without noticing the same problem now sits one level up, in the caller.

**why:**

The index is a pure function of `values`, which does not change between the rows of one render. Recomputing it per cell is the classic hoist-the-loop-invariant miss, and it is the most expensive pure function in the papers grid.

**fix:**

Two options, in order of preference.

1. Accept a prebuilt index: export `createValueIndex(values)` and change the signature to take it. The screen use-case builds it once per load — the invariant becomes a parameter instead of a cache.
2. Memoise at the call site with a `Map` keyed by `rollupDef.id`, computed once per table render.

Add a benchmark test that fails if a 200-row table with three rollup columns takes more than a few milliseconds.

<details><summary>before / after</summary>

```ts
export function computeRollup(paperId, rollupDef, defs, values) {
  /* … early returns … */
  const byKey = indexValues(values);        // rebuilt for every cell
  const relationValue = byKey.get(valueKey(paperId, relationDef.id))?.value;
  /* … */
}
```

```ts
/** Built once per load, passed to every cell. */
export function createValueIndex(values: readonly PaperFieldValue[]) {
  const index = new Map<string, PaperFieldValue>();
  for (const v of values) {
    const key = valueKey(v.paperId, v.fieldId);
    if (!index.has(key)) index.set(key, v);   // first wins, as before
  }
  return index;
}

export function computeRollup(paperId, rollupDef, defs, index: ValueIndex) {
  const relationValue = index.get(valueKey(paperId, relationDef.id))?.value;
  /* … unchanged … */
}
```

</details>

**impact:** Turns a quadratic papers table into a linear one; the grid stays responsive past 1 000 papers.

### PERF-04 — Four dedupe lookups use select("*")

**severity:** Medium

**category:** Speed · **area:** apps/web · papers repository · **effort:** S

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:94-118`

**problem:**

Each dedupe check downloads `abstract`, `bibtex` and `metadata` — the three heaviest columns in the table — and then uses only the row's identity.

**how discovered:**

All four methods select `*` while the class defines two narrow projections a few lines above. Import and citation alerts call these on every add.

**why:**

The methods answer "does this paper already exist?", which needs `id` (and for the caller, `status`/`updatedAt`). Fetching the full row is the difference between a few hundred bytes and tens of kilobytes per lookup, times every import.

**fix:**

Select the narrow projection and collapse the four methods into one (see ARCH-07):

```ts
private async findBy(column: string, value: string): Promise<Paper | null> {
  const row = await one<PaperRow>(
    this.scoped(this.db.from(TABLE).select('id,status,updated_at')).eq(column, value).maybeSingle(),
  );
  return row ? toDomain(row) : null;
}
```

**impact:** Dedupe lookups stop paying for columns nobody reads.

### PERF-05 — Every authenticated API request builds a fresh service-role Supabase client

**severity:** Medium

**category:** Speed · **area:** apps/web · API auth · **effort:** M

**files:** `apps/web/src/app/api/sdk/_shared.ts`

**problem:**

Three clients are constructed per request (admin client for scopes, `apiTokenService()`, and `sdkDbForUserToken`) and the scope check costs three sequential round trips: scopes RPC, token resolve RPC, `auth.getUser`.

**how discovered:**

`createRestClient` sits inside `apiTokenScopes`, which both `requireSdkUser` and `requireMcpRelayUser` call before any route work begins.

**why:**

`createRestClient` sets up auth state, a realtime channel map and a fetch wrapper. Doing it per request is wasted work, and the three sequential hops sit directly in front of every SDK call — the Python SDK's metric flush pays them each time.

**fix:**

Hoist the admin client to module scope (it is a pure function of static config) and fold the scope read and token resolution into one RPC:

```ts
let admin: SupabaseClient | null = null;
function adminClient() {
  return (admin ??= createRestClient(cfg.supabaseUrl!, cfg.supabaseServiceRoleKey!, { auth: { persistSession: false } }));
}
// then: rpc('resolve_api_token', { p_token_hash }) -> { scopes, access_token }
```

**impact:** Cuts SDK/auth latency by two round trips and removes per-request client construction.

### PERF-06 — screenForPath splits with a regex and scans nine prefixes on every navigation

**severity:** Low

**category:** Speed · **area:** apps/web · nav · **effort:** S

**files:** `apps/web/src/lib/screen-for-path.ts`

**problem:**

Each call allocates an array from `pathname.split(/[?#]/)` and then walks the route table with `startsWith` — on every nav decision and every cache lookup, including during a fast back/forward sequence.

**how discovered:**

The function body: one regex split plus a linear scan of `ROUTE_SCREENS`.

**why:**

Two avoidable costs on a hot path: a regex where an `indexOf` answers, and a scan where a hash lookup answers for the common case of an exact list route.

**fix:**

Exact-match map first, and cut the string without a regex:

```ts
const EXACT = new Map(ROUTE_SCREENS.map((r) => [r.prefix, r.screen]));

export function screenForPath(pathname: string): string | null {
  const cut = Math.min(...[pathname.indexOf('?'), pathname.indexOf('#')].filter((i) => i >= 0));
  const path = Number.isFinite(cut) ? pathname.slice(0, cut) : pathname;
  return EXACT.get(path) ?? null;   // detail routes return null, as before
}
```

**impact:** One allocation fewer and O(1) on the dominant case.

### PERF-07 — fetchPageTitle decodes the whole body to find one tag

**severity:** Low

**category:** Speed · **area:** apps/web · outbound fetch · **effort:** S

**files:** `apps/web/src/backend/net/fetch-for-paste.ts`

**problem:**

Up to 512 KB is decoded to UTF-16 before the title is extracted, allocating up to a megabyte of string for a few dozen bytes of answer.

**how discovered:**

The decode happens before any content check other than the content-type header, and `safeFetch` has already truncated the body at `TITLE_BYTES`.

**why:**

A `<title>` lives in the document head. Decoding the tail of a page to read its head is work nobody asked for, and on a page with a large inline script it is measurable.

**fix:**

Decode a bounded prefix and stop at the end of the head:

```ts
const head = new TextDecoder('utf-8', { fatal: false }).decode(result.body.subarray(0, 64 * 1024));
const end = head.toLowerCase().indexOf('</head>');
const found = extractPageTitle(end >= 0 ? head.slice(0, end + 7) : head);
```

**impact:** Title lookups stop allocating the size of the page they read.

### PERF-08 — compressImage re-encodes images that did not need it, and drops EXIF orientation

**severity:** Medium

**category:** Speed · **area:** apps/web · image pipeline · **effort:** S

**files:** `apps/web/src/lib/image-compress.ts`

**problem:**

A 40 KB screenshot already under the size limit is decoded, redrawn to a canvas and re-encoded — and `createImageBitmap(file)` without `imageOrientation` stores a portrait phone photo rotated.

**how discovered:**

The function unconditionally creates a bitmap and a canvas. The `imageOrientation` option is absent, which on iOS/Android photos yields landscape-rotated output.

**why:**

Compression is only a win when the input is bigger than the target. The orientation bug is separate and worse: it silently corrupts a photograph of a whiteboard, which is a large share of what researchers attach.

**fix:**

Short-circuit when the file is already small and in a target format, and honour orientation with a fallback:

```ts
if (file.type === 'image/webp' && file.size <= budget) return { blob: file, ext: 'webp' };
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  .catch(() => createImageBitmap(file));   // older Safari
```

**impact:** Cheap uploads stay cheap and phone photos keep their orientation.

### PERF-09 — Delta sync reads every row's stamp to find the ones that changed

**severity:** Low

**category:** Speed · **area:** apps/web · papers repository · **effort:** S

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:46-58`

**problem:**

The "cheap first half of a delta read" pulls two columns for every row in the project — including the ones that have not changed since the last sync — and lets the caller filter in JavaScript.

**how discovered:**

`listStamps` takes no parameters; its comment explains it exists so the caller can ask for the handful that changed.

**why:**

The database is better at this than the client, and the transfer grows linearly with library size even when exactly one row changed.

**fix:**

Push the predicate down:

```ts
async listStamps(since?: string): Promise<EntityStamp[]> {
  let query = this.scoped(this.db.from(TABLE).select('id,updated_at,created_at'));
  if (since) query = query.gt('updated_at', since);
  /* … ordering unchanged … */
}
```

**impact:** Sync cost becomes proportional to what changed.

### PERF-10 — Artifact uploads and stale-run writes are fanned out with no concurrency limit

**severity:** Low

**category:** Speed · **area:** apps/web · experiments facade · **effort:** S

**files:** `apps/web/src/container/facades/experiments.ts`

**problem:**

Choosing twenty figures starts twenty concurrent uploads; a screen with twelve stale runs issues twelve concurrent PATCHes. On a phone connection that saturates the link for everything else, including the load that is still in flight.

**how discovered:**

Both `Promise.all` calls map over user-sized collections with no bound.

**why:**

`Promise.all` is the right shape for a small fixed set and the wrong one for an unbounded one. HTTP/2 multiplexing helps a little, but storage uploads are large bodies and the browser's per-origin connection limit plus the device's radio make the tail slower for everyone.

**fix:**

Bound it, and keep the one-write-per-batch behaviour the code already documents for `attachArtifacts`:

```ts
const entries = await mapLimit(files, 3, (file) => this.deps.artifacts.upload(experimentId, file));
```

A ten-line `mapLimit` in core is enough; it is the same helper the Python SDK wants for its metric flush.

**impact:** Bulk uploads stop starving the rest of the app on a phone.


## 4. Space and memory

### MEM-01 — The repo-cache registry is module-level and never cleared

**severity:** High

**category:** Space & memory · **area:** apps/web · cache invalidation · **effort:** M

**files:** `apps/web/src/lib/cache/project-lww-invalidator.ts`

**problem:**

Every `createAppContainer()` call appends new entries holding strong references to every repository cache and its settled values. Sign out and in, change the backend config, or hot-reload in development, and the previous generation is still reachable — and still being invalidated.

**how discovered:**

`registerRepoCacheEntry` is the only writer and nothing ever removes. `invalidateForWrite` iterates the whole array, so stale caches from a previous container are cleared on every write while the current ones are.

**why:**

Module state that describes a *container* outlives the container. The comment in `workspace-changes.ts` explains why module scope is right for a listener bus; this is a different thing — a registry of per-container caches, which should live and die with the container.

**fix:**

Give the registry a generation and return a disposer:

```ts
export function registerRepoCacheEntry(entry: RepoCacheEntry): () => void {
  const wrapped = { ...entry, generation: ++generation };
  allRepoCaches.push(wrapped);
  return () => {
    const i = allRepoCaches.indexOf(wrapped);
    if (i >= 0) allRepoCaches.splice(i, 1);
  };
}
```

Have `createAppContainer` collect the disposers and call them from `registerSessionReset`, so signing out drops the previous generation's caches deterministically.

**impact:** Memory stops growing per session, and writes stop touching dead caches.

### MEM-02 — WorkspaceSearch retains the whole projected corpus even when semantic search is off

**severity:** Medium

**category:** Space & memory · **area:** apps/web · search · **effort:** M

**files:** `apps/web/src/features/search/application/workspace-search.ts`

**problem:**

The full text of every note, paper and PDF-page document stays in memory for the whole session. For a 15 000-document corpus that is the entire workspace text held a second time, next to the index that already contains it.

**how discovered:**

`docs` is assigned by `adoptProjection` and `buildViaWorker` and read only by `indexedDocuments()`, whose sole consumer is the optional semantic arm.

**why:**

The comment is explicit that this is for the semantic arm — which is null unless the user opts in. Holding a second copy of the corpus for a feature that is off by default is the most expensive default in the app.

**fix:**

Keep the projection only while an arm is attached:

```ts
setSemanticIndex(semantic: SemanticIndex | null) {
  this.semantic = semantic;
  if (!semantic) this.docs = EMPTY_DOCS;      // release the corpus copy
}
```

Have the settings screen pass the snapshot's docs back in when the user enables the arm (it already has them at build time), so nothing is retained that no reader needs.

**impact:** Drops a full-corpus copy from the default memory profile.

### MEM-03 — `ProjectLwwInvalidator.caches` is written and never read

**severity:** Low

**category:** Space & memory · **area:** apps/web · cache invalidation · **effort:** S

**files:** `apps/web/src/lib/cache/project-lww-invalidator.ts`

**problem:**

A second registry for the same thing. It holds strong references to repository caches for the lifetime of the invalidator while contributing nothing.

**how discovered:**

Searching the class for readers of `this.caches`: only `registerCache` writes it. `clearLocal` delegates to `invalidateForWrite`, which uses the module-level array.

**why:**

Two structures for one concept is how the next change lands in the wrong one — a `clearLocal` that iterates `this.caches` would silently invalidate nothing, because the entries the container actually registers go into the module array.

**fix:**

Delete the field and the method, or make it the only registry and remove the module-level array (better: see MEM-01, which makes the array the real thing and ties it to a container generation).

**impact:** One registry, one meaning, no dead retention.

### MEM-04 — `safeFetch` copies the capped body once more than it needs to

**severity:** Low

**category:** Space & memory · **area:** apps/web · outbound fetch · **effort:** S

**files:** `apps/web/src/backend/net/safe-fetch.ts`

**problem:**

Peak memory during a capped read is 2× the payload: the chunk list plus the concatenated buffer.

**how discovered:**

`readCapped` pushes every chunk and then allocates `new Uint8Array(total)` and copies. At the 12 MB image limit that is a 24 MB peak per concurrent request.

**why:**

The cap is right and the cancellation is right; the double-buffer is a side effect of not knowing the length up front. With `content-length` present the size is known and the copy is avoidable.

**fix:**

Preallocate when the length is declared and grow geometrically when it is not:

```ts
const declared = Number(response.headers.get('content-length') ?? '0');
const out = declared > 0 && declared <= maxBytes ? new Uint8Array(declared) : new Uint8Array(Math.min(maxBytes, 64 * 1024));
```

For the image route, stream instead of buffering at all (SEC-06).

**impact:** Halves the peak allocation on the largest outbound reads.

### MEM-05 — `screen-cache` keeps two parallel maps with the same key domain

**severity:** Low

**category:** Space & memory · **area:** apps/web · screen cache · **effort:** S

**files:** `apps/web/src/lib/cache/screen-cache.ts`

**problem:**

Every payload is stored twice in two structures that must be kept in step, and any future single-map mutation (a delete, a TTL sweep) has to remember the other one.

**how discovered:**

`setScreenCache`, `clearScreenCachesForScreens` and `clearAllScreenCaches` each touch both maps. There is no `deleteScreenCache(key)` because adding one would mean touching both again.

**why:**

The value and its fetch time are one fact. Splitting them doubles the bookkeeping and makes a desync (a value without a timestamp, which `isScreenCacheFresh` would then read as "never fresh") possible.

**fix:**

One entry type:

```ts
type Entry<T> = { value: T; fetchedAt: number };
const store = new Map<string, Entry<unknown>>();

export function getScreenCache<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}
```

Then a per-key `deleteScreenCache` and a size cap both become one-line additions.

**impact:** Half the bookkeeping, and the door is open to an LRU cap.

### MEM-06 — `openAppDb()` opens a new IndexedDB connection on every call and never closes one

**severity:** High

**category:** Space & memory · **area:** apps/web · IndexedDB layer · **effort:** S

**files:** `apps/web/src/lib/cache/app-idb.ts`, `apps/web/src/lib/cache/screen-cache-idb.ts`

**problem:**

Each screen load, each search-index read, each PDF-text read and each write opens another connection to the same database. Nothing closes them, so the handles accumulate for the life of the tab.

**how discovered:**

`openAppDb` returns `new Promise(...)` around `indexedDB.open` with no module-level cache, and its five call sites each await it per operation. `grep` for `close()` in the cache layer finds none.

**why:**

An `IDBDatabase` is a real handle: each one keeps a connection to the backing store, and concurrent opens can trigger `onupgradeneeded` on more than one request. When two modules open at different versions that is the `VersionError` the file's own comment warns about — the comment solves the version problem and leaves the connection problem in place.

**fix:**

Memoise the open, and close on sign-out (which also completes MEM-01):

```ts
let opening: Promise<IDBDatabase> | null = null;

export function openAppDb(): Promise<IDBDatabase> {
  return (opening ??= new Promise((resolve, reject) => { /* … unchanged … */ }));
}

export function closeAppDb(): void {
  void opening?.then((db) => db.close()).catch(() => {});
  opening = null;
}
```

Register `closeAppDb` alongside the other session-reset steps.

<details><summary>before / after</summary>

```ts
export function openAppDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    /* … */
  });
}
```

```ts
let opening: Promise<IDBDatabase> | null = null;

export function openAppDb(): Promise<IDBDatabase> {
  // One connection per tab, not one per operation.
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    /* … unchanged … */
  }));
}

export function closeAppDb(): void {
  void opening?.then((db) => db.close()).catch(() => {});
  opening = null;
}
```

</details>

**impact:** One connection per tab instead of one per cache operation; sign-out releases it.


## 5. Architecture — SOLID, DRY, one task per function

### ARCH-01 — Six screen use-cases repeat the same load-and-merge sequence

**severity:** High

**category:** SOLID / DRY / clean code · **area:** apps/web · screen use-cases · **effort:** M

**files:** `apps/web/src/features/papers/application/load-papers-screen.use-case.ts`, `apps/web/src/features/vault/application/load-vault-screen.use-case.ts`, `apps/web/src/features/experiments/application/load-experiments-screen.use-case.ts`, `apps/web/src/features/{report,plan,reading-lists}/application/load-*-screen.use-case.ts`

**problem:**

The identical orchestration — parallel load of owned rows, lists, pins and shares; build a membership map; merge pinned extras; return a view model — is written out six times. BUG-01 exists because one of the six drifted.

**how discovered:**

Reading `LoadPapersScreenUseCase` and `LoadVaultScreenUseCase` side by side: the bodies are the same except for the repository, the `ShareableType` and one field name.

**why:**

Each copy is a place the rule can be got subtly wrong, and they *have* been got wrong differently (see BUG-01). It also means a fix to the merge — the PERF-02 grant index, for instance — has to be applied six times or lands in one file and helps one screen.

**fix:**

Extract the shared half into core and leave each screen its projection:

```ts
// packages/core/src/features/library/application/load-pinned-screen.ts
export async function loadPinnedScreen<T extends { id: string }, TFull extends T>(input: {
  resourceType: ShareableType;
  owned: Promise<T[]> | T[];
  pins?: ILibraryPinRepository;
  shares?: IShareRepository;
  loadById: (id: string) => Promise<TFull | null>;
  membership?: { lists: ReadingList[]; items: ReadingListItem[]; keyOf: (i: ReadingListItem) => string | undefined };
}) { /* … one implementation … */ }
```

Each `Load*ScreenUseCase` then becomes a projection over that result, and the contract test for the merge covers all six screens at once.

**impact:** One merge rule, six thin screens, and BUG-01 becomes structurally impossible.

### ARCH-02 — `listSummaries?.() ?? list()` is spelled out at six call sites

**severity:** High

**category:** SOLID / DRY / clean code · **area:** packages/core · repository contracts · **effort:** M

**files:** `apps/web/src/features/papers/application/load-papers-screen.use-case.ts`, `apps/web/src/features/vault/application/load-vault-screen.use-case.ts`, `apps/web/src/create-app-container.ts`

**problem:**

The projection method is optional on the repository interface, so every caller writes a fallback to the expensive full read. Miss the fallback and the screen silently loads abstracts, bibtex and metadata it does not need.

**how discovered:**

Grepping the pattern across the files read: it appears in both screen use-cases, twice inside the ink vocabulary closure, and twice in `PrefetchProjectUseCase`.

**why:**

An optional method on an interface is a promise that some implementation may not have it, which pushes the decision to every call site. The domain already distinguishes `Paper` from `PaperSummary`; the contract should say so (Interface Segregation) instead of leaving each caller to guess.

**fix:**

Make the projection required on the repositories that have one and delete every fallback:

```ts
export interface IPaperRepository {
  list(): Promise<Paper[]>;
  listSummaries(): Promise<PaperSummary[]>;   // required, not optional
  /* … */
}
```

Update the in-memory fake and the contract test suite, then run `npm run check:solid` to find the call sites that stop compiling — that list *is* the work.

**impact:** Removes six fallbacks, and makes BUG-08 (summary typed as full) impossible to write.

### ARCH-03 — `PapersFacade` is a 35-method god object spanning five responsibilities

**severity:** High

**category:** SOLID / DRY / clean code · **area:** apps/web · facades · **effort:** L

**files:** `apps/web/src/container/facades/papers.ts`

**problem:**

One class owns loading, deleting, importing, tagging, custom fields, annotation pins, reader annotations, Zotero sync and write-back, image storage and report-section listing. Every consumer that needs one of them depends on all of them.

**how discovered:**

Counting the public members and grouping them by the dependency they touch: 19 constructor dependencies, 8 distinct concerns.

**why:**

It violates Single Responsibility (five reasons to change) and Interface Segregation (a component that lists paper fields still pulls in the Zotero credential provider through the constructor object type). It is also why the two Zotero push paths drifted (BUG-09): nothing in the type says they are the same operation.

**fix:**

Split by concern and compose:

```ts
// container/facades/papers.ts
export const papersModule = (deps: PapersDeps) => ({
  papers: new PapersFacade(deps),            // load, add, import, update, delete
  fields: new PaperFieldsFacade(deps),       // defs, values, rollups
  annotations: new AnnotationsFacade(deps),  // pins, quotation types, reader annotations
  images: new PaperImagesFacade(deps),       // signed urls, upload, fetch
  zotero: new PaperZoteroFacade(deps),       // sync, push, dry-run
});
```

The container keeps `papers: papersModule(deps)` so no call site changes its import path, while each facade now has one reason to change and its own test double.

**impact:** Smaller surfaces, honest test doubles, and a natural home for each bug above.

### ARCH-04 — Inline `import("@weaveforge/core").X` type imports are repeated a dozen times per file

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · facades and use-cases · **effort:** S

**files:** `apps/web/src/container/facades/papers.ts`, `apps/web/src/container/facades/experiments.ts`, `apps/web/src/features/experiments/application/load-experiments-screen.use-case.ts`, `apps/web/src/features/search/application/workspace-search.ts`

**problem:**

The real dependency list of a class is unreadable: types are declared inline, sometimes twice for the same name, so reviewing a constructor means parsing dynamic-import expressions.

**how discovered:**

`PapersFacade` imports `IPaperRepository`, `IAnnotationPinRepository`, `IAnnotationQuotationTypeRepository`, `NewReaderAnnotation`, `ReaderAnnotationPatch`, `QuotationType` and `ZoteroCredentialsProvider` inline — while importing nine other types normally at the top of the same file.

**why:**

It is almost certainly an artefact of an automated fix for a circular-import or lint error, applied one line at a time. The result is two spellings for one concept in one file, which is exactly the inconsistency a reader has to hold in their head.

**fix:**

Hoist them to a single `import type { … } from "@weaveforge/core"` at the top (type-only imports erase at compile time, so there is no runtime cost and no cycle), and add an ESLint rule to keep it that way:

```json
"@typescript-eslint/consistent-type-imports": ["error", { "prefer": "top-level", "fixStyle": "separate-type-imports" }]
```

**impact:** Dependencies readable at a glance; one spelling per type.

### ARCH-05 — `fetchImageBlobs` re-implements the batch fetch the store already owns

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · facades · **effort:** S

**files:** `apps/web/src/container/facades/papers.ts`

**problem:**

Two functions do one task: fetch several blobs keyed by path. The fallback exists only because `fetchBlobs` is optional on `IPaperImageStore`, and its own comment records that an unbound version threw in production.

**how discovered:**

The method body: an `if (images.fetchBlobs)` fast path plus a manual parallel loop that rebuilds the same `Map<string, Blob>` contract.

**why:**

An optional capability on an interface that every implementation has is a wart that migrates into every caller. Here it has already produced one bug (the unbound `this`) and a second implementation to maintain.

**fix:**

Make `fetchBlobs(paths: readonly string[]): Promise<Map<string, Blob>>` required on the interface, implement it once per store, and delete the facade branch:

```ts
fetchImageBlobs(paths: readonly string[]) {
  return this.deps.images.fetchBlobs(paths);
}
```

**impact:** One batch-fetch implementation; the store controls its own batching.

### ARCH-06 — `importLocalZotero` does bridge detection, dynamic imports and business rules in a facade

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · facades · **effort:** M

**files:** `apps/web/src/container/facades/papers.ts`

**problem:**

One method checks for the desktop bridge, dynamically imports two modules, decides which papers to create, and reconciles tag sources — inside a class whose job is to expose a UI API.

**how discovered:**

Reading the method: `desktop()` capability check → `await import(desktop-bridge)` → `await import(zotero-local)` → `localZoteroLibrary(bridge, { … onItemTags: … })` → `applyBibliographyAnnotations`.

**why:**

The facade layer is supposed to be a thin, stable surface (ISP). Anything that touches an integration detail here cannot be tested without the desktop bridge, and the tag-reconciliation rule is invisible to the core test suite where the rest of the Zotero rules live.

**fix:**

Move the orchestration into `features/papers/application/import-local-zotero.use-case.ts`, taking the bridge as a constructor dependency:

```ts
export class ImportLocalZoteroUseCase {
  constructor(private readonly deps: {
    bridge: DesktopBridge | null;      // injected, so tests need no Electron
    papers: IPaperRepository;
    addPaper: AddPaperUseCase;
    manageTags: ManageTagsUseCase;
  }) {}

  async execute() { /* the four steps, in one place, unit-testable */ }
}
```

The facade keeps one line: `importLocalZotero() { return this.deps.importLocalZotero.execute(); }`.

**impact:** The Zotero-import rule becomes testable and the facade stays thin.

### ARCH-07 — Four repository methods differ only by column name

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · papers repository · **effort:** S

**files:** `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts:94-118`

**problem:**

Four copies of "select one row where column = value, scoped to the project". A change to the projection (PERF-04) or the scoping (BUG-05) has to be made four times, and the DOI variant additionally has to remember `normalizeDoi`.

**how discovered:**

Reading the four bodies in sequence — the only differences are the column literal and whether the value is normalised first.

**why:**

This is the copy-paste shape that lets BUG-05 happen: the scoping guard was added to the other methods and these four were edited individually. Parameterising removes the possibility.

**fix:**

One private helper, four one-line public methods:

```ts
private findBy(column: 'arxiv_id' | 'arxiv_bidx' | 'doi' | 'doi_bidx', value: string) {
  return one<PaperRow>(this.scoped(this.db.from(TABLE).select(PAPER_ID_COLUMNS)).eq(column, value).maybeSingle())
    .then((row) => (row ? toDomain(row) : null));
}

findByArxivId(id: string) { return this.findBy('arxiv_id', id); }
findByDoi(doi: string) { const d = normalizeDoi(doi); return d ? this.findBy('doi', d) : null; }
```

**impact:** One place to fix scoping and projection; BUG-07 disappears with the assertion.

### ARCH-08 — Two copies of "push this paper to Zotero", one of them inside the composition root

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · composition root + facade · **effort:** S

**files:** `apps/web/src/container/facades/papers.ts`, `apps/web/src/create-app-container.ts`

**problem:**

The same business rule is written twice, and one of the copies lives in `create-app-container.ts` — a file whose job is wiring, not rules.

**how discovered:**

Comparing `PapersFacade.autoPush` with the `pushZotero` callback passed to `GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY`: both skip when `metadata.zoteroKey` is set, call `bibliography.pushPaper(paper)`, and save the key back on success.

**why:**

Rules in the composition root cannot be unit-tested without constructing a container, so the copy that matters least is the least tested. Any change to the write-back (a conflict check, an audit log) has to be made twice.

**fix:**

Put the rule in core and inject it twice:

```ts
// packages/core/src/features/papers/application/push-paper-to-zotero.use-case.ts
export class PushPaperToZoteroUseCase {
  constructor(private readonly deps: { bibliography: IBibliographyIntegration; papers: IPaperRepository }) {}
  async execute(paper: Paper): Promise<string | null> {
    if (paper.metadata?.zoteroKey) return paper.metadata.zoteroKey;
    const key = await this.deps.bibliography.pushPaper(paper);
    if (key) await this.deps.papers.save({ ...paper, metadata: { ...paper.metadata, zoteroKey: key } });
    return key ?? null;
  }
}
```

**impact:** One tested rule, injected wherever it is needed.

### ARCH-09 — `appendPaperNote` is an inline use-case in the composition root

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · composition root · **effort:** S

**files:** `apps/web/src/create-app-container.ts`

**problem:**

A business rule with a conflict check (compare `updatedAt` to an expected revision, return "conflicted") lives in the wiring file, so it is only reachable through a built container.

**how discovered:**

The `aiPaperNotes` literal in `createAppContainer`. It is the only place in the app that knows what "conflicted" means for an AI-proposed note append.

**why:**

The rule is small but it is a rule — and it is the kind that needs table tests (no expected revision, matching revision, stale revision, missing paper). Those tests belong next to `appendPaperNote` in core, not in a container integration test.

**fix:**

Move it to core as `AppendPaperNoteUseCase` with the same three-outcome return, and pass the instance into the executor factory.

**impact:** The AI write path's conflict rule becomes unit-tested.

### ARCH-10 — `requireSdkUser` and `requireMcpRelayUser` are two copies of one auth flow

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · API auth · **effort:** M

**files:** `apps/web/src/app/api/sdk/_shared.ts`

**problem:**

One authentication flow, two implementations, already divergent: `requireSdkUser` maps configuration faults to 503 and others to 500, `requireMcpRelayUser` maps every failure to 503, and their error strings differ.

**how discovered:**

Reading the two functions in sequence. The relay one is a near-copy with the scope constant changed — including a copy of the deliberate comment explaining why the check exists twice.

**why:**

The comment explains that the duplication is intentional *at the seam* (application half plus database half of one check). It does not justify duplicating the whole flow inside one file. Divergent status codes are the visible symptom; the next change (a new token format) will be applied to one and not the other.

**fix:**

One parameterised function:

```ts
export function requireApiCaller(request: Request, scope: 'sdk' | 'mcp_relay'): Promise<ApiAuthResult> {
  /* bearer → format → apiTokenScopes → resolve → getUser, once */
}
export const requireSdkUser = (req: Request) => requireApiCaller(req, 'sdk');
export const requireMcpRelayUser = (req: Request) => requireApiCaller(req, 'mcp_relay');
```

Keep the two exported names (call sites read better) and keep one status-code policy for both.

**impact:** One auth flow to audit; consistent status codes across the API surface.

### ARCH-11 — `WorkspaceSearch` mixes five concerns and duplicates its own projection

**severity:** Medium

**category:** SOLID / DRY / clean code · **area:** apps/web · search · **effort:** L

**files:** `apps/web/src/features/search/application/workspace-search.ts`

**problem:**

One class builds the index, prunes orphaned PDF text, projects documents, tracks staleness, fans out hybrid queries and exports a pure ranking helper. The document projection is written twice — once in `projectDocuments`, once inside `refreshStale`.

**how discovered:**

Both methods spread `toSearchDocs`, `toAnnotationSearchDocs` and (in one of them) `toPdfSearchDocs` with the same degree map. The staleness bookkeeping (`documentCount`, `pdfPageCounts`, `stale`) is mutated from four different methods.

**why:**

The invariants of the index state are spread across the class, so any new mutation site has to know all of them. And the duplicated projection is how a note field ends up searchable after a full rebuild but not after an incremental refresh.

**fix:**

Extract, keeping the class as the lifecycle owner:

- `search-projection.ts` — `projectDocuments(snapshot, degrees, pdfTexts)` and `projectForKinds(...)`, one implementation.
- `pdf-text-pruner.ts` — `pruneOrphans(stored, livePaperIds)` returning `{ live, orphans }`.
- `index-state.ts` — a small value object owning `documentCount` and `pdfPageCounts` with `add(docs)` / `remove(ids)` / `replace(previous, next)`.
- `collapseToEntities` moves to `search-ranking.ts`.

`WorkspaceSearch` then reads as: ensure → build → refresh → query.

**impact:** One projection, encapsulated state, and a class whose methods each have one job.

### ARCH-12 — Screen ids exist in two lists that must be kept in sync by hand

**severity:** Low

**category:** SOLID / DRY / clean code · **area:** apps/web · nav + cache · **effort:** S

**files:** `apps/web/src/lib/screen-for-path.ts`, `apps/web/src/lib/cache/cache-invalidation-map.ts`

**problem:**

Add a screen and forget the invalidation entry (or misspell it), and that screen's cache is never cleared on write — a stale screen with no error anywhere.

**how discovered:**

Comparing the two literals. `"shared-with-me"` appears in the map; the route table spells the same screen `"shared-with-me"` too, but nothing verifies it, and a new route (`/org`, `/showcase`) has no entry in either.

**why:**

Two sources of truth for one vocabulary. `clearScreenCachesForScreens` deletes keys that simply do not exist when a name drifts — a silent no-op.

**fix:**

One registry, both derived, plus a test:

```ts
// lib/screens.ts
export const SCREENS = ['papers', 'vault', 'graph', 'lists', 'experiments', 'plan', 'logbook', 'report', 'shared-with-me', 'dashboard'] as const;
export type ScreenId = (typeof SCREENS)[number];
```

Type `WRITE_INVALIDATION_MAP.screens` as `readonly ScreenId[]` and add a test asserting every screen id in the map is in `SCREENS` (and vice versa for the cached ones).

**impact:** A typo becomes a compile error instead of a stale screen.

### ARCH-13 — A shared crypto/clock adapter is missing, so adapters are inlined at wiring sites

**severity:** Low

**category:** SOLID / DRY / clean code · **area:** apps/web · composition root · **effort:** S

**files:** `apps/web/src/create-app-container.ts`, `apps/web/src/features/papers/infrastructure/system.ts`

**problem:**

`systemClock` and `uuidIds` were correctly extracted into one module; the very next adapter (`randomBytes`) was inlined at the call site instead.

**how discovered:**

The `CreateShareLinkUseCase` wiring defines a fresh closure for random bytes while importing two siblings from `system.ts`.

**why:**

It is the same class of decision (inject the non-deterministic edge) made two different ways in one file. The inline version is also untestable without patching `crypto`.

**fix:**

Add it beside its siblings and import it:

```ts
// features/papers/infrastructure/system.ts
export const randomBytes: (n: number) => Promise<Uint8Array> = async (n) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};
```

**impact:** Every non-deterministic edge has one home and one test double.

### ARCH-14 — Python SDK finalisation is three module functions with duplicated guard style

**severity:** Low

**category:** SOLID / DRY / clean code · **area:** python SDK · **effort:** M

**files:** `python/weaveforge/tracking.py`

**problem:**

Run finalisation is spread across the context manager and two helpers, each with its own `except Exception: warnings.warn(...)`. BUG-15 is a direct consequence: the success path had no helper to call.

**how discovered:**

Reading the three guard blocks — the same three lines appear three times, and the one path that needed them (post-yield) does not have them.

**why:**

The guard style is a policy ("never mask the caller's exception, always warn") that belongs in one place. Written per call site, it is applied where the author remembered it.

**fix:**

One collaborator with two entry points:

```python
class RunFinaliser:
    """Best-effort exit. Never raises; never masks the caller's exception."""
    def __init__(self, run: Run, connection: Any | None) -> None:
        self._run, self._connection = run, connection

    def succeeded(self, sync: Mapping[str, Any] | None, status: ExperimentStatus) -> None:
        try:
            for source_id, ref in dict(sync or {}).items():
                self._run.sync(source_id, ref)
            self._run.flush()
            self._run.set_status(status)
        except Exception:
            self.failed()
            raise

    def failed(self) -> None:
        self._guard("mark the run failed", lambda: self._run.set_status("failed"))
        self._guard("send metrics", self._run.flush)

    def close(self) -> None:
        self._guard("close the API client", self._close_connection)

    def _guard(self, what: str, action: Callable[[], Any]) -> None:
        try:
            action()
        except Exception as exc:  # noqa: BLE001
            warnings.warn(f"weaveforge: could not {what} ({exc})", stacklevel=3)
```

**impact:** One finalisation policy, both exits covered (BUG-15), and it is directly unit-testable.

### ARCH-15 — Freshness is defined twice, in two units, in two modules

**severity:** Low

**category:** SOLID / DRY / clean code · **area:** apps/web · screen cache · **effort:** S

**files:** `apps/web/src/lib/cache/screen-cache.ts`, `apps/web/src/lib/cache/screen-cache-idb.ts`

**problem:**

Two numbers answer "how old is too old?" for the same cached payload, live in different files, and are measured against different clocks (write time vs server fetch time). Changing the caching policy means finding both.

**how discovered:**

Reading the memory cache and its IDB backing store together: the in-memory module stamps `loadedAt` from `Date.now()` by default while the IDB module carefully preserves the *fetch* time — two notions of age one layer apart.

**why:**

They are genuinely different questions (skip-the-network vs show-at-all), so this is not a straight duplicate. But nothing says so, and the default `fetchedAt = Date.now()` in `setScreenCache` means the memory layer can quietly discard the server's timestamp the IDB layer went to trouble to preserve.

**fix:**

Name both policies in one module and pass the fetch time explicitly:

```ts
// lib/cache/cache-policy.ts
export const SCREEN_REVALIDATE_AFTER_MS = 120_000;   // older than this → refetch in background
export const SCREEN_SHOW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // older than this → do not show
```

Then `setScreenCache(key, value, fetchedAt)` requires the timestamp at every call site, and the two knobs sit where someone tuning cache behaviour will look.

**impact:** One place to tune caching, and the server's fetch time stops being lost in memory.


## 6. Rollout order

### Stop the bleeding (Day 1-2)

Every finding that loses data, shows the wrong thing, or widens the attack surface. No refactors in this phase — each item is independently shippable.

- BUG-01, BUG-09, BUG-19 — One-line fixes with a contract test each.
- SEC-01, SEC-04 — Guard correctness: the IPv4 canonical-form check and the fail-closed tool allowlist.
- BUG-15, BUG-16, BUG-17 — Python SDK exit paths; add tests for mirror TypeError, sync failure and positional run injection.

### Make the hot paths cheap (Week 1)

The three O(n²) paths and the per-request waste. Measure before and after; each has a number attached.

- PERF-01, PERF-02, PERF-03 — Image stripping, share grants, rollup indexing — all one-pass rewrites.
- PERF-04, PERF-09, BUG-06 — Repository projections, server-side delta predicate, parallel chunks.
- PERF-05, MEM-04 — Module-scope admin client, single resolve RPC, bounded preallocation.

### Fix the contracts (Week 2)

Turn the patterns that produced the bugs into types, so the compiler refuses them.

- ARCH-02, BUG-08 — Required projection methods and honest return types; the compiler then lists the call sites.
- ARCH-01, BUG-03, BUG-04 — One pinned-screen loader with a request-sequence guard inside it.
- BUG-05, ARCH-07 — Project scoping moved into the base repository; four findBy methods collapse to one.
- BUG-07, BUG-12, BUG-13 — Remove the lying assertions; distinguish unknown base version and reauth from conflict/offline.

### Split the surfaces (Week 3-4)

The structural work. Do it after the contracts are tight, otherwise the split moves bugs around instead of removing them.

- ARCH-03, ARCH-05, ARCH-06 — Facade decomposition, required batch fetch, Zotero import use-case.
- ARCH-08, ARCH-09, ARCH-13 — Rules out of the composition root and into core.
- ARCH-10, ARCH-11, ARCH-14 — One auth flow, one search projection, one finalisation policy.
- MEM-01, MEM-02, MEM-03 — Container-scoped cache registry, release the corpus copy, delete the dead registry.

### Keep it fixed (Ongoing)

Guardrails. Every fix above is one refactor away from coming back unless a gate notices.

- ARCH-12, ARCH-04 — One screen registry with a type, and a lint rule for top-level type imports.
- SEC-02, SEC-03, SEC-05, SEC-06 — Port allowlist, generic route errors, pinned-address agent, rate limiting.
- BUG-02, BUG-10, BUG-11, BUG-14, BUG-18, BUG-20, MEM-05, MEM-06, PERF-06, PERF-07, PERF-08, PERF-10, ARCH-15 — The remaining small correctness, memory and hot-path items.


## 7. Guardrails — keeping the fixes fixed

| Gate | Where | What it catches |
| --- | --- | --- |
| `no-floating-promises` + `require-await` in ESLint | apps/web | The `void import(...)` fire-and-forget calls in `screen-cache.ts` and the unawaited `reload()` in the hook — the pattern behind BUG-03's race. |
| A hook lint rule banning non-primitive deps (`load`) or mandating a ref | apps/web · eslint-plugin-react-hooks | BUG-02. A custom rule that fails when a `useCallback` dep is a function parameter is ~20 lines and pays for itself immediately. |
| Contract test asserting every screen use-case merges pins before building its view model | packages/core + apps/web tests | BUG-01. Parameterise the existing repository contract suites over the six screen loaders. |
| Table test for `isPublicAddress` with non-canonical IPv4 forms | packages/core tests | SEC-01. `010.0.0.1`, `1.2.3.04`, `2130706433`, `0x7f.0.0.1`, `[::ffff:127.0.0.1]`. |
| A `check:dry` rule for `select("*")` outside test files | scripts/check-dry.mjs | PERF-04 and any future over-fetch. The gate infrastructure already exists and asserts its own allowlist. |
| A `check:solid` rule capping facade method count and constructor dependency count | scripts/check-solid.mjs | ARCH-03. A ceiling of, say, 20 public methods turns the god facade into a build failure before it grows again. |
| Bundle-size and screen-payload budgets in CI | apps/web · next build + a size assertion | PERF regressions generally, and the eager-wiring growth in the composition root. |
| A unit test for `scripts/lib/search.mjs` path formatting | scripts/test | A silently inert DRY gate — the failure mode that file's own comments describe at length. |

## 8. Checked and found sound

- `packages/core/src/net/url-safety.ts` — IPv6 expansion is written out rather than pattern-matched, precisely because `URL` normalises `[::ffff:127.0.0.1]` to `::ffff:7f00:1` — and the v4-mapped branch then defers to the IPv4 rules. NAT64, 6to4, ULA, link-local and documentation ranges are all refused.
- `apps/web/src/backend/net/safe-fetch.ts` — `redirect: "manual"` with a re-check per hop, a wall-clock budget carried across hops, and `reader.cancel()` on the over-cap path so the connection does not stay open pulling bytes nobody reads.
- `packages/core/src/features/papers/application/compute-rollup.ts` — First-value-wins indexing, `Number.isFinite` filtering before sum/average, and an explicit loop instead of `push(...value)` to avoid a stack overflow on a six-figure relation.
- `apps/web/src/lib/workspace-changes.ts` — A deliberately tiny listener bus: iterates a copy, isolates listener failures from the write that triggered them, and exposes a reset for tests.
- `apps/web/src/lib/semantic-scholar-fetch.ts` — Retry policy that distinguishes a throttled answer from an ambiguous `TypeError`, and only retries the latter in a browser — with the original error preserved for the caller.
- `apps/web/src/lib/hooks/use-submit.ts` — One submit shape for every form: throwing is how a form reports a validation failure, and `finally` guarantees the button never sticks on "Saving…".
- `apps/web/src/features/papers/infrastructure/supabase-paper-repository.ts` — `created_at` + `id` as a total order, with the comment explaining why a tie reshuffled cards between grid columns. That reasoning is correct and should survive any refactor of `list`.
