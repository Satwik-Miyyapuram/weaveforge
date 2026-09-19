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
  mentionRects,
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
  /**
   * `[x1, y1, x2, y2]` PDF user-space rects the analyzer resolved for this
   * mention, one per text run it covers.
   *
   * These are the analysis's own geometry — the rects a hyperref `/Dest`
   * link's annotation carried, or the rects the text-span matcher built from
   * the runs it crossed. Carrying them here means the overlay paints what the
   * analysis found instead of re-deriving a position from character offsets,
   * which is what dropped mentions whose offsets landed on a zero-width run.
   * Empty only when nothing could be resolved; the overlay then falls back.
   */
  rects?: number[][];
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

type Citation = DocumentAnalysis["citations"][number];

/**
 * `[2, 3, 4]` is one printed span but three papers. When every entry the
 * cluster cites is printed as its own number, the mention is cut into one
 * hit per number, so the reader hovers and opens each paper on its own. A
 * range (`[2–4]`) prints only its ends and stays one mention, listing all
 * three in its popover.
 */
function splitNumericCluster(
  citation: Citation,
  text: string,
  items: readonly PageTextItem[],
): Pick<Citation, "id" | "start" | "end" | "referenceIndexes" | "rects">[] {
  const indexes = citation.referenceIndexes;
  if (indexes.length < 2) return [citation];
  const span = text.slice(citation.start, citation.end);
  if (/\d\s*[-–—]\s*\d/.test(span)) return [citation];
  const parts: Pick<Citation, "id" | "start" | "end" | "referenceIndexes" | "rects">[] = [];
  const numbers = [...span.matchAll(/\d+/g)];
  for (const index of indexes) {
    const match = numbers.find((candidate) => Number(candidate[0]) === index);
    if (!match) return [citation];
    const start = citation.start + match.index;
    const end = start + match[0].length;
    parts.push({
      id: `${citation.id}:${index}`,
      start,
      end,
      referenceIndexes: [index],
      rects: mentionRects(items, start, end),
    });
  }
  return parts;
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
    const page = pages.find((candidate) => candidate.pageNumber === citation.page);
    for (const part of splitNumericCluster(citation, text, page?.items ?? [])) {
      // The list's own labels (`[12]`, `12.`) are how the bibliography prints
      // them; an author-year list has none, and there the printed mention is
      // the only honest label.
      const labels = part.referenceIndexes
        .map((index) => byIndex.get(index)?.label)
        .filter((label): label is string => Boolean(label));
      hitsFor(citation.page).push({
        key: part.id,
        kind: "citation",
        start: part.start,
        end: part.end,
        label: labels.join(", ") || mentionLabel(text, part.start, part.end),
        refIndexes: part.referenceIndexes,
        ...(part.rects?.length ? { rects: part.rects } : {}),
        source: citation.source,
        confidence: citation.confidence,
      });
    }
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
