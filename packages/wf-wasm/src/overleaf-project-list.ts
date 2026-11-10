/**
 * The Overleaf project list rules (Rust `overleaf::project_list`), re-exported from index.ts.
 */
import {
  mergeOverleafProjects as rawMergeOverleafProjects,
  overleafProjectMatches as rawOverleafProjectMatches,
  overleafProjectShown as rawOverleafProjectShown,
} from "../pkg/wf_wasm.js";

/** One merged row. `linkedIndex` is the position in the linked list, or null when none links it. */
export interface MergedOverleafProject {
  id: string;
  name: string;
  inAccount: boolean;
  linkedIndex: number | null;
}

/** Account projects and linked reports as one list, matched on the Overleaf id (not sorted). */
export function mergeOverleafProjects(
  account: readonly { id: string; name: string }[],
  linked: readonly { overleaf_project_id: string; title: string }[],
): MergedOverleafProject[] {
  return rawMergeOverleafProjects(account, linked);
}

/** Whether a row's name or linked title matches the search text (case-insensitive, trimmed). */
export function overleafProjectMatches(name: string, linkedTitle: string | null, query: string): boolean {
  return rawOverleafProjectMatches(name, linkedTitle ?? undefined, query);
}

/** Whether a row is shown: linked rows always, others only when their id is in `picked`. */
export function overleafProjectShown(hasLink: boolean, id: string, picked: readonly string[]): boolean {
  return rawOverleafProjectShown(hasLink, id, picked);
}
