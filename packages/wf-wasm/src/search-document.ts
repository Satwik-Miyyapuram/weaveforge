/**
 * Search-document projections (Rust `search::search_document`), re-exported from
 * index.ts. Keeps the shape of packages/core/src/search/search-document.ts,
 * pdf-search-document.ts and annotation-search-document.ts; the rules live in Rust.
 * Degree and title maps cross the boundary as plain objects.
 */
import {
  annotationDocId as rawAnnotationDocId,
  boundedBody as rawBoundedBody,
  extractHeadings as rawExtractHeadings,
  pdfDocId as rawPdfDocId,
  pdfDocIdsFor as rawPdfDocIdsFor,
  pdfPageHref as rawPdfPageHref,
  searchRevision as rawSearchRevision,
  toAnnotationSearchDocs as rawToAnnotationSearchDocs,
  toPdfSearchDocs as rawToPdfSearchDocs,
  toSearchDocs as rawToSearchDocs,
} from "../pkg/wf_wasm.js";
import type { AnnotationSource, PdfIndexSource, SearchDoc } from "./bindings.js";

function toObject(map: ReadonlyMap<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(map);
}

/** Project a workspace snapshot into search documents. */
export function toSearchDocs(
  snapshot: object,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToSearchDocs(snapshot, toObject(degrees)) as SearchDoc[];
}

/** Fingerprint of the indexed corpus; a differing revision means the index is stale. */
export function searchRevision(docs: readonly SearchDoc[]): string {
  return rawSearchRevision(docs);
}

/** Markdown h1–h3 headings, ignoring anything inside code. */
export function extractHeadings(body?: string): string[] {
  return rawExtractHeadings(body);
}

/** Truncate to the indexed body cap without splitting a surrogate pair. */
export function boundedBody(body: string | undefined): string {
  return rawBoundedBody(body ?? "");
}

/** Project extracted PDF page texts into one search document per page. */
export function toPdfSearchDocs(
  sources: readonly PdfIndexSource[],
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToPdfSearchDocs(sources, toObject(degrees)) as SearchDoc[];
}

/** Stable id for one PDF page's document. */
export function pdfDocId(paperId: string, pageIndex: number): string {
  return rawPdfDocId(paperId, pageIndex);
}

/** Deep link to one PDF page in the reader. */
export function pdfPageHref(paperId: string, pageIndex: number): string {
  return rawPdfPageHref(paperId, pageIndex);
}

/** Ids for every page of one paper, so a re-extraction can replace them wholesale. */
export function pdfDocIdsFor(paperId: string, pageCount: number): string[] {
  return rawPdfDocIdsFor(paperId, pageCount);
}

/** Stable id for a highlight's document. */
export function annotationDocId(annotationId: string): string {
  return rawAnnotationDocId(annotationId);
}

/** Project reader annotations into search documents; titles are the paper's. */
export function toAnnotationSearchDocs(
  annotations: readonly AnnotationSource[],
  paperTitles: ReadonlyMap<string, string>,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToAnnotationSearchDocs(
    annotations,
    toObject(paperTitles),
    toObject(degrees),
  ) as SearchDoc[];
}
