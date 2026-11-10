/**
 * Experiment row mapping (Rust `experiment_rows`). The row shape stays in the web app, next to
 * the queries that select it.
 */
import type {
  Experiment,
  ExperimentRow,
  ExperimentWriteRow,
} from "./bindings.js";

export {
  experimentRowToDomain,
  experimentToRow,
} from "../pkg/wf_wasm.js";

export type { Experiment, ExperimentRow, ExperimentWriteRow } from "./bindings.js";

