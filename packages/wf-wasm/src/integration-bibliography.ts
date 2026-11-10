/**
 * Zotero pull-merge decision (Rust `integrations::bibliography_annotations`),
 * re-exported from index.ts. The caller keeps the reads, saves and tag reconcile.
 */
import type {
  BibliographyPaperInput,
  BibliographyPaperPlan,
  BibliographyPullInput,
  BibliographyTagSource,
} from "./bindings.js";

export {
  planBibliographyAnnotations,
} from "../pkg/wf_wasm.js";

export type {
  BibliographyPaperInput,
  BibliographyPaperPlan,
  BibliographyPullInput,
  BibliographyTagSource,
} from "./bindings.js";

