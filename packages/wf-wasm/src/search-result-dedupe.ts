/**
 * Hit collapsing and related-list de-duplication (Rust `result_dedupe`). The
 * callbacks stay here: `entityDoc` and `resolve` look up records, and only their
 * results cross into WASM. Merges come back as indices and are replayed in order.
 */
import {
  collapseToEntities as rawCollapseHits,
  distinctRelated as rawDistinctRelatedIndices,
} from "../pkg/wf_wasm.js";

/**
 * Fold hits onto the entity they belong to. A PDF page is stood in for by its
 * paper's own document when `entityDoc` finds one. The seed's entity is dropped.
 * `entityDoc` runs only for non-seed PDF hits.
 */
export function collapseToEntities(
  hits: readonly { id: string; kind: string; entityId: string; score: number }[],
  seed: { entityId: string },
  entityDoc: (hit: { id: string; kind: string; entityId: string; score: number }) => string | null = () => null,
): { id: string; score: number }[] {
  return rawCollapseHits(
    hits.map((hit) => ({
      id: hit.id,
      entityId: hit.entityId,
      score: hit.score,
      isPdf: hit.kind === "pdf",
      entityDoc: hit.kind === "pdf" && hit.entityId !== seed.entityId ? entityDoc(hit) : null,
    })),
    seed.entityId,
  );
}

/**
 * Drop the entries of a related list that name something already listed: the
 * same entity, or the same title within the same kind, or a cut-off copy of a
 * listed title. The first (best-ranked) entry wins, so order is kept. `merge` is
 * told about each entry it absorbed. The records themselves are left alone.
 */
export function distinctRelated<T extends { id: string }>(
  results: readonly T[],
  resolve: (id: string) => { kind: string; entityId: string; title: string } | null,
  limit = Infinity,
  seedId?: string,
  merge?: (kept: T, dropped: T) => void,
): T[] {
  const seed = seedId ? resolve(seedId) : null;
  const raw: {
    kept: number[];
    merges: { owner: number; dropped: number }[];
  } = rawDistinctRelatedIndices({
    entries: results.map((result) => {
      const doc = resolve(result.id);
      return {
        id: result.id,
        doc: doc ? { kind: doc.kind, entityId: doc.entityId, title: doc.title } : null,
      };
    }),
    seed: seed ? { kind: seed.kind, entityId: seed.entityId, title: seed.title } : null,
    limit: Number.isFinite(limit) ? limit : null,
  });
  for (const { owner, dropped } of raw.merges) {
    merge?.(results[owner] as T, results[dropped] as T);
  }
  return raw.kept.map((index) => results[index] as T);
}
