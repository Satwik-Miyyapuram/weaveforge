import type { SearchHit } from "@weaveforge/core";

/**
 * Fold hits onto the entity they belong to.
 *
 * A PDF's pages are indexed one document each, so a similar paper came back as
 * the same title four times. A page is stood in for by the paper's own document
 * when `entityDoc` finds one — the paper page, not page 9 of its PDF, is where
 * "related" should land. The seed's entity is dropped: its own pages are the
 * closest match to its title, and nobody needs to be told that.
 *
 * Moved out of `workspace-search.ts`, where it sat above the class as an exported
 * function that the class was one of two callers of. It is a ranking helper with
 * no state and its own tests; a reader looking for how related-documents are
 * ranked should not have to scroll past an index lifecycle to find it.
 */
export function collapseToEntities(
  hits: readonly SearchHit[],
  seed: Pick<SearchHit, "entityId">,
  entityDoc: (hit: SearchHit) => string | null = () => null,
): { id: string; score: number }[] {
  const best = new Map<string, { id: string; score: number; isEntityDoc: boolean }>();
  for (const hit of hits) {
    if (hit.entityId === seed.entityId) continue;
    const owner = hit.kind === "pdf" ? entityDoc(hit) : null;
    const isEntityDoc = hit.kind !== "pdf" || owner !== null;
    const current = best.get(hit.entityId);
    if (!current) {
      best.set(hit.entityId, { id: owner ?? hit.id, score: hit.score, isEntityDoc });
      continue;
    }
    // Keep the entity's own document as the link target, but let the score be
    // the best any of its documents earned so ranking is not skewed by a
    // page happening to outscore the paper record.
    current.score = Math.max(current.score, hit.score);
    if (isEntityDoc && !current.isEntityDoc) {
      current.id = owner ?? hit.id;
      current.isEntityDoc = true;
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ id, score }) => ({ id, score }));
}
