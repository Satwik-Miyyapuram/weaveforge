import type { EmbedRequest, IEmbedder } from "@weaveforge/core";
import type {
  EmbedWorkerRequest,
  EmbedWorkerResponse,
} from "./embedding-worker";
import { DEFAULT_EMBEDDING_MODEL, embeddingProfile, type EmbeddingModelProfile } from "./embedding-models";

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
const IDLE_EVICT_MS = 5 * 60_000;

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
   * caching a rejection would make a transient network error permanent.
   */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.start().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
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
    }, IDLE_EVICT_MS);
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

/** Whether this browser can run the encoder at all. */
export function supportsLocalEmbedding(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

/**
 * Where the weights come from when nobody has said.
 *
 * The desktop build serves them from its own data directory, filling it from
 * upstream the first time. That is what makes the feature keep working with
 * the network unplugged; a browser copy has no such folder and uses the
 * encoder library's own default host.
 */
function cachedWeightHost(): string | undefined {
  return typeof location !== "undefined" && location.protocol === "app:"
    ? "app://models"
    : undefined;
}
