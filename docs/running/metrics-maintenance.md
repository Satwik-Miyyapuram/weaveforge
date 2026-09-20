# Metrics maintenance

`experiment_metrics` is the only data in the schema that grows without bound: a
training run that logs every step writes a row per step per metric, forever.
Three migrations exist to keep that from filling the volume, and **one of them
only does anything if something runs it.**

| Migration | What it does | Runs by itself? |
|---|---|---|
| `0014` + `0114` | Narrows a point to 56 bytes and turns `experiment_metrics` into a view | on apply |
| `0115` | Packs settled points into arrays in `experiment_metric_chunks` — 132 → 21 bytes/point | **no** |
| `0115` | `experiment_metrics_rollup()` moves rows into chunks | **no** |

Also: `apps/web/src/app/api/sdk/metrics/route.ts` thins a series on the way in
(Fix C: every point below step 10 000, then a sampling rate that halves once per
octave), so the *stored* point count is logarithmic in run length. That is the
ingest path. A writer that talks to PostgREST directly — the Python SDK's
`SupabaseMetricRepository` — bypasses it, which is what the pruning script below
is a backstop for.

## The two commands

```bash
# Move settled points into chunks. Safe to run any time; whole chunks only.
npm run rollup:metrics

# Re-apply the ingest sampling rule to series that predate it or bypassed it.
npm run prune:metrics            # report only
npm run prune:metrics -- --apply # delete the off-grid points
```

Both read `DATABASE_URL` from the environment, falling back to
`secrets/.env.migration`. Both accept the flags their script's header documents
(`--chunk`, `--hot-tail`, `--vacuum`).

## Suggested schedule

Nothing schedules these for you, and the repository deliberately does not
pretend otherwise: a cron entry is deployment configuration, and rolling up on
the write path was rejected because it would put an array rewrite in front of
every ingest.

```cron
# Daily: archive what has settled. Cheap — it only touches whole chunks beyond
# the 250-point hot tail of each series.
17 3 * * *  cd /opt/weaveforge && npm run rollup:metrics >> /var/log/weaveforge-rollup.log 2>&1

# Weekly: check for series that grew past the sampling rule.
23 3 * * 0  cd /opt/weaveforge && npm run prune:metrics >> /var/log/weaveforge-prune.log 2>&1
```

Add `--vacuum` to the monthly run if you need the on-disk figure to drop; it
takes an `ACCESS EXCLUSIVE` lock, which is why it is opt-in rather than part of
the daily job.

Nothing is lost by *not* running the rollup — every point stays readable, the
view unions both stores, and the read path (`latest_metric_activity`,
`metric_history`) works either way. What you lose is the space: 132 bytes per
point instead of 21.

## Checking whether it is working

```sql
-- How much of each series is archived rather than loose.
select (select count(*) from experiment_metric_chunks) as chunks,
       (select count(*) from experiment_metric_points) as loose_rows;

-- Points still awaiting a rollup per series.
select experiment_id, metric_id, count(*)
  from experiment_metric_points
 group by experiment_id, metric_id
 having count(*) > 500
 order by count(*) desc
 limit 20;
```
