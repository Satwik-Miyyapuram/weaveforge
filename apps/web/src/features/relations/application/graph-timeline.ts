import type { GraphViewSettings } from "@weaveforge/core";

import type { GLink, GNode } from "./build-graph-data";

/** Canvas units between one publication year and the next in the timeline layout. */
export const YEAR_SPACING = 90;

/**
 * The timeline layout.
 *
 * Each paper's x is fixed to its publication year, so the graph reads left
 * to right as the field actually developed, while y is left to the forces —
 * related work still clumps vertically. On a citation graph that is a real
 * gain over a free layout: an arrow pointing left is influence flowing
 * backwards through time, and it is visible at a glance.
 *
 * Anything without a year — a tag, a note, a paper whose year nobody filled
 * in — is left alone rather than pinned to a guess. Defaulting the year
 * would stack every one of them in a single stripe and state a publication
 * date that does not exist.
 */
export function timelineLaneX(
  layout: GraphViewSettings["layout"],
  nodes: readonly GNode[],
): ((node: GNode) => number | null) | null {
  if (layout !== "timeline") return null;
  const years = nodes.map((n) => n.year).filter((y): y is number => typeof y === "number");
  if (years.length === 0) return null;
  // Centred on the middle of the collection, so a library of 2020s papers
  // does not start halfway across the canvas.
  const mid = Math.round(years.reduce((a, b) => a + b, 0) / years.length);
  return (node: GNode) => (typeof node.year === "number" ? (node.year - mid) * YEAR_SPACING : null);
}

/** What the simulation is laid out over; a change restarts it. */
export function graphTopologyKey(
  shown: { nodes: readonly GNode[]; links: readonly GLink[] },
  localSeed: string | null,
  localDepth: number,
): string {
  const nodeIds = shown.nodes.map((n) => n.id).sort().join(",");
  const linkIds = shown.links.map((l) => l.id).sort().join(",");
  return `${nodeIds}|${linkIds}|${localSeed ?? ""}|${localDepth}`;
}
