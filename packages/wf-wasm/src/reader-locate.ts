/**
 * Lasso hit-testing, document search and match stepping (steps 5-2e), re-exported from
 * index.ts. Rust `reader::locate` computes these; the signatures match
 * `packages/core/src/reader/ink-lasso.ts` (document search was formerly `document-search.ts`). `encodeLocus` and
 * `decodeLocus` live in `reader-locus.ts` (Rust).
 */
import {
  inkPathsInPolygon as rawInkPathsInPolygon,
} from "../pkg/wf_wasm.js";

export {
  findDocumentMatches,
  nextMatchIndex,
  pointInPolygon,
} from "../pkg/wf_wasm.js";

/** Rust `LASSO_CAUGHT_SHARE`; kept in step with it. */
const LASSO_CAUGHT_SHARE = 0.6;

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


