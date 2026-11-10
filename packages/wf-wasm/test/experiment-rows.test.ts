import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { experimentRowToDomain, experimentToRow } from "../src/experiment-rows.js";
import type { Experiment, ExperimentRow } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

/** The domain Experiment the Rust mapper returns; the generated binding type is a status subset. */
type DomainExperiment = {
  hypothesis?: string | null;
  config: Record<string, unknown>;
  metrics: Record<string, unknown>;
  artifacts: string[];
};

const row = {
  id: "e1",
  name: "Baseline",
  hypothesis: null,
  status: "running",
  repo_url: null,
  commit_sha: null,
  branch: null,
  run_command: null,
  config: null,
  metrics: null,
  artifacts: null,
  result_note: null,
  started_at: null,
  finished_at: null,
  related_paper: null,
  created_at: "2026-03-01T00:00:00Z",
} as unknown as ExperimentRow;

test("missing config, metrics and artifacts default to empty", () => {
  const experiment = experimentRowToDomain(row) as unknown as DomainExperiment;
  assert.deepEqual(experiment.config, {});
  assert.deepEqual(experiment.metrics, {});
  assert.deepEqual(experiment.artifacts, []);
  assert.equal(experiment.hypothesis, undefined);
});

test("present config, metrics and artifacts are kept", () => {
  const experiment = experimentRowToDomain({
    ...row,
    config: { lr: 0.1 },
    metrics: { loss: 0.2 },
    artifacts: ["runs/plot.svg"],
  } as unknown as ExperimentRow) as unknown as DomainExperiment;
  assert.deepEqual(experiment.config, { lr: 0.1 });
  assert.deepEqual(experiment.metrics, { loss: 0.2 });
  assert.deepEqual(experiment.artifacts, ["runs/plot.svg"]);
});

test("unset optionals write as null and the row keeps its id and name", () => {
  const write = experimentToRow(experimentRowToDomain(row) as Experiment);
  assert.equal(write.hypothesis, null);
  assert.equal(write.started_at, null);
  assert.equal(write.name, "Baseline");
  assert.equal(write.created_at, "2026-03-01T00:00:00Z");
});
