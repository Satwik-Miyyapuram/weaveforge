import type { EmbedRequest, IEmbedder } from "@weaveforge/core";
import type { EmbedWorkerRequest, EmbedWorkerResponse } from "./embedding-worker";

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

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

export class WorkerEmbedder implements IEmbedder {
  readonly id: string;
  dimensions = 0;

  private worker: Worker | null = null;
  private nextId = 1;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (value: EmbedWorkerResponse) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly options: WorkerEmbedderOptions = {}) {
    this.id = options.model ?? DEFAULT_MODEL;
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
    await this.load();

    const response = await this.send({
      type: "embed",
      texts: [...request.texts],
      kind: request.kind,
    });
    if (response.type !== "vectors") throw new Error("The encoder returned no vectors.");
    return response.vectors;
  }

  /** Release the model's memory; the next `load()` fetches from the HTTP cache. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const { reject } of this.pending.values()) reject(new Error("The encoder was stopped."));
    this.pending.clear();
  }

  private async start(): Promise<void> {
    this.worker = new Worker(new URL("./embedding-worker.ts", import.meta.url));
    this.worker.addEventListener("message", (event: MessageEvent<EmbedWorkerResponse>) => {
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
    });

    const response = await this.send({
      type: "load",
      model: this.options.model ?? DEFAULT_MODEL,
      host: this.options.host,
    });
    if (response.type !== "ready") throw new Error("The encoder failed to start.");
    this.dimensions = response.dimensions;
  }

  private send(request: Omit<EmbedWorkerRequest, "id">): Promise<EmbedWorkerResponse> {
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
