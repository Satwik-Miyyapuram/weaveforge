/** Types for citations. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { CitationMention, PageTextRange, ParsedReference } from "./analysis-types.js";
import type { PdfItem } from "./citation-text.js";

export interface CitationCandidate {
  start: number;
  end: number;
  text: string;
  source: "numeric" | "author-year";
  authors?: string;
  year?: string;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface CitationsFns {
  matchAuthorYearText(text: string, refs: readonly ParsedReference[]): number[];
  inReferenceList(page: number, start: number, end: number, ranges: readonly PageTextRange[]): boolean;
  findCitationCandidates(items: readonly PdfItem[]): CitationCandidate[];
  findPatternCitationMentions(page: { number: number; text: string; items: readonly PdfItem[] }, refs: readonly ParsedReference[], excluded?: readonly PageTextRange[], candidates?: readonly CitationCandidate[]): CitationMention[];
}
