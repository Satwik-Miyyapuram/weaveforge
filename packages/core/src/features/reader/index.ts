export type { OutlineTextItem, ReaderOutlineItem } from "./outline-types.js";
export * from "./link-citations.js";
export * from "./text-fingerprint.js";
export { titleSimilarity as bibliographicTitleSimilarity, isBibliographicMatch } from "./title-similarity.js";
export * from "./analysis/analysis-types.js";
export { pageTextFromItems, reconstructLines, type TextLine } from "./analysis/line-reconstruction.js";
export { detectColumns, sortByReadingOrder } from "./analysis/column-detection.js";
// One rect maths for every mention: the one analysis itself uses.
export { mentionRects } from "./analysis/citation-text.js";
export {
  findCitationCandidates,
  findPatternCitationMentions,
  matchAuthorYearText,
  inReferenceList,
  type CitationCandidate as CitationTextCandidate,
} from "./analysis/citations.js";
export { composeSpacingAccents, searchTextFromItems, originalRange, stripInvisible, surnameKey } from "./analysis/citation-text.js";
