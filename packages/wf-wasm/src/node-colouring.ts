/**
 * Graph node colours (Rust `node_colouring`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/node-colouring.ts.
 */
import {
  rampColour as rawRampColour,
  yearColours as rawYearColours,
  degreeColours as rawDegreeColours,
  communities as rawCommunities,
  recolourNodes as rawRecolourNodes,
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

/** The node fields recolouring reads. `color` is written back in place. */
export interface RecolourableNode {
  id: string;
  label: string;
  color: string;
  paperId?: string;
  year?: number;
  tagName?: string;
}

/** The lookups recolouring needs beyond the nodes and links. */
export interface RecolourLookups {
  papers: ReadonlyMap<string, { id: string; title: string; status?: string; tags: readonly string[] }>;
  /** Hashtags per note id. */
  noteTags: ReadonlyMap<string, readonly string[]>;
  /** Paper ids per list id. */
  membership: ReadonlyMap<string, ReadonlySet<string>>;
  lists: readonly { id: string; name: string }[];
}

/**
 * Applies a graph-wide colour mode (`year`, `degree`, `cluster`, `groups`) to the
 * nodes in place. Other modes leave the nodes as built.
 */
export function recolourNodes(
  nodes: RecolourableNode[],
  links: readonly { source: string; target: string }[],
  colorBy: string,
  groups: readonly { query: string; color: string }[],
  ctx: RecolourLookups,
): void {
  const colours = rawRecolourNodes(nodes, links, colorBy, groups, {
    papers: Object.fromEntries(ctx.papers),
    noteTags: Object.fromEntries(ctx.noteTags),
    membership: Object.fromEntries([...ctx.membership].map(([id, set]) => [id, [...set]])),
    lists: ctx.lists,
  }) as string[] | null;
  if (colours) nodes.forEach((n, i) => {
    n.color = colours[i]!;
  });
}
