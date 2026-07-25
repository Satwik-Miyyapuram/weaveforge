export type {
  TextQuoteSelector,
  TextPositionSelector,
  PdfLocus,
} from "./pdf-locus.js";
export {
  normaliseWhitespace,
  findQuoteMatches,
  pickNearestMatch,
  resolvePositionSelector,
  resolveTextAnchor,
  type TextSpan,
  type AnchorConfidence,
  type ResolvedAnchor,
} from "./anchor-resolution.js";
export {
  chooseAnchorStrategy,
  type ZoteroRectPosition,
  type CombinedPdfAnchor,
  type AnchorStrategy,
} from "./anchor-strategy.js";
