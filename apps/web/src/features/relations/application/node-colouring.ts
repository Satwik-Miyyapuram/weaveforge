import { enumLabel } from "@/lib/enum-label";
import { readyCore } from "@/lib/rust-core";
import type { ColorGroup, Paper, ReadingList } from "@weaveforge/core";

/**
 * The colour modes that are worked out from the whole graph rather than from
 * one node: year and link-count ramps, communities, and custom groups.
 *
 * Pure functions over plain arrays, so the builder stays a builder and every
 * rule here is tested on its own.
 */

/** Nodes with nothing to say in the current mode. Not a palette constant, so no override remaps it. */
export const UNCOLOURED = "#c7c1b6";

/**
 * A colour `t` of the way along the ramp, `t` clamped to 0..1. Ramp ends: pale
 * sand for old or few, deep ink-blue for new or many. Rust `ramp_colour`.
 */
export function rampColour(t: number): string {
  return readyCore().rampColour(t);
}

/** The ramp as a CSS gradient, for the legend. Literal of `rampColour` at 0, 0.5 and 1. */
export const RAMP_GRADIENT = "linear-gradient(90deg, #e8d9b0, #8c928f, #2f4b6e)";

/** Year → ramp position across the years present. One year only sits mid-ramp. */
export function yearColours(years: Map<string, number>): Map<string, string> {
  return new Map(readyCore().yearColours([...years]));
}

/**
 * Link count → ramp position. Square-root scaled: in a citation graph a few
 * hubs carry most links, and a linear ramp would paint everyone else pale.
 */
export function degreeColours(degree: Map<string, number>): Map<string, string> {
  return new Map(readyCore().degreeColours([...degree]));
}

/** Distinct, print-safe hues for communities, biggest community first. */
export const CLUSTER_PALETTE = [
  "#e4572e", "#2e86ab", "#f2a541", "#3bb273", "#7768ae",
  "#e15a97", "#1b998b", "#c1a33a", "#8a5a44", "#4f6d7a",
] as const;

/**
 * Communities by label propagation: each node repeatedly takes the label most
 * of its neighbours carry. Deterministic here, not the textbook's random
 * order: nodes go in id order and ties go to the smallest label, so the same
 * graph always gets the same colours.
 *
 * Returns node id → community index, 0 for the biggest; nodes with no links
 * get no entry.
 */
export function communities(ids: string[], edges: Array<[string, string]>): Map<string, number> {
  return new Map(readyCore().communities(ids, edges));
}

/** A community's colour; past the palette, communities share the neutral grey. */
export function clusterColour(index: number | undefined): string {
  return index === undefined ? UNCOLOURED : CLUSTER_PALETTE[index] ?? UNCOLOURED;
}

/** What a group rule can test on a node. */
export interface GroupSubject {
  title: string;
  tags: string[];
  status?: string;
  /** Names of the lists the paper is in. */
  lists: string[];
}

function matches(query: string, s: GroupSubject): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const colon = q.indexOf(":");
  const field = colon > 0 ? q.slice(0, colon) : "";
  const value = colon > 0 ? q.slice(colon + 1).trim().replace(/^#/, "") : q;
  if (field === "tag") return s.tags.some((t) => t.toLowerCase() === value);
  if (field === "list") return s.lists.some((l) => l.toLowerCase() === value);
  // "status:to read", "status:to_read" and the label "status:done" all match.
  if (field === "status") {
    const status = s.status ?? "";
    return status === value.split(" ").join("_") || enumLabel("paperStatus", status).toLowerCase() === value;
  }
  if (field === "title") return s.title.toLowerCase().includes(value);
  return s.title.toLowerCase().includes(q);
}

/** The first group whose rule matches, or none. */
export function groupColour(groups: ColorGroup[], s: GroupSubject): string | undefined {
  return groups.find((g) => matches(g.query, s))?.color;
}

/** A paper as a group rule sees it. */
export function paperSubject(p: Paper, membership: Map<string, Set<string>>, lists: ReadingList[]): GroupSubject {
  return {
    title: p.title,
    tags: p.tags,
    status: p.status,
    lists: lists.filter((l) => membership.get(l.id)?.has(p.id)).map((l) => l.name),
  };
}

/** The node fields recolouring reads and writes; `GNode` satisfies it. */
interface ColourableNode {
  id: string;
  kind: string;
  label: string;
  color: string;
  paperId?: string;
  year?: number;
  tagName?: string;
}

export interface RecolourContext {
  papers: Map<string, Paper>;
  /** Hashtags per note id. */
  noteTags: Map<string, string[]>;
  membership: Map<string, Set<string>>;
  lists: ReadingList[];
}

function subjectOf(n: ColourableNode, ctx: RecolourContext): GroupSubject {
  const paper = n.paperId ? ctx.papers.get(n.paperId) : undefined;
  if (paper) return paperSubject(paper, ctx.membership, ctx.lists);
  if (n.tagName) return { title: n.label, tags: [n.tagName], lists: [] };
  return { title: n.label, tags: ctx.noteTags.get(n.id) ?? [], lists: [] };
}

/**
 * Applies the graph-wide modes in place. Every node, tags included, takes the
 * mode's colour, and a node the mode says nothing about goes grey, so the
 * picture never mixes two meanings of colour. Other modes are left as built.
 */
export function recolourNodes(
  nodes: ColourableNode[],
  links: Array<{ source: string; target: string }>,
  colorBy: string,
  groups: ColorGroup[],
  ctx: RecolourContext,
): void {
  if (colorBy === "year") {
    const years = new Map<string, number>();
    for (const n of nodes) if (n.year !== undefined) years.set(n.id, n.year);
    const colours = yearColours(years);
    for (const n of nodes) n.color = colours.get(n.id) ?? UNCOLOURED;
  } else if (colorBy === "degree") {
    const degree = new Map(nodes.map((n) => [n.id, 0]));
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    const colours = degreeColours(degree);
    for (const n of nodes) n.color = colours.get(n.id) ?? UNCOLOURED;
  } else if (colorBy === "cluster") {
    const index = communities(nodes.map((n) => n.id), links.map((l) => [l.source, l.target]));
    for (const n of nodes) n.color = clusterColour(index.get(n.id));
  } else if (colorBy === "groups") {
    for (const n of nodes) n.color = groupColour(groups, subjectOf(n, ctx)) ?? UNCOLOURED;
  }
}
