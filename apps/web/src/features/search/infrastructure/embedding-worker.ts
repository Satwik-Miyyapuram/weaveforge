/// <reference lib="webworker" />

/**
 * Sentence encoder, off the main thread.
 *
 * A worker rather than an idle callback because this is not a task that yields:
 * one forward pass through a transformer is tens of milliseconds of solid
 * arithmetic, and a corpus is thousands of them. On the render thread that is
 * not jank, it is a frozen tab.
 *
 * The library is imported inside the worker and nowhere else, so the encoder
 * runtime never enters the main bundle. Nobody who leaves semantic search off
 * pays a byte for it.
 */

export interface EmbedWorkerRequest {
  id: number;
  type: "load" | "embed";
  model?: string;
  /** Where the weights come from; overridable for a mirror or a self-host. */
  host?: string;
  texts?: string[];
  /** Sentence encoders are trained with different prefixes for the two roles. */
  kind?: "passage" | "query";
}

export type EmbedWorkerResponse =
  | { id: number; type: "ready"; dimensions: number }
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "vectors"; vectors: Float32Array[] }
  | { id: number; type: "error"; message: string };

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array | number[] }>;

let extractor: FeatureExtractor | null = null;
let dimensions = 0;

const post = (message: EmbedWorkerResponse) => (self as unknown as Worker).postMessage(message);

async function load(id: number, model: string, host?: string): Promise<void> {
  // Dynamic, so the runtime is fetched only once someone turns this on.
  const transformers = await import("@huggingface/transformers");
  const env = (transformers as unknown as { env: Record<string, unknown> }).env;
  if (host) env.remoteHost = host;
  // There is no filesystem here; weights come over the network and are then
  // held by the browser's HTTP cache.
  env.allowLocalModels = false;

  const pipeline = (transformers as unknown as {
    pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<FeatureExtractor>;
  }).pipeline;

  extractor = await pipeline("feature-extraction", model, {
    // Quantized weights: a quarter of the download for a difference in ranking
    // that does not survive contact with a real corpus.
    dtype: "q8",
    progress_callback: (report: { status?: string; loaded?: number; total?: number }) => {
      if (report.status === "progress" && report.total) {
        post({ id, type: "progress", loaded: report.loaded ?? 0, total: report.total });
      }
    },
  });

  const probe = await extractor(["dimension probe"], { pooling: "mean", normalize: true });
  dimensions = probe.dims[probe.dims.length - 1] ?? 0;
  post({ id, type: "ready", dimensions });
}

async function embed(id: number, texts: string[], kind: "passage" | "query"): Promise<void> {
  if (!extractor) throw new Error("The encoder is not loaded.");

  // Symmetric encoders want the same treatment for both sides; the prefix is
  // where an asymmetric model would be told which side it is looking at.
  const prepared = kind === "query" ? texts.map((text) => text.trim()) : texts;
  const output = await extractor(prepared, { pooling: "mean", normalize: true });

  const flat = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
  const width = output.dims[output.dims.length - 1] ?? dimensions;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(flat.slice(i * width, (i + 1) * width));
  }
  post({ id, type: "vectors", vectors });
}

self.addEventListener("message", (event: MessageEvent<EmbedWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "load") {
        await load(request.id, request.model ?? "Xenova/all-MiniLM-L6-v2", request.host);
      } else {
        await embed(request.id, request.texts ?? [], request.kind ?? "passage");
      }
    } catch (error) {
      post({
        id: request.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
