export type { OutlineTextItem, ReaderOutlineItem } from "./parts.js";

export * from "./analysis/analysis-types.js";
export { type TextLine } from "./analysis/line-reconstruction.js";

// One rect maths for every mention: the one analysis itself uses.

export { type CitationCandidate as CitationTextCandidate } from "../../shared/core-contract.js";

