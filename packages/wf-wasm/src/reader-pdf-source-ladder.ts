/**
 * PDF source ladder order (Rust `reader::pdf_source_ladder`), re-exported from index.ts.
 */
import {
  ladderOrder as rawLadderOrder,
  pdfSourceResolverOrder as rawPdfSourceResolverOrder,
} from "../pkg/wf_wasm.js";
import type { PdfSourceKind } from "./bindings.js";

/**
 * Indices of the resolvers in the order they should be tried: the ones that support the paper
 * first, in their original order.
 */
export function ladderOrder(supports: readonly boolean[]): number[] {
  return rawLadderOrder(supports) as number[];
}

/** Source kinds in the order they are tried: cache (when present), open access, GitHub repo (when present), WebDAV. */
export function pdfSourceResolverOrder(hasCache: boolean, hasGithub: boolean): PdfSourceKind[] {
  return rawPdfSourceResolverOrder(hasCache, hasGithub) as PdfSourceKind[];
}
