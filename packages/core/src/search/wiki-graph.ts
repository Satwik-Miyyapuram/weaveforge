/**
 * The wiki-link graph over a workspace.
 *
 * Nodes are `${kind}:${id}` so they line up with search document ids. Edges
 * come from `[[wikilinks]]` in note, paper-summary, and section bodies, plus
 * shared tags — the same signals the graph screen already draws, lifted here so
 * ranking and retrieval can use them without duplicating the resolution rules.
 */

import { extractWikilinks, normalizeTitleKey } from "../features/vault/domain/vault-page.js";
import { extractHashtags } from "../features/papers/domain/paper.js";
import type { WorkspaceSnapshot } from "../workspace/workspace-snapshot.js";

export interface WikiGraph {
  nodes: string[];
  /** Adjacency, undirected: a link implies relatedness in both directions. */
  edges: Map<string, string[]>;
}

function addEdge(edges: Map<string, string[]>, from: string, to: string): void {
  if (from === to) return;
  const list = edges.get(from);
  if (!list) {
    edges.set(from, [to]);
    return;
  }
  if (!list.includes(to)) list.push(to);
}

/**
 * Build the graph.
 *
 * Wikilink targets resolve note → paper → section, matching the priority the
 * graph screen already uses. Resolution is by normalized title, which is how
 * `[[…]]` autocomplete and backlinks already work, so a link that renders in
 * the app is a link here.
 */
export function buildWikiGraph(snapshot: WorkspaceSnapshot): WikiGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, string[]>();

  const noteByTitle = new Map<string, string>();
  const paperByTitle = new Map<string, string>();
  const sectionByTitle = new Map<string, string>();

  for (const page of snapshot.vaultPages) {
    nodes.add(`note:${page.id}`);
    noteByTitle.set(normalizeTitleKey(page.title), `note:${page.id}`);
  }
  for (const paper of snapshot.papers) {
    nodes.add(`paper:${paper.id}`);
    paperByTitle.set(normalizeTitleKey(paper.title), `paper:${paper.id}`);
  }
  for (const section of snapshot.reportSections) {
    nodes.add(`section:${section.id}`);
    sectionByTitle.set(normalizeTitleKey(section.title), `section:${section.id}`);
  }

  const resolve = (target: string): string | null => {
    const key = normalizeTitleKey(target);
    return noteByTitle.get(key) ?? paperByTitle.get(key) ?? sectionByTitle.get(key) ?? null;
  };

  const linkFrom = (sourceNode: string, body: string | undefined) => {
    if (!body) return;
    for (const ref of extractWikilinks(body)) {
      const target = resolve(ref.target);
      if (!target || target === sourceNode) continue;
      addEdge(edges, sourceNode, target);
      addEdge(edges, target, sourceNode);
    }
  };

  for (const page of snapshot.vaultPages) linkFrom(`note:${page.id}`, page.body);
  for (const paper of snapshot.papers) linkFrom(`paper:${paper.id}`, paper.summary);
  for (const section of snapshot.reportSections) linkFrom(`section:${section.id}`, section.notes);

  // Explicit paper relations are first-class edges — a stated "extends" is at
  // least as strong a signal as a mention in prose.
  for (const relation of snapshot.relations) {
    const from = `paper:${relation.fromPaper}`;
    const to = `paper:${relation.toPaper}`;
    if (!nodes.has(from) || !nodes.has(to)) continue;
    addEdge(edges, from, to);
    addEdge(edges, to, from);
  }

  // Shared tags connect documents nobody linked by hand. Capped: a tag on forty
  // notes would otherwise contribute ~1600 edges and drown the real links.
  const MAX_TAG_FANOUT = 12;
  const byTag = new Map<string, string[]>();
  const collect = (node: string, tags: readonly string[]) => {
    for (const tag of tags) {
      const list = byTag.get(tag) ?? [];
      list.push(node);
      byTag.set(tag, list);
    }
  };
  for (const page of snapshot.vaultPages) collect(`note:${page.id}`, extractHashtags(page.body));
  for (const paper of snapshot.papers) collect(`paper:${paper.id}`, paper.tags);

  for (const members of byTag.values()) {
    if (members.length < 2 || members.length > MAX_TAG_FANOUT) continue;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        addEdge(edges, members[i]!, members[j]!);
        addEdge(edges, members[j]!, members[i]!);
      }
    }
  }

  for (const node of nodes) if (!edges.has(node)) edges.set(node, []);
  return { nodes: [...nodes], edges };
}

/** Link count per node, for `SearchDoc.degree`. */
export function graphDegrees(graph: WikiGraph): Map<string, number> {
  const out = new Map<string, number>();
  for (const [node, neighbours] of graph.edges) out.set(node, neighbours.length);
  return out;
}

export interface GraphDensity {
  nodes: number;
  edges: number;
  /** Mean degree; the reference cascade uses density to pick an arm. */
  meanDegree: number;
  /** Fraction of nodes in the largest connected component. */
  largestComponentRatio: number;
}

/**
 * Measure the graph. Worth reporting before trusting PPR: on a sparse graph it
 * degrades to "return the seed", and lexical retrieval is the better answer.
 */
export function graphDensity(graph: WikiGraph): GraphDensity {
  const nodeCount = graph.nodes.length;
  if (nodeCount === 0) {
    return { nodes: 0, edges: 0, meanDegree: 0, largestComponentRatio: 0 };
  }

  let edgeEnds = 0;
  for (const neighbours of graph.edges.values()) edgeEnds += neighbours.length;

  const seen = new Set<string>();
  let largest = 0;
  for (const start of graph.nodes) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const node = stack.pop()!;
      size += 1;
      for (const next of graph.edges.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    if (size > largest) largest = size;
  }

  return {
    nodes: nodeCount,
    edges: edgeEnds / 2,
    meanDegree: edgeEnds / nodeCount,
    largestComponentRatio: largest / nodeCount,
  };
}
