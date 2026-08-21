# `experiment_metrics` storage — measured, and what to do about it

**Status:** done. All three fixes are implemented and applied to the live OCI
database — Fix A and B as migrations `0114`/`0115`, Fix C in the SDK ingest
route. This document keeps the original analysis, annotated with what the work
actually measured.

**Measured result:** 448.7 B/point before, 130.9 B/point after Fix A, and
22.5 B/point after Fix B — a 9.7× reduction, verified on a 200k-point workload
against the live server. Fix C caps a series at ~40k points however long the run
is, which is the part that turns unbounded growth into bounded growth.

**Why it mattered:** every other table is text and effectively fixed in size.
`experiment_metrics` is the only one that grows without bound, so it alone
decides when the 50 GB `pgdata` volume runs out — and the Always Free allowance
is 200 GB across *all* volumes, boot included, so there is nowhere to grow into
without paying.

> **What the original estimates got wrong.** Kept here because the corrections
> are the useful part:
>
> * **`smallint` for `metric_id` saves nothing.** Alignment padding between
>   `metric_id` and `step` makes `smallint` and `int` byte-identical at 200k
>   points. `int` shipped instead — same size, and it does not cap the whole
>   deployment at 32767 metric names shared across every tenant.
> * **Fix B is 10×, not 30×.** 22.5 B/point, not 10–15. The difference is the
>   fidelity this plan's own checklist asks for: `wall_times` costs 8 B/point
>   and explicit `steps` 4 B/point. Dropping per-point wall times would reach
>   ~13 B, but that is a product decision — `MetricPoint.wallTime` is in the
>   domain type and read back by `history()`.
> * **`alter table … drop column` reclaims nothing.** The first cut of 0114
>   dropped `id`, `metric` and `created_at` in place and moved the live table
>   from 448.7 to 441.8 B/row — a 1.5% "win" that was three
>   `........pg.dropped.N........` ghosts still sitting in every tuple. The
>   shipped migration builds a new table and swaps it.
> * **The uniqueness warning was justified.** The live table held 86 duplicate
>   `(experiment_id, metric, step)` rows across 2 experiments. All were exact
>   re-ingests — identical value and wall time — so collapsing them was
>   lossless, and ingest is now idempotent so they cannot recur.
> * **JSONB was considered and rejected.** One document per experiment measures
>   19.6 B/point on realistic curve data versus 22.0 for binary arrays — about
>   10%, and only because large JSONB gets TOAST-compressed. It loses on
>   everything else: every metric flush would rewrite the whole document through
>   TOAST, all metrics of one experiment would serialise on a single row, and
>   `metric=eq.loss&order=step.asc` could not be pushed down.

**How to re-measure:** `node scripts/measure-metrics-storage.mjs` for the live
table, `node scripts/measure-metrics-layouts.mjs` to compare all three layouts
at scale. Both need the SSH tunnel from
[`oracle-shift-guide.md`](../backend/oracle-shift-guide.md).

---

## Measured, not estimated

From the live Supabase database, 1,625 rows:

```
actual tuple data   107.5 B     the real payload
heap per row        247 B       +130 B page slack and alignment
indexes per row     166 B       across three indexes
total               439 B
```

Three indexes on a time series:

| Index | Size | Earning its place? |
|---|---|---|
| `experiment_metrics_pkey` on `id uuid` | 88 kB | **No** — a surrogate key nothing queries |
| `experiment_metrics_series_idx` on `(experiment_id, metric, step)` | 144 kB | Yes — this *is* the access pattern |
| `experiment_metrics_user_id_idx` | 32 kB | Only for RLS |

And `metric` is stored as **text on every row**, with **10 distinct values** in
the entire table.

*(The 247 B heap figure is inflated by small-table slack; at scale it settles
nearer 130 B. The index and column costs below are real at any size.)*

---

## Where the bytes actually go

Per row, from [`0016_experiment_metrics.sql`](../../supabase/migrations/0016_experiment_metrics.sql):

| Column | Bytes | Verdict |
|---|---|---|
| `id uuid` | 16 | Random UUID nothing reads, plus ~54 B/row of index |
| `user_id uuid` | 16 | Derivable from `experiment_id`; carried for RLS speed |
| `experiment_id uuid` | 16 | Needed |
| `metric text` | ~8.5 | Ten distinct values, repeated per row *and* per index entry |
| `step int` | 4 | Needed |
| `value float8` | 8 | Needed |
| `wall_time timestamptz` | 8 | Needed |
| `created_at timestamptz` | 8 | Redundant with `wall_time` |

Roughly half the row is a surrogate key and a repeated string.

---

## Fix A — schema, ~110 B/row (4×)

The cheap one. A single migration, mechanical.

1. **Drop `id uuid`; make the primary key `(experiment_id, metric_id, step)`.**
   Removes 16 B of heap *and* the whole `pkey` index, and the series index stops
   being a duplicate of the PK.
2. **`metric text` → `metric_id smallint`** against a small lookup table.
   8.5 B → 2 B on every row and every index entry.
3. **Drop `created_at`.** `wall_time` already carries the timestamp.
4. **Reconsider `user_id`.** Dropping it saves 16 B plus its index, at the cost
   of RLS joining through `experiments`. Measure before deciding — this one is a
   trade, not a free win.

⚠️ **`(experiment_id, metric_id, step)` as a PK asserts uniqueness the current
schema does not.** Check for duplicate steps before relying on it; a run that
logs the same step twice would newly conflict.

**Effect:** 116M rows to fill 50 GB becomes **~450M**. A 400k-row training run
drops from 170 MB to 44 MB.

## Fix B — chunked arrays, ~10–15 B/point (30×)

One row per `(experiment_id, metric_id, chunk_no)` holding `float8[]` values and
a starting step. What time-series databases do, and it removes the per-row
tuple header — the single largest overhead — for all but one point in each
chunk.

Costs a more complicated read path and append logic. Worth it only if metric
volume genuinely reaches millions of points; not worth pre-emptively.

## Fix C — downsample on write

Bounded rather than smaller: keep every point up to ~10k steps per series, then
one in N. No amount of byte-shaving turns unbounded growth into bounded, and
this does. Best paired with Fix A.

---

## Plan — all three, in this order

All three are wanted. They are not alternatives; each removes a different cost,
and the order matters because of what carries forward.

### 1. Fix A — schema (migration `0114`) ✅ shipped

Mechanical, low risk, 4×. Do it first because **`metric_id` is a prerequisite
for B** — the chunk table keys on it too, so this work is not thrown away.

- [x] `experiment_metric_names` lookup table, backfill from `distinct metric`
- [x] Check for duplicate `(experiment_id, metric, step)` **before** adding the PK
- [x] Rewrite `experiment_metrics` with the new key and columns
- [x] Re-point RLS policies; keep `user_id` for now, measure the join cost separately
- [x] Update the ingest route and any readers of `metric`

### 2. Fix C — downsampling on write ✅ shipped

Independent of the storage layout, so it can land alongside or just after A.
This is the one that changes the shape of the problem: without it, every other
saving is a constant factor against unbounded growth.

- [x] Per-series point budget (keep all below ~10k steps, then 1-in-N)
- [x] Decide where it runs: SDK (cheaper, bypassable) or ingest route
      (authoritative). **Ingest route** — the SDK is not the only writer
- [x] Keep first and last point of every series regardless, so curves do not
      lose their endpoints
- [x] Retention pass for series already over budget

### 3. Fix B — chunked arrays (migration `0115`) ✅ shipped

A 10× win as measured (the 30× here was a projection), and the largest change. Do it last: it supersedes A's row layout
but reuses `metric_id`, and by then C will have capped how fast the table grows,
so there is no schedule pressure while building it.

- [x] `experiment_metric_chunks (experiment_id, metric_id, chunk_no, steps int[], values float8[], wall_times timestamptz[])` — `steps` explicit rather than a `start_step` offset, because real series have gaps
- [x] ~~Append path: fill the open chunk, seal at N points, start the next~~ —
      **not built, deliberately.** Postgres cannot append to an array in place,
      so filling a 250-point chunk one point at a time writes ~250 versions of a
      growing row. Writes stay on the row store and
      `experiment_metrics_rollup()` seals whole chunks in one pass instead.
      Density does not suffer: measured flat at 21–24 B/point across chunk sizes
      50/100/250/1000
- [x] Read path: expand chunks back into points; keep the existing API shape so
      nothing above the repository changes
- [x] Backfill from the row table — but *keep* it as the write path and hot tail, rather than dropping it: appending to an array rewrites the whole array, so ingest would have paid hundreds of times the data it wrote
- [x] Contract tests over both layouts before the switch — a 200k-point
      rehearsal in a scratch schema asserts the view returns byte-identical
      curves before 0114, after 0114 and after 0115, and exercises insert,
      update and delete of an *archived* point

⚠️ **Ordering constraint:** B rewrites what A produces. Doing B first, or the two
concurrently, means writing the chunk logic against a schema that is about to
change underneath it. A → C → B is the cheap path; A and C together is fine.

## Related

| | |
|---|---|
| Table definition | [`0016_experiment_metrics.sql`](../../supabase/migrations/0016_experiment_metrics.sql) (superseded) |
| Fix A migration | [`0114_experiment_metrics_narrow_rows.sql`](../../supabase/migrations/0114_experiment_metrics_narrow_rows.sql) |
| Fix B migration | [`0115_experiment_metric_chunks.sql`](../../supabase/migrations/0115_experiment_metric_chunks.sql) |
| Rollbacks | [`migrations-rollback/`](../../supabase/migrations-rollback/) |
| Fix C rule | [`downsample-metrics.ts`](../../packages/core/src/features/experiments/domain/downsample-metrics.ts) |
| Measurement | [`measure-metrics-storage.mjs`](../../scripts/measure-metrics-storage.mjs), [`measure-metrics-layouts.mjs`](../../scripts/measure-metrics-layouts.mjs) |
| Operations | [`rollup-metric-chunks.mjs`](../../scripts/rollup-metric-chunks.mjs), [`prune-metric-series.mjs`](../../scripts/prune-metric-series.mjs) |
| Ingest path | [`sdk/metrics/route.ts`](../../apps/web/src/app/api/sdk/metrics/route.ts) |
| Ingest bounds (5000 points, 200 series per request) | [`metrics/limits.ts`](../../apps/web/src/app/api/sdk/metrics/limits.ts) |
| SDK batching (`_FLUSH_EVERY = 1000`) | [`run.py`](../../python/weaveforge/features/experiments/application/run.py) |
| Disk headroom and alerting | [`oracle-shift-guide.md`](../backend/oracle-shift-guide.md) |
