# Experiment metrics as files (0.9.5)

From 0.9.5 the numbers your training script logs (loss, accuracy and so on)
are stored as small CSV files next to the experiment, not in the database.
The server only holds a short queue while your computer is off.

## The files

Each batch the SDK sends becomes one new file, written once and never appended
to:

```text
<experiment>/metrics/<run>/<batch-id>.csv
```

```csv
run,step,metric,value,time
main,10,loss,0.41,2026-11-19T10:00:00Z
main,10,"val ""loss"", smoothed",0.44,2026-11-19T10:00:00Z
```

- `<experiment>` is the experiment's folder, found by the `weaveforge-id` in
  its file.
- `<run>` is `main` unless the SDK names a run.
- Names with commas, quotes or newlines are quoted (RFC 4180).
- To read, the app merges every chunk: one value per run, step and metric.

## How metrics arrive

- **Desktop on, local SDK.** With `WF_METRICS_FILES=1`, a local
  `POST /api/sdk/metrics` is written straight to a chunk. The same request sent
  twice names the same chunk, so it is stored once. A request with any bad
  point writes nothing.
- **Desktop off.** The SDK posts to the server's inbox. When the app opens, it
  fetches the queued rows, the `sdk_inbox_drain` command writes them as chunks,
  and the app acks only the rows that are now on disk. If the ack is lost, the
  rows come back, are found on disk, and are acked again with no second copy.
  Queued artifact rows become `<experiment>/artifacts/<run>/a<row id>.json`.

## The code

| Part | Where | What |
| --- | --- | --- |
| CSV format | `crates/wf-core/src/metric_csv.rs` | `encode`, `decode`, `merge_chunks`, `metric_names`. |
| Chunks on disk | `crates/wf-store/src/files/metrics_csv.rs` | `write_chunk`, `read_metrics`, `experiment_dirs`, `apply_inbox_rows`, `store_metric_points`. |
| Local route | `apps/shell/src/local_http/sdk_files.rs` | The `WF_METRICS_FILES=1` local metrics route. |
| Inbox drain | `apps/shell/src/cmd_experiments.rs` | `sdk_inbox_drain`: writes fetched rows, returns the ids to ack. |

## Laws

- **CSV round trip**: `decode(encode(rows)) == rows`, whatever the names hold
  (`csv_round_trip`, property test in `crates/wf-core/tests/metrics_csv.rs`;
  `metric_name_with_comma_quote`).
- **Merging is idempotent and order-free**: one row per run, step and metric,
  the same result in any chunk order (`merge_is_idempotent_and_order_free`).
- **Written chunks read back** (`metrics_chunks_read_back` in
  `crates/wf-store/tests/metrics_chunks.rs`).
- **A batch fetched twice adds nothing** (`duplicate_batch_dropped`,
  `ack_lost_refetch`, `local_post_sent_twice_is_one_chunk`).
- **A row is acked only once its data is on disk**; a row that cannot be
  stored stays in the inbox (`drain_then_ack_lists_every_stored_row`, and
  `drain_then_ack_names_stored_rows_only` in `apps/shell/src/cmd_experiments.rs`).
- **A bad point writes nothing** (`local_post_with_a_bad_point_writes_nothing`).
- **A batch is stored whole or not at all**: every chunk goes to a temp file
  before any is moved into place, so a failed write in a later run leaves no
  chunk of the batch, and the retry stores all of it
  (`a_later_group_failing_leaves_no_partial_batch`).
- **Size**: 100,000 steps of three metrics (300,000 points in 300 chunks)
  take 14,411,170 bytes of CSV and 1,790,378 bytes of git objects after one
  commit; the test fails above 16 MiB of git objects
  (`repo_growth_100k_steps`).

## Not done yet

- The server inbox has no expiry, so rows queued while a desktop stays off for
  weeks are kept until it comes back.
- A second desktop claiming the same inbox rows is blocked by the claim in
  `db/migrations/0161_files_first_server.sql`; that has no database test here.
