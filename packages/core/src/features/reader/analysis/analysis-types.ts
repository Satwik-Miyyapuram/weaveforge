/**
 * The vocabulary of the whole-document analysis the reader runs off the main
 * thread: one pass over a PDF's text layer and `/Link` annotations that
 * yields lines, columns, sections, the bibliography, every citation mention and
 * every figure mention.
 *
 * Pure and framework-free — no pdf.js, no DOM, no Supabase, no React — so the
 * same code runs in the web worker, in-thread on a worker-less environment,
 * and in the desktop shell. Everything in a `DocumentAnalysis` is a plain
 * array or scalar, so the result crosses `postMessage` without losing shape.
 */

import type { PageTextItem } from "../../../reader/selection-to-anchor.js";
import type { FigureMention } from "../find-figure-mentions.js";
import type { ReaderOutlineItem } from "../outline-from-text.js";

export type { PageTextItem };

/**
 * A `/Link` annotation as the reader sees it: the box it covers on the page
 * (PDF user space, `[x1, y1, x2, y2]`) and where it goes — a URL, or a place
 * in this document. LaTeX (hyperref, natbib) writes one of these over every
 * citation, pointing at the entry in the reference list; that is the signal a
 * Scholar-style reader treats as authoritative before any text parsing.
 */
export interface PdfLink {
  rect: [number, number, number, number];
  url?: string;
  /** 1-based page and the point the destination names, if it names one. */
  dest?: { page: number; x?: number; y?: number };
  /**
   * The page-text offsets the link's box covers, measured character by
   * character in the rendered text layer (DOM `Range` rectangles) rather than
   * estimated by dividing a run's width by its length. Absent when the
   * caller could not measure; the estimate is then the fallback.
   */
  textRanges?: { start: number; end: number }[];
  /** The named destination (`cite.kingma2014`), when the link has one. */
  destName?: string;
}

/** One page handed to the analyzer. */
export interface AnalyzePdfPage {
  /** 1-based. */
  pageNumber: number;
  items: readonly PageTextItem[];
  /**
   * The page's own `/Link` annotations. Internal ones name the entry they
   * cite and are the first source of citations; URL ones are the document's
   * to keep, and no mention of ours may sit on one.
   */
  links?: readonly PdfLink[];
}

/** Per-page facts the rest of the app may want, all serializable. */
export interface PageAnalysis {
  pageNumber: number;
  /** The page text, items concatenated with `\n` after each `hasEOL` item. */
  text: string;
  /** Columns detected on the page — 1 for a single-column page. */
  columns: number;
}

/** How a citation mention was found; the match priority, best first. */
export type CitationSource =
  | "internal-pdf-link"
  | "numeric"
  | "superscript"
  | "author-year";

/**
 * One citation as found in the text layer. Offsets follow the page-text
 * convention (`text` is the page's own text), and `rects` map the mention
 * back to PDF user-space rectangles, one per text run it spans.
 */
export interface CitationMention {
  /** Stable across re-renders, unique within the document. */
  id: string;
  page: number;
  start: number;
  end: number;
  /** `page.text.slice(start, end)` — carried so callers need no page text. */
  text: string;
  /** `[x1, y1, x2, y2]` PDF user-space rects; empty until geometry is known. */
  rects: number[][];
  /** Bibliography entries this mention cites, by `ParsedReference.index`. */
  referenceIndexes: number[];
  source: CitationSource;
  /** 1 for a link-named entry, lower for pattern and fuzzy matches. */
  confidence: number;
  target?: PdfLink["dest"];
  destinationName?: string;
  nativeRects?: number[][];
  spanSource?: "text" | "annotation";
}

export interface PageTextRange {
  page: number;
  start: number;
  end: number;
}

/**
 * One bibliography entry. `index` is the entry's number in the list
 * (sequential for unnumbered lists), `label` the way the list prints it
 * (`[12]`, `12.`, `(12)`). `x`/`y` are the left edge and baseline of the
 * entry's first line in PDF user space; `start`/`end` are offsets into that
 * page's text when the entry was found with real geometry.
 */
export interface ParsedReference {
  index: number;
  label?: string;
  raw: string;
  page: number;
  x: number;
  y: number;
  start?: number;
  end?: number;
  authors: string[];
  year?: number;
  yearSuffix?: string;
  title?: string;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
}

/** The full result of one analysis pass. */
export interface DocumentAnalysis {
  pages: PageAnalysis[];
  sections: ReaderOutlineItem[];
  references: ParsedReference[];
  citations: CitationMention[];
  figures: FigureMention[];
  fingerprint: string;
}
