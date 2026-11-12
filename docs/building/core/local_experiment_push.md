# local_experiment_push

Rust home: `crates/wf-core/src/sync/local_experiment_push.rs`. wasm: `crates/wf-wasm/src/sync_local_experiment_push.rs`.
TS caller: `apps/web/src/backend/providers/local/parts-1.ts` (`LocalExperimentPush`).

## What moved

- Push SQL by name (`localExperimentPushSql`, a `Result` for an unknown name).
- Metric cursor default: `pushed ?? -2147483648` (`localExperimentPushedCursor`).
- Artifact rewrite: `app://artifacts/{experimentId}/{uuid}/{name}` to the REST path (`localExperimentArtifactRest`),
  the storage file name, and the storage path `{accountId}/{name}` (`localExperimentArtifactStorageName`,
  `localExperimentArtifactStoragePath`).
- Recompress decision and webp preference: png/jpg/jpeg become `.webp` when smaller (`localExperimentShouldRecompress`,
  `localExperimentPreferWebp`).
- Batch size (`BATCH`, `localExperimentBatch`): the Rust SQL `limit` and the TS loop-end check read the same constant.
- Artifact bucket (`ARTIFACT_BUCKET`, `localExperimentArtifactBucket`).
- LIKE pattern for rows already holding this account's paths (`%"{accountId}/%`,
  `localExperimentAccountArtifactsPattern`, used by `repairServerArtifacts`).

## What stays in TS

- Canvas and `Blob` work, `fetch`, timers, the server wrapper, the PGlite queries and the loop structure.

## Known divergence and GAPs

- None in the decisions. The loops still run in TS; `pushMetrics` ends a series on the Rust `BATCH`.

## Tests

3 `it:` cases moved to `#[test]` in `local_experiment_push.rs`.
