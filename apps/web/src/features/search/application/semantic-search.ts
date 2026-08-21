import { searchRevision, type SearchDoc } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { SemanticIndex, type EmbedProgress } from "./semantic-index";
import { WorkerEmbedder, supportsLocalEmbedding } from "../infrastructure/worker-embedder";
import { idbClearVectors, idbGetVectors, idbSetVectors } from "../infrastructure/vector-store-idb";

/**
 * Turning semantic search on and off.
 *
 * Opt-in, and the preference is the only thing persisted eagerly. Nothing is
 * downloaded, embedded, or stored until someone asks: a model is tens of
 * megabytes and a corpus is minutes of arithmetic, and neither is a cost to
 * impose on a user who never wanted the feature.
 */

const ENABLED_KEY = "thesis.search.semantic";

let embedder: WorkerEmbedder | null = null;
let semantic: SemanticIndex | null = null;
let building: Promise<void> | null = null;

export function semanticSupported(): boolean {
  return supportsLocalEmbedding();
}

export function semanticEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage disabled; the session still works, it just will not persist */
  }
}

export interface EnableOptions {
  onProgress?(progress: EmbedProgress): void;
  signal?: AbortSignal;
}

/**
 * Download the encoder, embed the corpus, and attach it to search.
 *
 * A stored index is reused when the model and the corpus fingerprint both
 * match. Either differing means the vectors describe something other than what
 * is on screen, and re-embedding is the only honest response — vectors from a
 * different encoder are not merely stale, they are meaningless.
 */
export async function enableSemanticSearch(options: EnableOptions = {}): Promise<void> {
  if (building) return building;
  building = run(options).finally(() => {
    building = null;
  });
  return building;
}

async function run(options: EnableOptions): Promise<void> {
  const container = getContainer();
  const projectId = container.projects.context.projectId;

  await container.search.ensure();
  const docs: readonly SearchDoc[] = container.search.indexedDocuments();
  const revision = searchRevision(docs);

  embedder ??= new WorkerEmbedder({
    onProgress: (loaded, total) => options.onProgress?.({ done: 0, total: 0, download: { loaded, total } }),
  });
  await embedder.load();

  semantic = new SemanticIndex(embedder);

  const stored = await idbGetVectors(projectId);
  const reused =
    stored?.revision === revision &&
    semantic.load({
      model: stored.model,
      dimensions: stored.dimensions,
      ids: stored.ids,
      vectors: stored.vectors,
    });

  if (!reused) {
    await semantic.build(docs, { onProgress: options.onProgress, signal: options.signal });
    const packed = semantic.serialize();
    if (packed) void idbSetVectors(projectId, { ...packed, revision });
  }

  container.search.setSemanticIndex(semantic);
  rememberPreference(true);
}

/**
 * Detach it and forget the vectors.
 *
 * The model itself is left in the browser's HTTP cache: turning the feature
 * back on should not re-download tens of megabytes, and the cache is the
 * browser's to evict.
 */
export async function disableSemanticSearch(): Promise<void> {
  getContainer().search.setSemanticIndex(null);
  semantic?.clear();
  semantic = null;
  embedder?.dispose();
  embedder = null;
  rememberPreference(false);
  await idbClearVectors();
}

/** Passages currently embedded, for the settings panel. */
export function semanticSize(): number {
  return semantic?.size ?? 0;
}
