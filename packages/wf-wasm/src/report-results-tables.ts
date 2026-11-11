/**
 * Results tables in report notes (Rust `report::results_table_refs`), re-exported from index.ts.
 * Each function keeps the signature of the TS function it replaces in
 * apps/web/src/features/report/application/results-table-refs.ts.
 */
export {
  parseResultsTableRefs,
  resolveResultsTables,
  serialiseResultsTableRef,
} from "../pkg/wf_wasm.js";

/** One `exptable:` reference in report markdown, with UTF-16 start and end offsets. */
export interface ResultsTableRef {
  experimentIds: string[];
  caption: string;
  start: number;
  end: number;
  raw: string;
}

/** The fields of an experiment the tables read; the app's `Experiment` fits it. */
export interface ResultsTableExperiment {
  id: string;
  name: string;
  metrics?: Record<string, unknown> | null;
}
