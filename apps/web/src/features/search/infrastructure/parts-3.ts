import { openAppDb, openAppDb as openDb, SEARCH_STORE, VECTOR_STORE } from "@/lib/cache/parts-1";
import { warnOnce } from "@/lib/error-report/parts";
import { formatError } from "@/lib/format-error";
import { loadCore, readyCore } from "@/lib/rust-core";
import type { SearchDoc, SearchSettings, WorkspaceSnapshot } from "@weaveforge/core";
import type { EmbedRequest, IEmbedder } from "../application/parts";
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelProfile,
  embeddingProfile,
} from "./parts-1";
import type { EmbedWorkerRequest, EmbedWorkerResponse } from "./embedding-worker";
import { buildSearchIndex } from "./minisearch-index";
import { loadPdfTexts } from "./parts-2";

// --- search-index-idb ---
/**
 * Persistence for the serialized search index.
 *
 * A second store in the screen-cache database rather than a new dependency:
 * the existing raw-IndexedDB helper is ~100 lines and already handles the
 * open/upgrade dance, so Dexie would buy nothing here.
 *
 * Every operation is best-effort. A failed read costs one rebuild; a thrown
 * error would cost the user their search box.
 */
function searchCacheKey(projectId: string | null): string {
  return `${projectId ?? "-"}|index`;
}

export async function idbGetSearchIndex(projectId: string | null): Promise<string | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readonly");
      const req = tx.objectStore(SEARCH_STORE).get(searchCacheKey(projectId));
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSetSearchIndex(projectId: string | null, serialized: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readwrite");
      tx.objectStore(SEARCH_STORE).put(serialized, searchCacheKey(projectId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "The search index was not saved.", err);
    /* best-effort persistence */
  }
}

/**
 * Drop cached indexes. Called on logout: the index holds note bodies and paper
 * abstracts in full, so leaving it behind would keep workspace content readable
 * on a shared device after sign-out.
 */
export async function idbClearSearchIndexes(projectId?: string | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readwrite");
      const store = tx.objectStore(SEARCH_STORE);
      if (projectId === undefined) {
        store.clear();
      } else {
        store.delete(searchCacheKey(projectId ?? null));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "The search index was not cleared.", err);
    /* ignore */
  }
}

// --- vector-store-idb ---
/**
 * Persisted passage vectors.
 *
 * Worth storing because they are expensive to produce: a corpus that takes
 * minutes to embed should not be re-embedded because a tab was closed. Written
 * as one record per project holding a single byte buffer — thousands of small
 * rows would make the read slower than the arithmetic it saves.
 */

export interface StoredVectors {
  model: string;
  dimensions: number;
  /** The Rust index blob (`VectorIndex.toBytes`): ids and vectors together. */
  bytes: Uint8Array;
  /** Corpus fingerprint when stored. */
  revision: string;
  /** Per-document text hashes, so a reload re-embeds only what changed. */
  hashes?: Record<string, string>;
}

const key = (projectId: string | null) => projectId ?? "-";

export async function idbGetVectors(projectId: string | null): Promise<StoredVectors | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openAppDb();
    return await new Promise<StoredVectors | null>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readonly");
      const req = tx.objectStore(VECTOR_STORE).get(key(projectId));
      req.onsuccess = () => resolve((req.result as StoredVectors | undefined) ?? null);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

export async function idbSetVectors(
  projectId: string | null,
  value: StoredVectors,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readwrite");
      tx.objectStore(VECTOR_STORE).put(value, key(projectId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "Search vectors were not saved to browser storage.", err);
    /* best-effort: losing this costs a re-embed, never a result */
  }
}

/** Cleared on sign-out: vectors encode the content they were built from. */
export async function idbClearVectors(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readwrite");
      tx.objectStore(VECTOR_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "Search vectors were not cleared from browser storage.", err);
    /* ignore */
  }
}

// --- worker-embedder ---
/**
 * `IEmbedder` over the encoder worker.
 *
 * Requests are correlated by id and answered out of a pending map rather than
 * queued one at a time: loading the model and embedding a batch are both slow,
 * and serializing them would make a progress bar impossible to drive.
 */

export interface WorkerEmbedderOptions {
  /** Model repository id. Any sentence encoder in ONNX form works. */
  model?: string;
  /** Weight host, for a mirror or an air-gapped deployment. */
  host?: string;
  /** Bytes downloaded so far, for the settings panel. */
  onProgress?(loaded: number, total: number): void;
}


/**
 * How long the encoder sits unused before its worker is stopped. The weights
 * are 80–120 MB of WASM heap that nothing else can reclaim; the browser's HTTP
 * cache keeps the download, so the next `embed` pays only the model's start.
 */
export class WorkerEmbedder implements IEmbedder {
  readonly id: string;
  dimensions = 0;
  /** Where "related" starts on this model's cosine scale. */
  readonly minScore: number;
  private readonly profile: EmbeddingModelProfile;

  private worker: Worker | null = null;
  private nextId = 1;
  private ready: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: EmbedWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(private readonly options: WorkerEmbedderOptions = {}) {
    this.profile = options.model ? embeddingProfile(options.model) : DEFAULT_EMBEDDING_MODEL;
    this.id = this.profile.id;
    this.minScore = this.profile.minScore;
  }

  /**
   * Download and initialize the encoder.
   *
   * Idempotent and shared: several screens may ask at once, and the model must
   * be fetched once. A failure clears the promise so a retry is possible —
   * caching a rejection would make a transient network error permanent. The
   * half-started worker is stopped too, or it would hold its heap until the
   * tab closed. A load with no query after it (stored vectors all current)
   * starts the quiet period too, or the model would stay for the session.
   */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.start().then(
      () => this.scheduleIdle(),
      (error: unknown) => {
        this.dispose();
        throw error;
      },
    );
    return this.ready;
  }

  async embed(request: EmbedRequest): Promise<Float32Array[]> {
    if (request.texts.length === 0) return [];
    this.holdIdle();
    try {
      await this.load();
      const response = await this.send({
        type: "embed",
        texts: [...request.texts],
        kind: request.kind,
      });
      if (response.type !== "vectors")
        throw new Error("The encoder returned no vectors.");
      return response.vectors;
    } finally {
      this.scheduleIdle();
    }
  }

  /** Release the model's memory; the next `load()` fetches from the HTTP cache. */
  dispose(): void {
    this.holdIdle();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const { reject } of this.pending.values())
      reject(new Error("The encoder was stopped."));
    this.pending.clear();
  }

  /** No eviction while a request is in flight. */
  private holdIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Eviction after the quiet period, unless another request comes first. */
  private scheduleIdle(): void {
    this.holdIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) this.dispose();
    }, readyCore().embedIdleEvictMs());
  }

  private async start(): Promise<void> {
    /*
     * A static asset, not a bundler-resolved worker.
     *
     * This was `new Worker(new URL("./embedding-worker.ts", import.meta.url))`,
     * which is the documented Next.js shape and did not work here. Webpack
     * resolved `import.meta.url` to the source file's *filesystem path* on the
     * build machine, then passed its own runtime chunk to the `Worker`
     * constructor — and building that URL threw inside webpack's Trusted Types
     * shim, so the reader saw `e.replace is not a function` with no mention of
     * workers. See `scripts/build-embedding-worker.mjs` for the whole account.
     *
     * `/embedding-worker.js` is same-origin and absolute, which is also what lets
     * onnxruntime-web resolve its own `.wasm` next to it, and it keeps
     * Transformers.js — tens of megabytes — out of every route's JS graph.
     * `copy-pdf-worker.mjs` serves the pdf.js worker the same way, for the same
     * reason.
     */
    this.worker = new Worker("/embedding-worker.js", { type: "module" });
    this.worker.addEventListener(
      "message",
      (event: MessageEvent<EmbedWorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") {
          this.options.onProgress?.(message.loaded, message.total);
          return;
        }
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.type === "error") waiter.reject(new Error(message.message));
        else waiter.resolve(message);
      },
    );

    const response = await this.send({
      type: "load",
      model: this.id,
      pooling: this.profile.pooling,
      queryPrefix: this.profile.queryPrefix,
      passagePrefix: this.profile.passagePrefix,
      host: this.options.host ?? cachedWeightHost(),
    });
    if (response.type !== "ready")
      throw new Error("The encoder failed to start.");
    this.dimensions = response.dimensions;
  }

  private send(
    request: Omit<EmbedWorkerRequest, "id">,
  ): Promise<EmbedWorkerResponse> {
    const worker = this.worker;
    if (!worker) throw new Error("The encoder is not running.");

    const id = this.nextId++;
    return new Promise<EmbedWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id } satisfies EmbedWorkerRequest);
    });
  }
}

/**
 * Where the weights come from when nobody has said.
 *
 * The desktop build serves them from its own data directory, filling it from
 * upstream the first time. That is what makes the feature keep working with
 * the network unplugged; a browser copy has no such folder and uses the
 * encoder library's own default host.
 *
 * Under the page's own origin: `app:` is not a CORS-enabled scheme, so a fetch
 * to another `app:` host such as `app://models` is blocked before it is sent.
 */
function cachedWeightHost(): string | undefined {
  return typeof location !== "undefined" && location.protocol === "app:"
    ? `${location.origin}/models`
    : undefined;
}
