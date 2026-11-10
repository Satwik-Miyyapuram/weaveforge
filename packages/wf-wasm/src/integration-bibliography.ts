/**
 * Zotero pull-merge decision (Rust `integrations::bibliography_annotations`),
 * re-exported from index.ts. The caller keeps the reads, saves and tag reconcile.
 */
import { planBibliographyAnnotations as rawPlanBibliographyAnnotations } from "../pkg/wf_wasm.js";
import type {
  BibliographyPaperInput,
  BibliographyPaperPlan,
  BibliographyPullInput,
  BibliographyTagSource,
} from "./bindings.js";

export type {
  BibliographyPaperInput,
  BibliographyPaperPlan,
  BibliographyPullInput,
  BibliographyTagSource,
} from "./bindings.js";

/** Plan the merge for every paper the pull changes, in input order. */
export function planBibliographyAnnotations(
  papers: readonly BibliographyPaperInput[],
  pull: BibliographyPullInput,
): BibliographyPaperPlan[] {
  return rawPlanBibliographyAnnotations(papers, pull) as BibliographyPaperPlan[];
}
