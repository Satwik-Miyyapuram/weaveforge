export type { OutlineTextItem, ReaderOutlineItem } from "./outline-types.js";
export * from "./link-citations.js";
export * from "./text-fingerprint.js";

export * from "./analysis/analysis-types.js";
export { pageTextFromItems, reconstructLines, type TextLine } from "./analysis/line-reconstruction.js";

// One rect maths for every mention: the one analysis itself uses.

export { type CitationCandidate as CitationTextCandidate } from "./analysis/citations.js";

