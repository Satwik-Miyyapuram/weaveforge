/**
 * Results-table presence in a report tree (Rust `report::results_tables_presence`), re-exported from
 * index.ts. Keeps the signature of the TS `hasResultsTables` it replaces in
 * apps/web/src/features/overleaf/application/download-overleaf-export.ts.
 */
import { hasResultsTables as rawHasResultsTables } from "../pkg/wf_wasm.js";

/** The part of a report section tree node the presence check reads. */
export interface ResultsTablesTreeNode {
  section: { notes?: string | null };
  children: readonly ResultsTablesTreeNode[];
}

/** Whether any section in the tree, or a descendant, has an `exptable:` reference in its notes. */
export function hasResultsTables(nodes: readonly ResultsTablesTreeNode[]): boolean {
  return rawHasResultsTables(nodes);
}
