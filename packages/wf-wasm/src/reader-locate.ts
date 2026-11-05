/**
 * Lasso hit-testing, document search and match stepping (steps 5-2e), re-exported from
 * index.ts. Rust `reader::locate` computes these; the signatures match
 * `packages/core/src/reader/ink-lasso.ts` and `document-search.ts`. `encodeLocus` and
 * `decodeLocus` stay in core (`locus-link.ts`).
 */
import {
  pointInPolygon as rawPointInPolygon,
  inkPathsInPolygon as rawInkPathsInPolygon,
  findDocumentMatches as rawFindDocumentMatches,
  nextMatchIndex as rawNextMatchIndex,
} from "../pkg/wf_wasm.js";

/** Rust `LASSO_CAUGHT_SHARE`; kept in step with it. */
const LASSO_CAUGHT_SHARE = 0.6;

/** Whether a point is inside a closed polygon, by the even-odd rule (Rust `point_in_polygon`). */
export function pointInPolygon(polygon: readonly number[], x: number, y: number): boolean {
  return rawPointInPolygon(Float64Array.from(polygon), x, y);
}

/**
 * Whether a loop has caught a stroke: at least `share` of its points inside (Rust `ink_paths_in_polygon`).
 */
export function inkPathsInPolygon(
  paths: readonly (readonly number[])[],
  polygon: readonly number[],
  share = LASSO_CAUGHT_SHARE,
): boolean {
  const flat = Float64Array.from(paths.flatMap((path) => path));
  const lengths = Uint32Array.from(paths, (path) => path.length);
  return rawInkPathsInPolygon(flat, lengths, Float64Array.from(polygon), share);
}

/**
 * Case-insensitive full-document search over extracted page texts (Rust `find_document_matches`).
 * Empty / whitespace-only queries return no matches.
 */
export function findDocumentMatches(
  pages: readonly { pageIndex: number; text: string }[],
  query: string,
): { pageIndex: number; start: number; end: number }[] {
  return rawFindDocumentMatches(pages, query) as { pageIndex: number; start: number; end: number }[];
}

/** Wraparound next/prev index into a match list. Returns -1 when empty (Rust `next_match_index`). */
export function nextMatchIndex(current: number, total: number, direction: 1 | -1): number {
  return rawNextMatchIndex(current, total, direction);
}
