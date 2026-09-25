/**
 * What each sentence encoder needs to be used correctly.
 *
 * Encoders are not interchangeable behind a model id. They differ in how a
 * sentence vector is read off the token vectors (mean of all tokens, or the
 * first `[CLS]` token), in the instruction a *query* must carry (asymmetric
 * retrievers are trained with one, and score noticeably worse without it), and
 * in where "related" starts on the cosine scale — MiniLM's unrelated pairs sit
 * near 0.2, BGE's near 0.5. A floor tuned for one model is noise for another,
 * so the floor lives here, beside the model it was measured on.
 */

export interface EmbeddingModelProfile {
  readonly id: string;
  readonly pooling: "mean" | "cls";
  /** Prepended to a query before it is embedded. */
  readonly queryPrefix: string;
  /** Prepended to a passage before it is embedded. */
  readonly passagePrefix: string;
  /** Cosine below which a hit is noise rather than a paraphrase. */
  readonly minScore: number;
  /** Rough q8 download, for the settings copy. */
  readonly downloadMb: number;
}

/**
 * Snowflake arctic-embed-m v1.5: a 110M-parameter retriever, 768-dimensional.
 *
 * Chosen by measurement, not reputation (`.scratch/calib.mjs`): 15 paraphrase
 * queries against this workspace's 39 papers (title + arXiv abstract), q8, the
 * same weights the app downloads.
 *
 *   model                  MRR    target median  non-target p95
 *   all-MiniLM-L6-v2       0.807  0.434          0.375
 *   bge-base-en-v1.5       0.822  0.661          0.644
 *   arctic-embed-m-v1.5    0.833  0.405          0.320
 *   gte-base-en-v1.5       0.848  0.492          0.506   (7× slower)
 *   e5-base-v2             0.766
 *   mxbai-embed-large-v1   0.729  (larger was not better at q8)
 *   bge-large-en-v1.5      0.718
 *   allenai-specter        0.331  (paper↔paper model; poor for typed queries)
 *
 * Arctic ranks with the best of them and has the widest gap between a real
 * match and everything else, which is what matters when the score is also a
 * filter (the papers list shows only what search returns). Off-topic queries
 * ("how cooking pasta works") topped out at 0.243; true targets had a median of
 * 0.405. Hence 0.28.
 *
 * Re-checked 2026-09-24 against the research brief's shortlist on the same
 * queries: gte-modernbert-base (MRR 0.806, off-topic scores overlap true
 * targets so no floor works), arctic-embed-m-v2.0 (0.788, ~3× slower) and
 * mdbr-leaf-ir (0.688) all lost to this model (0.833). It stays.
 */
export const ARCTIC_EMBED_M: EmbeddingModelProfile = {
  id: "Snowflake/snowflake-arctic-embed-m-v1.5",
  pooling: "cls",
  queryPrefix: "Represent this sentence for searching relevant passages: ",
  passagePrefix: "",
  minScore: 0.28,
  downloadMb: 110,
};

/** The previous default. Kept so a stored index built with it can be named. */
export const MINILM_L6: EmbeddingModelProfile = {
  id: "Xenova/all-MiniLM-L6-v2",
  pooling: "mean",
  queryPrefix: "",
  passagePrefix: "",
  minScore: 0.3,
  downloadMb: 25,
};

/**
 * The encoder new vectors are built with.
 *
 * Upgrading is a one-line change here plus a profile above. Stored vectors
 * from the old model keep answering while the new one embeds in the
 * background, then the two swap (see `semantic-search.ts`) — which only works
 * if the old model's profile is still in `KNOWN`. Never remove a profile.
 */
export const DEFAULT_EMBEDDING_MODEL = ARCTIC_EMBED_M;

const KNOWN = new Map([ARCTIC_EMBED_M, MINILM_L6].map((profile) => [profile.id, profile]));

/** Whether vectors built by `id` can still be queried correctly. */
export function isKnownEmbeddingModel(id: string): boolean {
  return KNOWN.has(id);
}

/**
 * A developer override for the target encoder, to exercise an upgrade in a
 * real build without shipping one: `localStorage["thesis.search.semanticModel"]`
 * set to a known id. Anything else is ignored.
 */
export function targetEmbeddingModel(): EmbeddingModelProfile {
  try {
    const override = localStorage.getItem("thesis.search.semanticModel");
    if (override && KNOWN.has(override)) return KNOWN.get(override)!;
  } catch {
    /* no storage: the default */
  }
  return DEFAULT_EMBEDDING_MODEL;
}

/**
 * What to do with stored vectors when the arm starts.
 *
 * `reuse` — same encoder, sync what changed. `swap` — a different encoder the
 * app still knows: serve with it while the target embeds, then swap. `rebuild`
 * — nothing stored, or vectors from an encoder nobody can load any more.
 */
export function planEmbeddingStart(storedModel: string | null, target: string): "reuse" | "swap" | "rebuild" {
  if (storedModel === null) return "rebuild";
  if (storedModel === target) return "reuse";
  return KNOWN.has(storedModel) ? "swap" : "rebuild";
}

/** A profile for any id; an unknown encoder gets symmetric mean pooling. */
export function embeddingProfile(id: string): EmbeddingModelProfile {
  return KNOWN.get(id) ?? { ...MINILM_L6, id };
}
