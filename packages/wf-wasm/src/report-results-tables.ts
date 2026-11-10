/**
 * Results tables in report notes (Rust `report::results_table_refs`), re-exported from index.ts.
 * Each function keeps the signature of the TS function it replaces in
 * apps/web/src/features/report/application/results-table-refs.ts.
 */
import {
  parseResultsTableRefs as rawParseResultsTableRefs,
  resolveResultsTables as rawResolveResultsTables,
  serialiseResultsTableRef as rawSerialiseResultsTableRef,
} from "../pkg/wf_wasm.js";

/** One `exptable:` reference in report markdown, with UTF-16 start and end offsets. */
export interface ResultsTableRef {
  experimentIds: string[];
  caption: string;
  start: number;
  end: number;
  raw: string;
}

/** The canonical `![caption](exptable:…)` for the runs, shown as `Results` when no caption is given. */
export function serialiseResultsTableRef(experimentIds: readonly string[], caption = "Results"): string {
  return rawSerialiseResultsTableRef([...experimentIds], caption);
}

/** Every `exptable:` reference in the markdown, with UTF-16 start and end offsets. */
export function parseResultsTableRefs(markdown: string): ResultsTableRef[] {
  return rawParseResultsTableRefs(markdown) as ResultsTableRef[];
}

/**
 * Replaces each reference with its table, rebuilt from the runs' current metrics. `latex` picks the
 * LaTeX figure block over the Markdown table. Unknown runs get a warning line.
 */
/** The fields of an experiment the tables read; the app's `Experiment` fits it. */
export interface ResultsTableExperiment {
  id: string;
  name: string;
  metrics?: Record<string, unknown> | null;
}

export function resolveResultsTables(
  body: string,
  experiments: readonly ResultsTableExperiment[],
  format: "markdown" | "latex",
): string {
  return rawResolveResultsTables(body, experiments, format);
}
