/**
 * Types for the reader's document analysis. The analysis itself runs in the
 * Rust core (`analyzePdfDocument` on the wasm module), so this barrel holds
 * only types and can be imported by the worker without pulling in core values.
 */

export type {
  AnalyzePdfPage,
  CitationMention,
  CitationSource,
  DocumentAnalysis,
  PageAnalysis,
  ParsedReference,
  PdfLink,
} from "./analysis-types.js";
export type { FigureMention, FigureTarget } from "./analysis-types.js";
export type { OutlineTextItem, ReaderOutlineItem } from "../outline-types.js";
export type { PageTextItem } from "../../../reader/selection-to-anchor.js";
