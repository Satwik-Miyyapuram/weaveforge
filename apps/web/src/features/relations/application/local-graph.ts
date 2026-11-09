/** BFS subgraph over combined relation + concept adjacency. */

export function linkNodeId(source: string | { id: string }): string {
  return typeof source === "string" ? source : source.id;
}

export function filterGraphByNodes<
  T extends { id: string },
  L extends { source: string | { id: string }; target: string | { id: string } },
>(nodes: T[], links: L[], allowed: Set<string> | null): { nodes: T[]; links: L[] } {
  if (!allowed) return { nodes, links };
  const filteredNodes = nodes.filter((n) => allowed.has(n.id));
  const ids = new Set(filteredNodes.map((n) => n.id));
  const filteredLinks = links.filter(
    (l) => ids.has(linkNodeId(l.source)) && ids.has(linkNodeId(l.target)),
  );
  return { nodes: filteredNodes, links: filteredLinks };
}

/** Clone links so force-graph always receives string endpoints (avoids stale object refs). */
export function cloneLinks<L extends { source: string | { id: string }; target: string | { id: string } }>(
  links: L[],
): (L & { source: string; target: string })[] {
  return links.map((l) => ({
    ...l,
    source: linkNodeId(l.source),
    target: linkNodeId(l.target),
  }));
}
