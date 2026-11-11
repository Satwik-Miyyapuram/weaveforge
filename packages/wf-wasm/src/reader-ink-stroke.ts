/**
 * Reader ink stroke geometry (step 5-2e), re-exported from index.ts. Each wrapper
 * maps the TS signature of `packages/core/src/reader/ink-stroke.ts` onto the raw
 * Rust export; flat point arrays cross as `Float64Array`s and come back as `number[]`.
 */
import {
  meanPressure as rawMeanPressure,
  shouldAppendInkPoint as rawShouldAppendInkPoint,
  simplifyPathIndices as rawSimplifyPathIndices,
  simplifyInkPath as rawSimplifyInkPath,
  quantizeInkPath as rawQuantizeInkPath,
  compactInkPath as rawCompactInkPath,
  inkPathJsonSize as rawInkPathJsonSize,
  canJoinInkGroup as rawCanJoinInkGroup,
  inkPathsHitTest as rawInkPathsHitTest,
  translateInkPaths as rawTranslateInkPaths,
  inkPathsBounds as rawInkPathsBounds,
} from "../pkg/wf_wasm.js";

export {
  clampInkWidth,
  inkNoteWidthToPdfPoints,
  inkWidthForPressure,
  isHighlighterInk,
} from "../pkg/wf_wasm.js";

export function meanPressure(samples: readonly number[]): number | undefined {
  return rawMeanPressure(Float64Array.from(samples));
}

export function shouldAppendInkPoint(
  path: readonly number[],
  x: number,
  y: number,
  minDistance?: number,
): boolean {
  return rawShouldAppendInkPoint(Float64Array.from(path), x, y, minDistance);
}

export function simplifyPathIndices(path: readonly number[], tolerance?: number): number[] {
  return rawSimplifyPathIndices(Float64Array.from(path), tolerance);
}

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

export function inkPathJsonSize(path: readonly number[]): number {
  return rawInkPathJsonSize(Float64Array.from(path));
}

export function canJoinInkGroup(
  group: {
    pageIndex: number;
    color: string;
    width: number;
    pathCount: number;
    lastAt: number;
  } | null,
  next: { pageIndex: number; color: string; width: number; at: number },
  windowMs?: number,
): boolean {
  return rawCanJoinInkGroup(group, next, windowMs);
}

export function inkPathsHitTest(
  paths: readonly (readonly number[])[],
  x: number,
  y: number,
  radius: number,
): boolean {
  return rawInkPathsHitTest(paths, x, y, radius);
}

export function translateInkPaths(
  paths: readonly (readonly number[])[],
  dx: number,
  dy: number,
  decimals?: number,
): number[][] {
  return rawTranslateInkPaths(paths, dx, dy, decimals);
}

export function inkPathsBounds(
  paths: readonly (readonly number[])[],
): [number, number, number, number] | null {
  return rawInkPathsBounds(paths);
}
