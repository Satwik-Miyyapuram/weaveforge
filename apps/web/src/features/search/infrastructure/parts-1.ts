import { readyCore } from "@/lib/rust-core";
import { readStored } from "@/lib/safe-storage";
import type { SearchSettings, WorkspaceSnapshot } from "@weaveforge/core";
import { idbSetSearchIndex } from "./parts-3";
import type { BuildIndexRequest, BuildIndexResponse } from "./search-index-worker";

// --- embedding-models ---
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

/**
 * A developer override for the target encoder, to exercise an upgrade in a
 * real build without shipping one: `localStorage["thesis.search.semanticModel"]`
 * set to a known id. Anything else is ignored.
 */
export function targetEmbeddingModel(): EmbeddingModelProfile {
  const override = readStored("thesis.search.semanticModel");
  if (override && KNOWN.has(override)) return KNOWN.get(override)!;
  return DEFAULT_EMBEDDING_MODEL;
}

/** A profile for any id; an unknown encoder gets symmetric mean pooling. */
export function embeddingProfile(id: string): EmbeddingModelProfile {
  return KNOWN.get(id) ?? { ...MINILM_L6, id };
}

// --- index-builder ---
/**
 * Running an index build in a worker, with an in-thread fallback.
 *
 * The fallback matters: a browser without workers, or a bundler configuration
 * that fails to emit one, must still get a working search rather than none.
 * Callers see one promise either way and cannot tell which path ran.
 */

export interface BuildResult {
  serialized: string;
  revision: string;
  documentCount: number;
  pdfPageCounts: [string, number][];
  annotationCount: number;
}

export function supportsIndexWorker(): boolean {
  return typeof Worker !== "undefined";
}

let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  worker ??= new Worker(new URL("./search-index-worker.ts", import.meta.url));
  return worker;
}

/** Free the worker's memory once a session is done with it. */
function disposeIndexWorker(): void {
  worker?.terminate();
  worker = null;
}

export function buildIndexInWorker(
  snapshot: WorkspaceSnapshot,
  projectId: string | null,
  settings: SearchSettings | undefined,
): Promise<BuildResult> {
  const instance = ensureWorker();
  const id = nextId++;

  return new Promise<BuildResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent<BuildIndexResponse>) => {
      if (event.data.id !== id) return;
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
      if (event.data.type === "error") reject(new Error(event.data.message));
      else resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
      // A worker that failed to start will fail again; drop it so the next
      // build takes the in-thread path rather than retrying a dead one.
      disposeIndexWorker();
      reject(new Error(event.message || "The index worker failed."));
    };

    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError);
    instance.postMessage({ id, snapshot, projectId, settings } satisfies BuildIndexRequest);
  });
}

// --- index-cache-policy ---
/**
 * Whether an index is worth persisting, and where.
 *
 * The cache is not free: a 15 000-document index serializes to about 110 MB.
 * In an installed app that is a reasonable thing to keep — it is the user's own
 * device, they chose to install, and the payoff is a cold start that rehydrates
 * in half a second instead of rebuilding for ten. In a browser tab it is not:
 * the visit may be a one-off on a shared or borrowed machine, storage there is
 * evictable under pressure anyway, and writing a hundred megabytes to earn a
 * cache the browser may drop before the next visit is a bad trade.
 *
 * So the rule is by surface, not by device. Installed app: persist whatever it
 * is. Website: persist up to a threshold, and above it rebuild each session —
 * which, now that the build happens in a worker, costs background time rather
 * than a frozen tab.
 */

/**
 * Is this the installed app rather than a browser tab?
 *
 * Three signals because no single one covers every platform: the standard
 * display-mode query (installed PWAs and TWAs on desktop and Android), the
 * legacy iOS Safari flag, and the Android TWA referrer, which is the only tell
 * when a trusted web activity has not yet matched the display mode.
 */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.matchMedia?.("(display-mode: fullscreen)").matches) return true;
    if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
    return document.referrer.startsWith("android-app://");
  } catch {
    return false;
  }
}

export function shouldPersistIndex(documentCount: number): boolean {
  return readyCore().shouldPersistIndex(isInstalledApp(), documentCount);
}

/**
 * Persist an index, if this surface should.
 *
 * The payload is a thunk rather than a string so a build that will not be
 * cached never serializes at all — serializing is itself a second-scale stall
 * on a large corpus, and paying it to then discard the result is the worst of
 * both.
 */
export async function persistSearchIndex(
  projectId: string | null,
  serialize: () => string,
  documentCount: number,
): Promise<void> {
  if (!shouldPersistIndex(documentCount)) return;
  await idbSetSearchIndex(projectId, serialize());
}
