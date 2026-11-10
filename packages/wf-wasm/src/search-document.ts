/**
 * Search-document projections (Rust `search::search_document`), re-exported from
 * index.ts. Keeps the shape of packages/core/src/search/search-document.ts,
 * pdf-search-document.ts and annotation-search-document.ts; the rules live in Rust.
 * Degree and title maps cross the boundary as plain objects.
 */
import {
  annotationDocId as rawAnnotationDocId,
  boundedBody as rawBoundedBody,
  excerptOf as rawExcerptOf,
  extractHeadings as rawExtractHeadings,
  indexTermsOf as rawIndexTermsOf,
  pdfDocId as rawPdfDocId,
  pdfDocIdsFor as rawPdfDocIdsFor,
  pdfPageHref as rawPdfPageHref,
  projectSearchDocuments as rawProjectSearchDocuments,
  projectStoredPdfTexts as rawProjectStoredPdfTexts,
  searchRevision as rawSearchRevision,
  toAnnotationSearchDocs as rawToAnnotationSearchDocs,
  toPdfSearchDocs as rawToPdfSearchDocs,
  toSearchDocs as rawToSearchDocs,
} from "../pkg/wf_wasm.js";
import type {
  AnnotationSource,
  PdfIndexSource as StoredPdfIndexSource,
  PdfPageText as StoredPdfPageText,
  SearchDoc,
  StoredPdfProjection,
  WikiGraph,
} from "./bindings.js";
import type { ReadonlyInput } from "./readonly-input.js";

/** One PDF page's extracted text. */
export type PdfPageText = Required<StoredPdfPageText>;

/** A paper's extracted PDF text, as callers send it. Rust also accepts a partial one. */
export type PdfIndexSource = Required<Omit<StoredPdfIndexSource, "pages">> & {
  pages: readonly PdfPageText[];
};

function toObject(map: ReadonlyMap<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(map);
}

/** Rust takes adjacency as an array of rows; this converts the TS Map form of the wiki graph. */
function toWireGraph(graph: { nodes: string[]; edges: Map<string, string[]> } | null): WikiGraph | null {
  if (!graph) return null;
  return {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
}

/** Project a workspace snapshot into search documents. */
export function toSearchDocs(
  snapshot: object,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToSearchDocs(snapshot, toObject(degrees)) as SearchDoc[];
}

/** Fingerprint of the indexed corpus; a differing revision means the index is stale. */
export function searchRevision(docs: readonly ReadonlyInput<SearchDoc>[]): string {
  return rawSearchRevision(docs);
}

/**
 * The index terms of `text` with the search tokenizer defaults, cut to the longest text the
 * index accepts rather than throwing. Rust `index_terms_of_js`.
 */
export function indexTermsOf(text: string): string[] {
  return rawIndexTermsOf(text);
}

/**
 * A 200-character excerpt of `body` around `terms`, cut like `indexTermsOf`. Throws when the
 * terms together need more than the index cap. Rust `excerpt_of_js`.
 */
export function excerptOf(
  body: string,
  terms: readonly string[],
): { text: string; highlights: { start: number; end: number }[] } {
  const raw = rawExcerptOf(body, terms) as { text: number[]; highlights: { start: number; end: number }[] };
  // Rust sends UTF-16 units so a lone surrogate survives; chunks keep each spread under the argument limit.
  let text = "";
  for (let i = 0; i < raw.text.length; i += 8192) {
    text += String.fromCharCode(...raw.text.slice(i, i + 8192));
  }
  return { text, highlights: raw.highlights };
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

/** The worker's build: documents plus per-paper page counts, as `[paperId, pageCount]` pairs. */
/**
 * The search corpus for a snapshot: its own documents, then PDF pages, then reader
 * annotations. `graph` is null when degrees are not wanted. Rust `project_search_documents`.
 */
export function projectSearchDocuments(
  snapshot: object,
  graph: { nodes: string[]; edges: Map<string, string[]> } | null,
  pdfTexts: readonly PdfIndexSource[],
): SearchDoc[] {
  return rawProjectSearchDocuments(snapshot, toWireGraph(graph), pdfTexts) as SearchDoc[];
}

/**
 * The worker's build: stored PDF text minus papers the library no longer holds, projected
 * with a graph built from the snapshot. Rust `project_stored_pdf_texts`.
 */
export function projectStoredPdfTexts(
  snapshot: object,
  stored: readonly PdfIndexSource[],
): StoredPdfProjection {
  return rawProjectStoredPdfTexts(snapshot, stored) as StoredPdfProjection;
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
