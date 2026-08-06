/**
 * Combining a keyword ranking with a semantic one.
 *
 * By rank, not by score. BM25 scores are unbounded and corpus-dependent while
 * cosine similarity sits in [-1, 1]; any weighted sum of the two needs a
 * normalization that is itself a tuning problem, and gets it wrong differently
 * on every workspace. Reciprocal rank fusion (Cormack et al., 2009) uses only
 * position, so it needs no calibration and cannot be broken by a corpus whose
 * scores happen to run large.
 *
 * What this buys: exact terms — an author's name, "BLEU", an arXiv id — stay
 * findable because BM25 ranks them first, while a paraphrased question still
 * finds the passage that answers it because the vector arm ranks that first. A
 * document both arms like outranks one that only one of them found, which is
 * the behaviour you actually want.
 */

export interface RankedList<T> {
  items: readonly T[];
  /**
   * Relative influence. Equal by default: neither arm is reliably better, and
   * a thumb on the scale is a preference to expose in settings rather than
   * bake in here.
   */
  weight?: number;
}

export interface FusionOptions {
  /**
   * Rank-fusion constant. 60 is the value from the original paper and the de
   * facto default; it flattens the contribution of the top few positions so a
   * confident-but-wrong first hit cannot dominate.
   */
  k?: number;
  limit?: number;
}

export const RRF_K = 60;

/**
 * Fuse ranked lists into one ordering.
 *
 * `identify` maps an item to the key two lists agree on — a document id, not
 * an object identity, because the arms produce different objects for the same
 * document.
 */
export function fuseRankings<T>(
  lists: readonly RankedList<T>[],
  identify: (item: T) => string,
  options: FusionOptions = {},
): T[] {
  const k = options.k ?? RRF_K;
  const scores = new Map<string, number>();
  const representative = new Map<string, T>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.items.forEach((item, position) => {
      const key = identify(item);
      scores.set(key, (scores.get(key) ?? 0) + weight / (k + position + 1));
      // First list wins the representative: the arms are passed in the order
      // their metadata is preferred, and keyword hits carry the excerpt.
      if (!representative.has(key)) representative.set(key, item);
    });
  }

  const ordered = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => representative.get(key)!);

  return options.limit ? ordered.slice(0, options.limit) : ordered;
}
