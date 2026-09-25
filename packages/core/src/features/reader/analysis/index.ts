/**
 * The document-analysis pass on its own, for the reader's worker.
 *
 * `@weaveforge/core`'s barrel is the whole domain: papers, vault, report,
 * experiments, org, the ink format, the AI assistant. The worker that runs
 * `analyzePdfDocument` needs the analysis and nothing else, and importing the
 * barrel is what pulls the rest of it into the worker's bundle — a second copy
 * of the domain graph in a chunk whose whole job is to read a text layer off
 * the main thread.
 *
 * This is the same reason `./org-crypto` exists: a caller that needs one
 * corner of core should not have to take all of it. Keep this file to the
 * analysis's own closure — lines, columns, running heads, headings, the
 * bibliography, citations, figures, the fingerprint and the types they are
 * expressed in.
 */

export { analyzePdfDocument, outlineItemOf } from "./document-analysis.js";
export type {
  AnalyzePdfPage,
  CitationMention,
  CitationSource,
  DocumentAnalysis,
  PageAnalysis,
  ParsedReference,
  PdfLink,
} from "./analysis-types.js";
export type { FigureMention } from "../find-figure-mentions.js";
export type { OutlineTextItem, ReaderOutlineItem } from "../outline-from-text.js";
export type { PageTextItem } from "../../../reader/selection-to-anchor.js";
