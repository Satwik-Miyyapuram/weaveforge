/**
 * One pass over the document's text that yields every clickable mention.
 *
 * Citations and figures are found by core's parsers, which know nothing about
 * this app: they take plain page data and return character ranges. This module
 * is the join — it owns the offset space, runs the parsers, and shapes the
 * result into the flat hit list the overlay paints.
 *
 * The page text is derived here from the same runs the geometry is measured
 * against (`pageTextFromItems`), rather than being passed in alongside them. Any
 * other arrangement lets a caller hand over text and runs that do not agree,
 * which shifts every mention after the first line break onto the wrong run —
 * silently, and only for documents that use `hasEOL`.
 *
 * The same list feeds the sidebar, so the two can never disagree about what is
 * on a page.
 */

import {
  bodyFontSize,
  detectCitationStyle,
  findCitationMentions,
  findFigureMentions,
  parseReferenceList,
  type OutlineTextItem,
  type PageTextItem,
  type ParsedReference,
  type ReaderOutlineItem,
  textFingerprint,
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
  target?: { page: number; y: number };
}

export interface ReaderReferenceIndex {
  /** The reference list, when the document has a parseable one. */
  references: ParsedReference[];
  /** Entry lookup for a mention's `refIndexes`. */
  byIndex: Map<number, ParsedReference>;
  /** 1-based page → its mentions, in reading order. */
  mentionsByPage: Map<number, MentionHit[]>;
  /** Body font size used for superscript detection, for callers that need it. */
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
}

const EMPTY_INDEX: ReaderReferenceIndex = {
  references: [],
  byIndex: new Map(),
  mentionsByPage: new Map(),
  bodyFontSize: 0,
  fingerprint: "",
};

/**
 * pdf.js text items need `fontSize`, `x` and `y` lifted out of the transform
 * matrix before the parsers can reason about headings and superscripts. The
 * matrix's first column is the glyph scale, so its length is the font size.
 */
function outlineItem(item: PageTextItem, page: number): OutlineTextItem {
  return {
    str: item.str,
    fontSize: Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
    page,
  };
}

/**
 * The mention as it is printed, collapsed to one line and clipped, so a mention
 * spanning a line break still reads as one phrase in a tooltip.
 */
function mentionLabel(text: string, start: number, end: number): string {
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

export function buildReferenceIndex(
  pages: readonly ReferencePage[],
  outline: readonly ReaderOutlineItem[] = [],
): ReaderReferenceIndex {
  if (!pages.length) return EMPTY_INDEX;

  const outlineTexts = pages.map((page) =>
    page.items.map((item) => outlineItem(item, page.pageNumber)),
  );
  const body = bodyFontSize(outlineTexts);
  const references = parseReferenceList(outlineTexts);
  const byIndex = new Map(references.map((ref) => [ref.index, ref]));
  const outlinePages = pages.map((page, i) => ({
    number: page.pageNumber,
    text: pageTextFromItems(page.items),
    items: outlineTexts[i]!,
  }));

  // One document-wide call: a figure's caption is usually on a different page
  // from the mention, so this cannot be decided a page at a time.
  // Decided over the whole body once, so a stray "(Smith 2019)" in a numeric
  // paper — or a "[3]" in an author-year one — is not painted as a citation.
  const style = detectCitationStyle(outlinePages.map((page) => page.text));
  const figuresByPage = new Map<number, ReturnType<typeof findFigureMentions>>();
  for (const mention of findFigureMentions(outlinePages, outline)) {
    const list = figuresByPage.get(mention.page);
    if (list) list.push(mention);
    else figuresByPage.set(mention.page, [mention]);
  }

  const mentionsByPage = new Map<number, MentionHit[]>();
  for (const page of outlinePages) {
    const hits: MentionHit[] = [];

    for (const mention of findCitationMentions(page, references, body, style)) {
      // The list's own labels (`[12]`, `12.`) are how the bibliography prints
      // them; an author-year list has none, and there the printed mention is
      // the only honest label.
      const labels = mention.refIndexes
        .map((index) => byIndex.get(index)?.label)
        .filter((label): label is string => Boolean(label));
      hits.push({
        key: `c:${page.number}:${mention.start}-${mention.end}`,
        kind: "citation",
        start: mention.start,
        end: mention.end,
        label: labels.join(", ") || mentionLabel(page.text, mention.start, mention.end),
        refIndexes: mention.refIndexes,
      });
    }

    for (const mention of figuresByPage.get(page.number) ?? []) {
      // A citation and a figure mention can overlap in a caption; the citation
      // wins, since it is the one with a record to show.
      if (hits.some((hit) => hit.start < mention.end && hit.end > mention.start)) continue;
      hits.push({
        key: `f:${page.number}:${mention.start}-${mention.end}`,
        kind: "figure",
        start: mention.start,
        end: mention.end,
        label: mentionLabel(page.text, mention.start, mention.end),
        refIndexes: [],
        target: mention.target,
      });
    }

    if (hits.length) mentionsByPage.set(page.number, hits.sort((a, b) => a.start - b.start));
  }

  return {
    references,
    byIndex,
    mentionsByPage,
    bodyFontSize: body,
    fingerprint: textFingerprint(outlinePages.map((page) => page.text)),
  };
}
