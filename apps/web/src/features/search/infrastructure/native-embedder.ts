import type { EmbedRequest, IEmbedder } from "@weaveforge/core";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { DEFAULT_EMBEDDING_MODEL, embeddingProfile, type EmbeddingModelProfile } from "./embedding-models";

/**
 * `IEmbedder` over the desktop shell's native encoder.
 *
 * The shell runs the model through its own commands, so there is no worker and
 * no weight download here. Same surface as `WorkerEmbedder`, so the search code
 * above does not care which one it got.
 */

export type NativeEmbedBridge = Required<Pick<DesktopBridge, "embedLoad" | "embedTexts">> &
  Pick<DesktopBridge, "onEmbedProgress">;

export interface NativeEmbedderOptions {
  /** Model repository id, as for `WorkerEmbedder`. */
  model?: string;
  /** Bytes downloaded so far, for the settings panel. */
  onProgress?(loaded: number, total: number): void;
}

/** The shell's encoder, when this build has one; null in the browser. */
export function nativeEmbedBridge(bridge: DesktopBridge | null = desktop()): NativeEmbedBridge | null {
  return bridge && typeof bridge.embedLoad === "function" && typeof bridge.embedTexts === "function"
    ? (bridge as NativeEmbedBridge)
    : null;
}

export class NativeEmbedder implements IEmbedder {
  readonly id: string;
  dimensions = 0;
  /** Where "related" starts on this model's cosine scale. */
  readonly minScore: number;
  private readonly profile: EmbeddingModelProfile;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly bridge: NativeEmbedBridge,
    private readonly options: NativeEmbedderOptions = {},
  ) {
    this.profile = options.model ? embeddingProfile(options.model) : DEFAULT_EMBEDDING_MODEL;
    this.id = this.profile.id;
    this.minScore = this.profile.minScore;
  }

  /**
   * Load the shell's model once, shared by every caller. A failure clears the
   * promise so the next call retries, as `WorkerEmbedder` does.
   */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = this.start();
    this.ready = ready;
    // Clear only our own promise: a later load must not be dropped by an older failure.
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  async embed(request: EmbedRequest): Promise<Float32Array[]> {
    if (request.signal?.aborted) throw abortReason(request.signal);
    if (request.texts.length === 0) return [];
    await this.load();
    const rows = await this.bridge.embedTexts([...request.texts], request.kind);
    if (request.signal?.aborted) throw abortReason(request.signal);
    if (rows.length !== request.texts.length)
      throw new Error("The encoder returned the wrong number of vectors.");
    return rows.map((row) => new Float32Array(row));
  }

  /** The shell owns the model's memory, so there is nothing to release here. */
  dispose(): void {}

  private async start(): Promise<void> {
    // Subscribed before `embedLoad` so progress from the first byte is not lost.
    const unsubscribe = this.bridge.onEmbedProgress?.((loaded, total) =>
      this.options.onProgress?.(loaded, total),
    );
    try {
      const { dimensions } = await this.bridge.embedLoad(this.profile.id);
      this.dimensions = dimensions;
    } finally {
      unsubscribe?.();
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The request was aborted.", "AbortError");
}
