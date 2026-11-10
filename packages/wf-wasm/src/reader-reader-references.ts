/**
 * Reference index (Rust `reader_reader_references`), re-exported from index.ts. The flat lists come from
 * the core; the Map shapes the overlay reads are built here, so callers keep their signatures.
 */
import {
  buildReferenceIndex as rawBuildReferenceIndex,
  indexFromAnalysis as rawIndexFromAnalysis,
  outlineItemsFor as rawOutlineItemsFor,
} from "../pkg/wf_wasm.js";

/** A clickable thing found in the page text. Shape of the Rust MentionHit, serialised camelCase. */
export interface MentionHit {
  key: string;
  kind: "citation" | "figure" | "url";
  start: number;
  end: number;
  label: string;
  url?: string;
  refIndexes: number[];
  rects?: number[][];
  target?: unknown;
  source?: string;
  confidence?: number;
}

/** One parsed bibliography entry as the core serialises it. Callers pick a richer type through the generic `R`. */
export interface ParsedReferenceEntry {
  index: number;
  raw: string;
}

/** Flat index as the core returns it. `byIndex` is rebuilt from `references` and `mentionsByPage` into a Map. */
interface FlatReferenceIndex<R extends ParsedReferenceEntry> {
  references: R[];
  mentionsByPage: { pageNumber: number; mentions: MentionHit[] }[];
  bodyFontSize: number;
  fingerprint: string;
}

export interface ReaderReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry> {
  references: R[];
  byIndex: Map<number, R>;
  mentionsByPage: Map<number, MentionHit[]>;
  bodyFontSize: number;
  fingerprint: string;
}

/** The page shape the core reads: 1-based page number, text items, and `/Link` annotations. */
export interface ReferencePage {
  pageNumber: number;
  items: readonly { str: string; hasEOL?: boolean }[];
  links?: readonly object[];
}

function toMaps<R extends ParsedReferenceEntry>(flat: FlatReferenceIndex<R>): ReaderReferenceIndex<R> {
  return {
    references: flat.references,
    byIndex: new Map(flat.references.map((ref) => [ref.index, ref])),
    mentionsByPage: new Map(flat.mentionsByPage.map((page) => [page.pageNumber, page.mentions])),
    bodyFontSize: flat.bodyFontSize,
    fingerprint: flat.fingerprint,
  };
}

/** The pages' runs as outline items, one array per page. */
export function outlineItemsFor(pages: readonly ReferencePage[]): unknown[][] {
  return rawOutlineItemsFor(pages) as unknown[][];
}

/** Shape a completed analysis (plain arrays from the worker) into the overlay's index. */
export function indexFromAnalysis<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  analysis: unknown,
  pages: readonly ReferencePage[],
): ReaderReferenceIndex<R> {
  return toMaps(rawIndexFromAnalysis(analysis, pages) as FlatReferenceIndex<R>);
}

/** Analyze the pages and shape the result in one step. */
export function buildReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  pages: readonly ReferencePage[],
  outline: readonly unknown[] = [],
): ReaderReferenceIndex<R> {
  return toMaps(rawBuildReferenceIndex(pages, outline) as FlatReferenceIndex<R>);
}
