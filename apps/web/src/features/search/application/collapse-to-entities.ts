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

/**
 * The title a reader would call the same, whatever case, punctuation or file
 * name it was saved under. A PDF imported before its metadata was found is
 * titled after its file — "Goyal et al. - 2017 - Nonparametric Variational
 * Auto-Encoders.pdf", the name reference managers save under — and that is
 * the same paper as "Nonparametric Variational Auto-Encoders", so the author
 * and year in front and the extension behind are not part of the key — nor is
 * the " 1" or " (2)" a second download of the same file picks up.
 */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    // A second download of the same file: "… Learning 1.pdf", "… (2).pdf",
    // "… copy.pdf". Only on file names, so a title ending in a number keeps it.
    .replace(/(?:\s*\(\d{1,2}\)|\s\d{1,2}|\scopy)?\.pdf$/, "")
    .replace(/^[^-]{1,80}? - (?:\d{4}|n\.d\.) - /, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A listed title this one is a cut-off copy of, or that is a cut-off copy of it.
 *
 * Reference managers shorten long file names, so a paper imported from its PDF
 * can be titled "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders
 * for Hierarchical R.pdf" — the start of the real title and no more. Only a long
 * shared start counts: two different papers that both begin "Attention" are not
 * one paper.
 */
const MIN_TWIN_PREFIX = 32;

function truncatedTwin(keys: readonly string[], seen: ReadonlyMap<string, unknown>): string | undefined {
  const title = keys.find((key) => key.startsWith("title:"));
  if (!title) return undefined;
  const kind = title.slice(0, title.indexOf(":", 6) + 1);
  const text = title.slice(kind.length);
  if (text.length < MIN_TWIN_PREFIX) return undefined;
  for (const key of seen.keys()) {
    if (!key.startsWith(kind)) continue;
    const other = key.slice(kind.length);
    if (other.length < MIN_TWIN_PREFIX) continue;
    if (other.startsWith(text) || text.startsWith(other)) return key;
  }
  return undefined;
}

/**
 * Drop the entries of a related list that name something already listed.
 *
 * Two routes put the same thing on the list twice. The arms answer in ids, and
 * fusion joins on the id — but one arm can name a paper by its record and the
 * other by a page of its PDF, and those are different ids for the same paper.
 * And a library can hold two records of one paper (imported twice, or once
 * from a file and once by DOI), which the index rightly keeps apart but which a
 * reader sees as the same title twice. Both are folded here, on what the entry
 * resolves to: its entity, and its title within the same kind. The first —
 * best-ranked — entry wins, so order is kept, and `merge` is told about each
 * entry it absorbed (so it can keep saying which methods found it).
 *
 * The records themselves are left alone: whether two papers are one is the
 * library's call to make (it offers to merge them), not this list's.
 */
export function distinctRelated<T extends { id: string }>(
  results: readonly T[],
  resolve: (id: string) => Pick<SearchHit, "kind" | "entityId" | "title"> | null,
  limit = Infinity,
  seedId?: string,
  merge?: (kept: T, dropped: T) => void,
): T[] {
  // Each key maps to the entry that claimed it; `null` is the seed.
  const seen = new Map<string, T | null>();
  // The seed's own title counts as listed: a second record of the paper being
  // read is not something related to it.
  const seed = seedId ? resolve(seedId) : null;
  if (seed && titleKey(seed.title)) seen.set(`title:${seed.kind === "pdf" ? "paper" : seed.kind}:${titleKey(seed.title)}`, null);
  const kept: T[] = [];
  for (const result of results) {
    const doc = resolve(result.id);
    // A page of a paper's PDF is that paper, for the purposes of a list of
    // things to open next.
    const kind = doc ? (doc.kind === "pdf" ? "paper" : doc.kind) : null;
    const keys = doc
      ? [`entity:${kind}:${doc.entityId}`, ...(titleKey(doc.title) ? [`title:${kind}:${titleKey(doc.title)}`] : [])]
      : [`id:${result.id}`];
    const claimed = keys.find((key) => seen.has(key)) ?? truncatedTwin(keys, seen);
    if (claimed !== undefined) {
      const owner = seen.get(claimed);
      if (owner) merge?.(owner, result);
      continue;
    }
    // Past the limit the scan goes on only to credit what is already listed.
    if (kept.length >= limit) continue;
    for (const key of keys) seen.set(key, result);
    kept.push(result);
  }
  return kept;
}
