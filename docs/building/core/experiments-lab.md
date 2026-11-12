# Experiments and lab data

These modules hold the pure parts of experiments, metric charts, lab snapshots and data export. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `experiment_rows` | `to_domain`, `to_row` | native only | — |
| `experiment_status` | `status_patch_for_experiment`, `short_sha`, `experiment_activity_at`, `is_stale_running_experiment`, `format_metric_value`, `format_metric_cell`, `metric_keys`, `results_table`, `experiment_href` | `statusPatchForExperiment`, `shortSha`, `experimentActivityAt`, `isStaleRunningExperiment`, `formatMetricValue`, `formatMetricCell`, `metricKeys`, `metricKeysOf`, `resultsTable`, `experimentHref`, `experimentsListHref` | `packages/core/src/features/experiments/domain/parts.ts` |
| `lab_snapshot` | `build_lab_snapshot_content`, `validate_snapshot_title` | `buildLabSnapshotContent` | `apps/web/src/container/facades/org.ts` |
| `lab_snapshot_rows` | `to_domain` | native only | — |
| `metric_chart_data` | `align_series`, `ema_smooth`, `tick_format` | `alignSeries`, `emaSmooth`, `tickFormat` | `apps/web/src/features/experiments/ui/metric-chart-data.ts` |
| `metric_rows` | `to_domain` | native only | — |
| `plot_size` | `plot_tier`, `axis_spec`, `plot_height`, `fit_cols` | `plotTier`, `axisSpec`, `plotHeight`, `fitCols` | `apps/web/src/features/experiments/ui/metric-chart.tsx` |
| `export_files` | `export_manifest_json`, `export_readme`, `export_asset_path` | `exportManifestJson`, `exportReadme`, `exportAssetPath` | `apps/web/src/features/export/application/export-user-data.ts` |

Rules:

- `experiment_rows`: missing config and metrics read as empty objects, missing artifacts as an empty list. Unset optionals are written as `null`.
- `experiment_status`: `finishedAt` is set exactly when the status is terminal. The first start is kept on restart. Running runs silent for 2 minutes (`STALE_RUNNING_MS`) count as dead.
- `experiment_status`: `short_sha` trims, then keeps the first seven UTF-16 units. `format_metric_cell` shows numbers through `format_metric_value`, other values as compact JSON, and `—` when JSON has no form.
- `experiment_status`: `experiment_href` on the offline build opens `?experiment=<id>` on the list, since a static export cannot have a page per run.
- `lab_snapshot`: keeps only the fields a supervisor reads. `validate_snapshot_title` trims the title and rejects blank ones.
- `lab_snapshot_rows`: a row with no content gets empty milestones and logs.
- `metric_rows`: the wall time arrives as an ISO 8601 string. The caller normalises a `Date` first.
- `metric_chart_data`: on a repeated step the later point wins. Gaps stay `None`. An `alpha` at or below zero returns the values unchanged.
- `metric_chart_data`: `tick_format` picks fixed decimals, or exponent style when the values are too large or too small. Tick text is rendered in TS.
- `plot_size`: a width of 0 or less counts as full tier. Below 560 px is medium (no titles). Below 360 px is compact.
- `plot_size`: `fit_cols` never returns less than 1. `plot_height` returns `base` for a width of 0 or less.
- `export_files`: the export is always plaintext. `export_asset_path` uses `unknown` as the id when the path has no second segment.
