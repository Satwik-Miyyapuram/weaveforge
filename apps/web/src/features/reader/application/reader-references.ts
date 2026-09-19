/**
 * The reader's join between core's document analysis and the overlay.
 *
 * All parsing rules live in `@weaveforge/core` (`analyzePdfDocument`): lines,
 * columns, running heads, headings, the bibliography, citations and figures.
 * This module only shapes the result into the flat hit list the overlay
 * paints and the sidebar lists — one document-wide pass, so the two can
 * never disagree about what is on a page.
 */

import {
  analyzePdfDocument,
  outlineItemOf,
  bodyFontSize,
  type CitationSource,
  type DocumentAnalysis,
  type OutlineTextItem,
  type PageTextItem,
  type ParsedReference,
  type PdfLink,
  type ReaderOutlineItem,
} from "@weaveforge/core";
import { pageTextFromItems } from "./reference-locate";

/** A clickable thing found in the page text. */
export interface MentionHit {
  /** Stable across re-renders, and unique within the document. */
  key: string;
  kind: "citation" | "figure";
  /** Offsets into the page text, as the finders report them. */
  start: number;
  end: number;
  /** Text used for the tooltip and the accessible name. */
  label: string;
  /** Reference-list indexes this mention points at, for citations. */
  refIndexes: number[];
  /** Where a figure/table/equation mention jumps to, for figures. */
  target?: import("@weaveforge/core").FigureTarget;
  /** How this citation was found, and how much to trust it. */
  source?: CitationSource;
  confidence?: number;
}

export interface ReaderReferenceIndex {
  /** The reference list, when the document has a parseable one. */
  references: ParsedReference[];
  /** Entry lookup for a mention's `refIndexes`. */
  byIndex: Map<number, ParsedReference>;
  /** 1-based page → its mentions, in reading order. */
  mentionsByPage: Map<number, MentionHit[]>;
  /** Body font size, for callers that reason about superscripts. */
  bodyFontSize: number;
  /**
   * Key for the document's text layer, so lookups cached for one copy of a
   * paper serve every other copy with the same text.
   */
  fingerprint: string;
}

export interface ReferencePage {
  /** 1-based. */
  pageNumber: number;
  items: readonly PageTextItem[];
  /**
   * The page's own `/Link` annotations. Internal ones name the entry they
   * cite and are the first source of mentions; URL ones are the document's
   * to handle, and no mention of ours may sit on one.
   */
  links?: readonly PdfLink[];
}

const EMPTY_INDEX: ReaderReferenceIndex = {
  references: [],
  byIndex: new Map(),
  mentionsByPage: new Map(),
  bodyFontSize: 0,
  fingerprint: "",
};

/** The pages' runs as outline items — what the core analysis reasons with. */
export function outlineItemsFor(pages: readonly ReferencePage[]): OutlineTextItem[][] {
  return pages.map((page) => page.items.map((item) => outlineItemOf(item, page.pageNumber)));
}

/**
 * The mention as it is printed, collapsed to one line and clipped, so a mention
 * spanning a line break still reads as one phrase in a tooltip.
 */
function mentionLabel(text: string, start: number, end: number): string {
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

/**
 * Shape a completed analysis into the overlay's index. Pure and synchronous,
 * so the worker path (which returns the analysis as plain arrays) and the
 * in-thread path share it.
 */
export function indexFromAnalysis(
  analysis: DocumentAnalysis,
  pages: readonly ReferencePage[],
): ReaderReferenceIndex {
  const byIndex = new Map(analysis.references.map((ref) => [ref.index, ref]));
  const texts = new Map(pages.map((page) => [page.pageNumber, pageTextFromItems(page.items)]));

  const mentionsByPage = new Map<number, MentionHit[]>();
  const hitsFor = (page: number) => {
    let list = mentionsByPage.get(page);
    if (!list) {
      list = [];
      mentionsByPage.set(page, list);
    }
    return list;
  };

  for (const citation of analysis.citations) {
    const text = texts.get(citation.page) ?? "";
    // The list's own labels (`[12]`, `12.`) are how the bibliography prints
    // them; an author-year list has none, and there the printed mention is
    // the only honest label.
    const labels = citation.referenceIndexes
      .map((index) => byIndex.get(index)?.label)
      .filter((label): label is string => Boolean(label));
    hitsFor(citation.page).push({
      key: citation.id,
      kind: "citation",
      start: citation.start,
      end: citation.end,
      label: labels.join(", ") || mentionLabel(text, citation.start, citation.end),
      refIndexes: citation.referenceIndexes,
      source: citation.source,
      confidence: citation.confidence,
    });
  }

  for (const figure of analysis.figures) {
    const text = texts.get(figure.page) ?? "";
    const hits = hitsFor(figure.page);
    // A citation and a figure mention can overlap in a caption; the citation
    // wins, since it is the one with a record to show.
    if (hits.some((hit) => hit.start < figure.end && hit.end > figure.start)) continue;
    hits.push({
      key: `f:${figure.page}:${figure.start}-${figure.end}`,
      kind: "figure",
      start: figure.start,
      end: figure.end,
      label: mentionLabel(text, figure.start, figure.end),
      refIndexes: [],
      target: figure.target,
    });
  }

  for (const hits of mentionsByPage.values()) hits.sort((a, b) => a.start - b.start);

  return {
    references: analysis.references,
    byIndex,
    mentionsByPage,
    bodyFontSize: bodyFontSize(outlineItemsFor(pages)),
    fingerprint: analysis.fingerprint,
  };
}

/**
 * Analyze the pages and shape the result in one step — the in-thread path,
 * and what the worker mirrors by calling `analyzePdfDocument` itself.
 */
export function buildReferenceIndex(
  pages: readonly ReferencePage[],
  outline: readonly ReaderOutlineItem[] = [],
): ReaderReferenceIndex {
  if (!pages.length) return EMPTY_INDEX;
  const analysis = analyzePdfDocument(
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      items: page.items,
      links: page.links ?? [],
    })),
    outline,
  );
  return indexFromAnalysis(analysis, pages);
}
