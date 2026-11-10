/**
 * Primary external id of a stored paper (Rust `papers::paper_ref::primary_paper_ref`), re-exported
 * from index.ts. Keeps the `paperRef` result of
 * packages/core/src/features/relations/application/paper-ref.ts.
 */
import { primaryPaperRef as rawPrimaryPaperRef } from "../pkg/wf_wasm.js";
import type { PaperRef } from "./bindings.js";

/** The arXiv id, else the DOI, else null. A blank value counts as unset. */
export function primaryPaperRef(
  arxivId: string | null | undefined,
  doi: string | null | undefined,
): PaperRef | null {
  return (rawPrimaryPaperRef(arxivId ?? undefined, doi ?? undefined) ?? null) as PaperRef | null;
}
