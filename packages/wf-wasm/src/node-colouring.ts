/**
 * Graph node colours (Rust `node_colouring`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/node-colouring.ts.
 */
import {
  rampColour as rawRampColour,
  yearColours as rawYearColours,
  degreeColours as rawDegreeColours,
  communities as rawCommunities,
} from "../pkg/wf_wasm.js";

/** A colour `t` of the way along the ramp, `t` clamped to 0..1 (non-finite counts as 0). */
export function rampColour(t: number): string {
  return rawRampColour(t);
}

/** Year → ramp colour across the years present; one year sits mid-ramp. */
export function yearColours(years: readonly (readonly [string, number])[]): [string, string][] {
  return rawYearColours(years) as [string, string][];
}

/** Link count → ramp colour, square-root scaled. */
export function degreeColours(degree: readonly (readonly [string, number])[]): [string, string][] {
  return rawDegreeColours(degree) as [string, string][];
}

/** Node id → community rank, 0 for the biggest; nodes with no links are absent. */
export function communities(
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
): [string, number][] {
  return rawCommunities(ids, edges) as [string, number][];
}
