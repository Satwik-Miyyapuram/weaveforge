# `experiment_metrics` storage — measured, and what to do about it

**Status:** planned, all three fixes wanted — see [the plan](#plan--all-three-in-this-order).
**Do this after the OCI cutover**, not before: changing the schema while the
migration is pending would diverge from Supabase and break the byte-identical
verification that proves the copy worked.

**Combined effect:** 439 B/row today → ~110 B after A → ~10–15 B/point after B,
with C capping growth rather than just slowing it. A 400k-point training run
goes from 170 MB to roughly 5 MB.

**Why it matters:** every other table is text and effectively fixed in size.
`experiment_metrics` is the only one that grows without bound, so it alone
decides when the 50 GB `pgdata` volume runs out — and the Always Free allowance
is 200 GB across *all* volumes, boot included, so there is nowhere to grow into
without paying.

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

### 1. Fix A — schema (migration `0112`)

Mechanical, low risk, 4×. Do it first because **`metric_id` is a prerequisite
for B** — the chunk table keys on it too, so this work is not thrown away.

- [ ] `experiment_metric_names` lookup table, backfill from `distinct metric`
- [ ] Check for duplicate `(experiment_id, metric, step)` **before** adding the PK
- [ ] Rewrite `experiment_metrics` with the new key and columns
- [ ] Re-point RLS policies; keep `user_id` for now, measure the join cost separately
- [ ] Update the ingest route and any readers of `metric`

### 2. Fix C — downsampling on write

Independent of the storage layout, so it can land alongside or just after A.
This is the one that changes the shape of the problem: without it, every other
saving is a constant factor against unbounded growth.

- [ ] Per-series point budget (keep all below ~10k steps, then 1-in-N)
- [ ] Decide where it runs: SDK (cheaper, bypassable) or ingest route
      (authoritative). **Ingest route** — the SDK is not the only writer
- [ ] Keep first and last point of every series regardless, so curves do not
      lose their endpoints
- [ ] Retention pass for series already over budget

### 3. Fix B — chunked arrays (migration `0113`+)

The 30× win, and the largest change. Do it last: it supersedes A's row layout
but reuses `metric_id`, and by then C will have capped how fast the table grows,
so there is no schedule pressure while building it.

- [ ] `experiment_metric_chunks (experiment_id, metric_id, chunk_no, start_step, values float8[], wall_times timestamptz[])`
- [ ] Append path: fill the open chunk, seal at N points, start the next
- [ ] Read path: expand chunks back into points; keep the existing API shape so
      nothing above the repository changes
- [ ] Backfill from the row table, then drop it
- [ ] Contract tests over both layouts before the switch

⚠️ **Ordering constraint:** B rewrites what A produces. Doing B first, or the two
concurrently, means writing the chunk logic against a schema that is about to
change underneath it. A → C → B is the cheap path; A and C together is fine.

## Related

| | |
|---|---|
| Table definition | [`0016_experiment_metrics.sql`](../../supabase/migrations/0016_experiment_metrics.sql) |
| Ingest path | [`sdk/metrics/route.ts`](../../apps/web/src/app/api/sdk/metrics/route.ts) |
| SDK batching (`_FLUSH_EVERY = 1000`) | [`run.py`](../../python/weaveforge/features/experiments/application/run.py) |
| Disk headroom and alerting | [`oracle-shift-guide.md`](../backend/oracle-shift-guide.md) |
