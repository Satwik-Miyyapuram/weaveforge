/**
 * Experiment row mapping (Rust `experiment_rows`). The row shape stays in the web app, next to
 * the queries that select it.
 */
import {
  experimentRowToDomain as rawExperimentRowToDomain,
  experimentToRow as rawExperimentToRow,
} from "../pkg/wf_wasm.js";
import type { Experiment, ExperimentRow, ExperimentWriteRow } from "./bindings.js";

export type { Experiment, ExperimentRow, ExperimentWriteRow } from "./bindings.js";

/** An `experiments` row as an experiment (empty config, metrics and artifacts when missing). */
export function experimentRowToDomain(row: ExperimentRow): Experiment {
  return rawExperimentRowToDomain(row) as Experiment;
}

/** An experiment as the `experiments` row it is written as; unset optionals are `null`. */
export function experimentToRow(experiment: Experiment): ExperimentWriteRow {
  return rawExperimentToRow(experiment) as ExperimentWriteRow;
}
