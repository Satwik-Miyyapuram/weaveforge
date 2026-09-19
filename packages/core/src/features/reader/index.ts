export * from "./outline-from-text.js";
export * from "./parse-reference-list.js";
export * from "./find-citation-mentions.js";
export * from "./link-citations.js";
export * from "./find-figure-mentions.js";
export * from "./text-fingerprint.js";
export { titleSimilarity as bibliographicTitleSimilarity, isBibliographicMatch } from "./title-similarity.js";
export * from "./analysis/analysis-types.js";
export { pageTextFromItems, reconstructLines, type TextLine } from "./analysis/line-reconstruction.js";
export { detectColumns, sortByReadingOrder } from "./analysis/column-detection.js";
export { furnitureLines } from "./analysis/running-heads.js";
export {
  findHeadingLines,
  headingOutline,
  outlineIsPlausible,
  type HeadingLine,
} from "./analysis/heading-analysis.js";
export {
  REFERENCES_HEADING,
  findReferenceSection,
  fallbackNumberedRun,
  type ReferenceSectionSpan,
} from "./analysis/reference-section.js";
export {
  LABEL,
  splitBibliographyEntries,
  splitNumberedEntries,
  parseBibliographyEntry,
  parseBibliography,
  extractVenue,
} from "./analysis/bibliography-parser.js";
export {
  mentionRects,
  matchPageCitations,
  looksLikeSuperscriptStyle,
  type PageCitationInput,
} from "./analysis/citation-matcher.js";
export { analyzePageLinks, widenToBrackets, type PageLinkAnalysis } from "./analysis/pdf-link-analysis.js";
export { analyzePdfDocument, outlineItemOf } from "./analysis/document-analysis.js";
