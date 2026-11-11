/**
 * Reader ink stroke geometry (step 5-2e), re-exported from index.ts. Each wrapper
 * maps the TS signature of `packages/core/src/reader/ink-stroke.ts` onto the raw
 * Rust export; flat point arrays cross as `Float64Array`s and come back as `number[]`.
 */
import {
  simplifyInkPath as rawSimplifyInkPath,
  quantizeInkPath as rawQuantizeInkPath,
  compactInkPath as rawCompactInkPath,
} from "../pkg/wf_wasm.js";

export {
  canJoinInkGroup,
  clampInkWidth,
  inkNoteWidthToPdfPoints,
  inkPathJsonSize,
  inkPathsBounds,
  inkPathsHitTest,
  inkWidthForPressure,
  isHighlighterInk,
  meanPressure,
  shouldAppendInkPoint,
  simplifyPathIndices,
  translateInkPaths,
} from "../pkg/wf_wasm.js";

export function simplifyInkPath(path: readonly number[], tolerance?: number): number[] {
  return Array.from(rawSimplifyInkPath(Float64Array.from(path), tolerance));
}

export function quantizeInkPath(path: readonly number[], decimals?: number): number[] {
  return Array.from(rawQuantizeInkPath(Float64Array.from(path), decimals));
}

export function compactInkPath(
  path: readonly number[],
  options?: { tolerance?: number; maxPoints?: number; decimals?: number },
): number[] {
  return Array.from(rawCompactInkPath(Float64Array.from(path), options));
}
