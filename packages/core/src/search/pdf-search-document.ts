/**
 * PDF page text → search documents.
 *
 * One document per page rather than per PDF: a hit has to say *where* in a
 * ninety-page paper the phrase is, and a whole-document doc can only say
 * "somewhere in here". Per-page also keeps each indexed body small.
 */

import type { DocumentPageText } from "../reader/document-search.js";
import type { SearchDoc } from "./search-port.js";
import { MAX_INDEXED_BODY_CHARS } from "./search-tuning.js";

export interface PdfIndexSource {
  paperId: string;
  /** Paper title, so a page hit is identifiable in a result list. */
  title: string;
  pages: readonly DocumentPageText[];
  /** When the text was extracted; drives the recency tiebreak. */
  extractedAt: string;
}

/** Pages with almost no text are figures or scan artefacts — indexing them adds noise. */
export const MIN_PDF_PAGE_CHARS = 24;

export function pdfDocId(paperId: string, pageIndex: number): string {
  return `pdf:${paperId}#${pageIndex}`;
}

export function pdfPageHref(paperId: string, pageIndex: number): string {
  return `/reader?paper=${encodeURIComponent(paperId)}&page=${pageIndex}`;
}

/**
 * Project extracted page texts into search documents.
 *
 * `degrees` is keyed by the *paper*, not the page: a page inherits the standing
 * of the document it belongs to, since pages have no links of their own.
 */
export function toPdfSearchDocs(
  sources: readonly PdfIndexSource[],
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const source of sources) {
    const degree = degrees.get(`paper:${source.paperId}`) ?? 0;

    for (const page of source.pages) {
      const text = page.text.trim();
      if (text.length < MIN_PDF_PAGE_CHARS) continue;

      docs.push({
        id: pdfDocId(source.paperId, page.pageIndex),
        kind: "pdf",
        // The paper, so kind filters and dedupe against the paper's own
        // document behave sensibly.
        entityId: source.paperId,
        title: source.title,
        // Page number as an alias so "page 12" style queries can land.
        aliases: [`p${page.pageIndex + 1}`],
        headings: [],
        tags: [],
        path: `page ${page.pageIndex + 1}`,
        body: text.length > MAX_INDEXED_BODY_CHARS ? text.slice(0, MAX_INDEXED_BODY_CHARS) : text,
        updatedAt: source.extractedAt,
        href: pdfPageHref(source.paperId, page.pageIndex),
        page: page.pageIndex,
        degree,
      });
    }
  }

  return docs;
}

/** Ids for every page of one paper, so a re-extraction can replace them wholesale. */
export function pdfDocIdsFor(paperId: string, pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, index) => pdfDocId(paperId, index));
}
