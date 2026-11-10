/** Types for citation-text. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PageTextItem } from "../page-text-item.js";

export type PdfItem = PageTextItem & { fontAscent?: number; fontDescent?: number };

export interface SearchText {
  text: string;
  starts: number[];
  ends: number[];
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface CitationTextFns {
  stripInvisible(text: string): string;
  /** "Ball\u00B4e" and "Ball\u00B4 e" become "Ball\u00E9"; an accent before anything but a letter stays. */
  composeSpacingAccents(text: string): string;
  fontSizeOf(item: PdfItem): number;
  searchTextFromItems(items: readonly PdfItem[]): SearchText;
  originalRange(view: SearchText, start: number, end: number): [number, number];
  citationItemToRect(item: PdfItem, from?: number, to?: number): number[] | null;
  mentionRects(items: readonly PdfItem[], start: number, end: number): number[][];
  surnameKey(name: string): string;
  rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean;
}
