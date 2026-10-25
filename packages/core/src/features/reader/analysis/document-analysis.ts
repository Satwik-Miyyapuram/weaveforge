/**
 * The full analysis pass: one call over a PDF's text layer and links that
 * yields lines, columns, sections, the bibliography, every citation and
 * every figure mention, and a fingerprint of the text.
 *
 * The stages run in the order the signals depend on each other: normalize
 * items into lines, detect columns and reading order, remove running heads
 * and page furniture, detect headings, score the bibliography section,
 * split and parse its entries, then match citations — internal destinations
 * first, patterns after — and map every mention back to PDF rectangles.
 */

import { bodyFontSize, isRotatedText, type OutlineTextItem, type ReaderOutlineItem } from "../outline-from-text.js";
import { findFigureMentions } from "../find-figure-mentions.js";
import { textFingerprint } from "../text-fingerprint.js";
import {
  furnitureLines,
} from "./running-heads.js";
import { detectColumns, sortByReadingOrder } from "./column-detection.js";
import { findHeadingLines, headingOutline, outlineIsPlausible } from "./heading-analysis.js";
import { findReferenceSection } from "./reference-section.js";
import { parseBibliography } from "./bibliography-parser.js";
import { matchPageCitations } from "./citation-matcher.js";
import { pageTextFromItems, reconstructLines, type TextLine } from "./line-reconstruction.js";
import type {
  AnalyzePdfPage,
  CitationMention,
  DocumentAnalysis,
  PageAnalysis,
  PageTextRange,
  ParsedReference,
} from "./analysis-types.js";

/** The span of the page text each page's bibliography lines cover. */
function rangesOf(lines: readonly TextLine[]): PageTextRange[] {
  const ranges = new Map<number, PageTextRange>();
  for (const line of lines) {
    const old = ranges.get(line.page);
    ranges.set(line.page, {
      page: line.page,
      start: Math.min(old?.start ?? Infinity, line.start),
      end: Math.max(old?.end ?? 0, line.end),
    });
  }
  return [...ranges.values()];
}

/** pdf.js transform → the outline parsers' item, font size from the matrix. */
export function outlineItemOf(item: AnalyzePdfPage["items"][number], page: number): OutlineTextItem {
  return {
    str: item.str,
    fontSize: Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
    ...(item.fontName ? { fontName: item.fontName } : {}),
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
    page,
    ...(isRotatedText(item.transform) ? { rotated: true } : {}),
  };
}

const EMPTY: DocumentAnalysis = {
  pages: [],
  sections: [],
  references: [],
  citations: [],
  figures: [],
  fingerprint: textFingerprint([]),
};

/**
 * Analyze a document's pages. `outline` is the PDF's own bookmarks when it
 * has them; without any, sections are inferred from the heading analysis.
 * The result is plain data only — arrays and scalars — so it crosses
 * `postMessage` as-is.
 */
export function analyzePdfDocument(
  pages: readonly AnalyzePdfPage[],
  outline: readonly ReaderOutlineItem[] = [],
): DocumentAnalysis {
  if (!pages.length) return EMPTY;

  const texts = pages.map((page) => pageTextFromItems(page.items));
  const outlinePages = pages.map((page) => page.items.map((item) => outlineItemOf(item, page.pageNumber)));
  const body = bodyFontSize(outlinePages);

  // Lines per page, tagged with their column, then in reading order.
  const tagged: { line: TextLine; column: number }[] = [];
  const columnsByPage = new Map<number, number>();
  for (const page of pages) {
    // Rotated runs (arXiv's side stamp) are never body or headings.
    // Kept out by predicate, not filtered, so line offsets still index `texts`.
    const lines = reconstructLines(page.pageNumber, page.items, (item) => !isRotatedText(item.transform));
    const columns = detectColumns(lines);
    columnsByPage.set(page.pageNumber, Math.max(1, ...columns.map((c) => c + 1)));
    lines.forEach((line, j) => tagged.push({ line, column: columns[j] ?? 0 }));
  }
  const ordered = sortByReadingOrder(tagged);
  const furniture = furnitureLines(ordered);
  const headings = findHeadingLines(ordered, body, furniture);

  const sections: ReaderOutlineItem[] = outline.length
    ? [...outline]
    : outlineIsPlausible(headings, pages.length)
      ? headingOutline(headings)
      : [];

  const span = findReferenceSection(ordered, {
    bodyFontSize: body,
    pageCount: pages.length,
    furniture,
  });
  const referenceLines = span ? ordered.slice(span.start, span.end) : [];
  const references: ParsedReference[] = parseBibliography(referenceLines);
  const referenceRanges = rangesOf(referenceLines);

  const citations: CitationMention[] = [];
  const pageAnalyses: PageAnalysis[] = [];
  for (const [i, page] of pages.entries()) {
    citations.push(
      ...matchPageCitations(
        {
          number: page.pageNumber,
          text: texts[i]!,
          items: page.items,
          outlineItems: outlinePages[i]!,
          links: page.links ?? [],
        },
        references,
        referenceRanges,
      ),
    );
    pageAnalyses.push({
      pageNumber: page.pageNumber,
      text: texts[i]!,
      columns: columnsByPage.get(page.pageNumber) ?? 1,
    });
  }

  // One document-wide call: a figure's caption is usually on a different
  // page from the mention, so this cannot be decided a page at a time.
  const figures = findFigureMentions(
    pages.map((page, i) => ({ number: page.pageNumber, text: texts[i]!, items: outlinePages[i]! })),
    sections,
  );

  return {
    pages: pageAnalyses,
    sections,
    references,
    citations,
    figures,
    fingerprint: textFingerprint(texts),
  };
}
