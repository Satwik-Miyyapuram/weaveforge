/**
 * Excerpt highlighting (Rust `ai::evidence`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/ai-assistant/domain/ai-evidence.ts.
 */
import { highlightWithinExcerpt as rawHighlightWithinExcerpt } from "../pkg/wf_wasm.js";
import type { AnchorPdfLocus, ExcerptHighlight } from "./bindings.js";

/** The excerpt split around the span the PDF locus resolves to; `null` when nothing matches. */
export function highlightWithinExcerpt(
  excerpt: string,
  locus: AnchorPdfLocus | undefined,
): ExcerptHighlight | null {
  return rawHighlightWithinExcerpt(excerpt, locus) as ExcerptHighlight | null;
}
