/**
 * The full PDF analysis pass (Rust `reader_analysis::document_analysis`), re-exported from index.ts.
 * Keeps the signature and default of packages/core/src/features/reader/analysis/document-analysis.ts.
 * Object shapes come from ./bindings.ts.
 */
import { analyzePdfDocument as rawAnalyzePdfDocument } from "../pkg/wf_wasm.js";
import type { AnalysisPdfPage, DocumentAnalysis, OutlineReaderItem } from "./bindings.js";

/**
 * Lines, columns, sections, bibliography, citations, figure mentions and a fingerprint for the
 * pages. `outline` is the PDF's own bookmarks; empty means sections come from the headings.
 */
export function analyzePdfDocument(
  pages: readonly AnalysisPdfPage[],
  outline: readonly OutlineReaderItem[] = [],
): DocumentAnalysis {
  return rawAnalyzePdfDocument(pages, outline) as DocumentAnalysis;
}
