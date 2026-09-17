/**
 * The pen's message protocol: samples to the worker, events back, no per-sample
 * allocation (§6.2.13).
 *
 * A 240 Hz digitiser produces thousands of samples a second. Building an object
 * per sample on the main thread and `postMessage`-ing it is real garbage — enough
 * transient allocation to trigger a minor GC on the thread that must not hitch,
 * because a 2–5 ms pause there is a dropped frame on the pen path.
 *
 * So the protocol is a plain `Float32Array` of `[x, y, pressure, t]` quadruples,
 * filled in place and posted **once per animation frame**. `getCoalescedEvents()`
 * has already collapsed the digitiser's burst into one dispatch, so that is ~120
 * transfers a second rather than 240+.
 *
 * **A transferred buffer is gone.** `postMessage(buffer, [buffer])` *neuters* the
 * sender's array: it becomes a zero-length view over a detached buffer, and
 * reading or writing it afterwards fails silently — a stroke that simply stops.
 * The plan names this trap, and {@link InkSamplePool} with {@link InkSampleWriter}
 * is the answer: the writer hands over a buffer and immediately takes another,
 * so it never holds one it does not own, and the buffer it handed over comes back
 * through the pool when the worker is done with it. `capture-protocol.test.ts`
 * asserts all three halves — the handed-over buffer is detached, the writer's next
 * buffer is a different allocation, and the pool refuses to re-issue detached
 * memory.
 */

import type { InkColour, InkPage } from "@weaveforge/core";

import type { InkPalette } from "../render/ink-palette";

/** `x, y, pressure, t` per sample. */
export const INK_SAMPLE_STRIDE = 4;

/** Samples one batch buffer holds. 512 is ~2 seconds of a 240 Hz pen. */
export const INK_SAMPLE_CAPACITY = 512;

/** Where a sample batch came from, so the worker can tell two pens apart. */
export interface InkStrokeHeader {
  /** Monotonic per session; the worker keys its live stroke on it. */
  strokeId: number;
  pageIndex: number;
  /** The nib the ink bar chose, in 0.1 mm, before pressure and velocity. */
  width: number;
  tool: "pen" | "highlighter" | "shape";
  /** The palette name the stroke paints with. Never a hex: the shader indexes it. */
  colour: InkColour;
}

/** Messages the main thread sends the worker. */
export type InkWorkerMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas | null;
      width: number;
      height: number;
      dpr: number;
      /**
       * Whether the sender transferred its buffers, and therefore expects them
       * back. In clone mode the memory never left the main thread, so returning
       * it would let the pool hand out an array that is still in use there.
       */
      mode: InkTransferMode;
      /**
       * The codec the worker decodes chunks with.
       *
       * A name rather than a function, because a function cannot cross a worker
       * boundary. `deflate-raw` is what the web build can reach — `CompressionStream`
       * does not expose brotli — and `identity` decodes a chunk stored raw, which is
       * what a small page is (§4.3).
       */
      codec?: "identity" | "deflate-raw";
      /**
       * Whether the Delegated Ink Trail is drawing the wet tail.
       *
       * It chooses the context's `desynchronized` attribute, which is immutable, so
       * it has to be known before the first `getContext` (§6.2.6, §6.2.8).
       */
      delegating?: boolean;
    }
  | { type: "stroke-begin"; header: InkStrokeHeader; sample: InkSamplePayload }
  | {
      type: "samples";
      header: InkStrokeHeader;
      sample: InkSamplePayload;
      predicted?: boolean;
    }
  | { type: "stroke-end"; header: InkStrokeHeader; sample: InkSamplePayload }
  | { type: "samples-returned"; buffers: ArrayBuffer[] }
  | { type: "viewport"; transform: InkViewportTransform }
  | { type: "resize"; width: number; height: number; dpr: number }
  /**
   * Load a page's stored geometry.
   *
   * The bytes, not a parsed page: the worker is the thing that decodes them, and
   * sending the chunk keeps the decode off the main thread as §6.2.2 requires.
   * `chunk` is null for a note with no sidecar — a valid empty ink note.
   */
  | {
      type: "load-page";
      pageIndex: number;
      /** One compressed chunk, exactly as the sidecar holds it. */
      chunk: Uint8Array | null;
    }
  /** Erase along a swept segment, in page units. */
  | {
      type: "erase";
      from: { x: number; y: number };
      to: { x: number; y: number };
    }
  /** Undo or redo one erase, by the stroke indices it took. */
  | { type: "undo" }
  | { type: "redo" }
  /**
   * Render the page to a PNG at `scale`. `transparent` omits the sheet of
   * white behind the ink: the caller is composing the page over the paper
   * itself — figures first, then this — because figures are DOM the worker
   * does not know about.
   */
  | { type: "export-page"; requestId: number; scale: number; transparent?: boolean }
  /**
   * The current page's background image — an inserted PDF page's raster
   * (§4.8) — or `null` for none. Sent by the host after every `load-page`,
   * since the image lives in the vault and the host is what can fetch it. The
   * bitmap is transferred; the worker owns it from here.
   *
   * `index` is the same attachment's 1-based position in the body
   * (`inkAttachmentIndex`), which the chunk header carries. The worker keeps
   * it on the page so a save that follows — the first stroke drawn over the
   * image — writes the index back instead of zeroing it.
   */
  | { type: "set-background"; image: ImageBitmap | null; index?: number }
  /** The theme's ink colours, read off the document by the host (§6.1). */
  | { type: "palette"; colours: InkPalette }
  /**
   * Pack the page into a chunk, exactly as the sidecar stores it.
   *
   * Encoding happens here for the same reason decoding does: the worker holds the
   * geometry, and `encodeInkChunk` on the main thread would mean shipping every
   * point across first. The reply is `page-saved`.
   */
  | { type: "save-page"; requestId: number }
  /** The page as a model, for recognition on the main thread. Reply: `page-model`. */
  | { type: "page-model"; requestId: number }
  /**
   * Replace the page wholesale, after recognition reordered its strokes into
   * line order and attached the line table (§5.4). Undo history is cleared: the
   * indices it holds no longer name the same strokes.
   */
  | { type: "replace-page"; page: InkPage }
  /** Select the strokes inside a closed polygon, in page units. Reply: `selected`. */
  | { type: "lasso"; polygon: number[] }
  | { type: "select-clear" }
  /** Remove the selected strokes, as one undoable step. */
  | { type: "delete-selection" }
  /**
   * Show the selection shifted by `dx, dy` page units while it is being dragged.
   * Nothing moves in the buffer; `move-selection` lands it.
   */
  | { type: "drag-selection"; dx: number; dy: number }
  /** Translate the selected strokes, in page units, as one undoable step. */
  | { type: "move-selection"; dx: number; dy: number }
  | { type: "dispose" };

/** What one posted batch looks like: a view plus how much of it is used. */
export interface InkSamplePayload {
  buffer: Float32Array;
  /** Samples used, not elements. Multiply by {@link INK_SAMPLE_STRIDE} for length. */
  count: number;
}

/** The projection the worker draws through, re-posted whenever it changes. */
export interface InkViewportTransform {
  /** CSS pixels per 0.1 mm unit. */
  scale: number;
  offsetX: number;
  offsetY: number;
  devicePixelRatio: number;
}

/** Messages the worker sends the main thread. All are tiny, none are per-sample. */
export type InkWorkerEvent =
  | { type: "ready"; backend: "webgl2" | "canvas2d" | "none" }
  | { type: "frame"; frame: number; strokeId: number }
  | {
      type: "stroke-committed";
      header: InkStrokeHeader;
      points: Float32Array;
      pressures: Uint8Array;
    }
  | { type: "samples-returned"; buffers: ArrayBuffer[] }
  /** What the worker is doing, for the status bar: counts and the backend. */
  | {
      type: "page-state";
      pageIndex: number;
      strokes: number;
      segments: number;
      backend: string;
      /** The page's size in 0.1 mm: an inserted PDF page keeps its own aspect. */
      width: number;
      height: number;
    }
  /** The strokes an erase removed, so the screen can undo it. */
  | { type: "erased"; indices: number[] }
  /** A PNG for `export-page`, as an encoded blob. */
  | { type: "exported"; requestId: number; png: Blob | null }
  /** The chunk for `save-page`, or `null` when the page has no live strokes. */
  | {
      type: "page-saved";
      requestId: number;
      pageIndex: number;
      bytes: Uint8Array | null;
      strokes: number;
    }
  /** The page as a model, for `page-model`. */
  | { type: "page-model"; requestId: number; pageIndex: number; page: InkPage }
  /** What the lasso took: stroke indices and their union bounds, `[]` when nothing. */
  | {
      type: "selected";
      indices: number[];
      bounds: [number, number, number, number] | null;
    }
  /** The page's undo depth changed, so the bar can enable its buttons. */
  | { type: "history"; undo: number; redo: number }
  | { type: "context-lost" }
  | { type: "context-restored"; backend: "webgl2" | "canvas2d" | "none" }
  /** The last thing the worker says: every save it had in flight has gone out. */
  | { type: "disposed" }
  | { type: "error"; message: string };

/** How a flushed buffer reaches the worker. */
export type InkTransferMode =
  /** Hand over ownership; the worker returns the buffer through the pool. */
  | "transfer"
  /** Structured-clone it; the sender keeps its buffer and refills immediately. */
  | "clone";

export interface InkSamplePoolOptions {
  /** Buffers to keep for reuse. Beyond this, a released buffer is dropped. */
  capacity?: number;
}

/**
 * Recycles sample buffers between the main thread and the worker.
 *
 * Both directions matter: the main thread needs a buffer per frame, and the
 * worker hands the memory back rather than letting 120 allocations a second
 * accumulate into a collection pause. A buffer still in flight is simply not in
 * the free list, so it cannot be handed out twice — which is the whole of the
 * "do not reuse a buffer you transferred" rule, expressed as a data structure
 * rather than as a comment.
 */
export class InkSamplePool {
  private readonly free: Float32Array[] = [];
  private readonly capacity: number;

  /** Buffers allocated in total. The allocation test counts this. */
  created = 0;

  constructor(options: InkSamplePoolOptions = {}) {
    this.capacity = options.capacity ?? 4;
  }

  /** How many buffers are waiting to be reused. */
  get available(): number {
    return this.free.length;
  }

  /** A buffer to fill, from the free list or freshly allocated. */
  acquire(samples = INK_SAMPLE_CAPACITY): Float32Array {
    const buffer = this.free.pop();
    if (buffer && buffer.length >= samples * INK_SAMPLE_STRIDE) return buffer;
    this.created += 1;
    return new Float32Array(samples * INK_SAMPLE_STRIDE);
  }

  /**
   * Give a buffer back.
   *
   * A detached buffer — one whose memory was transferred and not yet returned —
   * is dropped rather than kept: pooling it would hand out an array that cannot
   * be written, which is the failure this class exists to prevent.
   */
  release(buffer: Float32Array | ArrayBufferLike): void {
    const candidate =
      buffer instanceof Float32Array ? buffer : safeView(buffer);
    if (!candidate || candidate.length === 0) return;
    if (this.free.length >= this.capacity) return;
    this.free.push(candidate);
  }

  /** Forget every pooled buffer, closing a session. */
  clear(): void {
    this.free.length = 0;
  }
}

/** A view over a raw buffer, or `null` when it can no longer be viewed. */
function safeView(buffer: ArrayBufferLike): Float32Array | null {
  try {
    return new Float32Array(buffer as ArrayBuffer);
  } catch {
    return null;
  }
}

/**
 * A buffer being filled with samples, and the discipline that keeps it usable.
 *
 * The writer owns exactly one buffer at a time. {@link flush} either transfers it
 * — and immediately takes another from the pool, so the writer never holds a
 * detached array — or structured-clones it, in which case the same memory is
 * simply refilled. Which of the two is a runtime decision (the plan ships option
 * 1 with option 2's buffer discipline, because `SharedArrayBuffer` needs COOP/COEP
 * headers this app does not send) and the failure both prevent is identical: a
 * stroke that silently stops after one batch.
 */
export class InkSampleWriter {
  private buffer: Float32Array;
  private used = 0;
  /** Batches handed over, so a test can count transfers rather than guess. */
  flushes = 0;
  /** The most recent buffer handed to the worker, for the detachment test. */
  lastHandedOff: Float32Array | null = null;

  constructor(
    private readonly options: {
      pool: InkSamplePool;
      mode?: InkTransferMode;
      post: (message: InkWorkerMessage, transfer: Transferable[]) => void;
      capacity?: number;
    },
  ) {
    this.buffer = options.pool.acquire(options.capacity);
  }

  /** Samples written into the current buffer. */
  get pending(): number {
    return this.used;
  }

  /** The current buffer, which the writer owns and may read. */
  get current(): Float32Array {
    return this.buffer;
  }

  /** Whether the writer's current buffer can still be written. */
  get usable(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Append one sample, flushing first if the buffer is full.
   *
   * Throws rather than dropping when the current buffer is detached: a write into
   * detached memory does nothing at all, so the only visible symptom would be a
   * stroke missing its tail.
   */
  push(
    x: number,
    y: number,
    pressure: number,
    t: number,
    header: InkStrokeHeader,
  ): void {
    if (this.buffer.length === 0) {
      throw new Error(
        "ink: wrote a sample into a buffer that was transferred to the worker",
      );
    }
    if (this.used >= (this.options.capacity ?? INK_SAMPLE_CAPACITY)) {
      this.flush("samples", header);
    }
    const at = this.used * INK_SAMPLE_STRIDE;
    this.buffer[at] = x;
    this.buffer[at + 1] = y;
    this.buffer[at + 2] = pressure;
    this.buffer[at + 3] = t;
    this.used += 1;
  }

  /**
   * Hand the pending samples to the worker and start a fresh buffer.
   *
   * Called once per animation frame by `use-pen-capture`, and from a full-buffer
   * push. With nothing pending and `kind === "samples"` this does nothing at all,
   * so a frame where the pen did not move costs no message.
   *
   * The **whole** capacity buffer is what travels, not the used prefix: the
   * capacity is the unit the pool recycles, and a view shorter than the buffer it
   * came from would come back as a different size.
   */
  flush(
    kind: "samples" | "stroke-begin" | "stroke-end",
    header: InkStrokeHeader,
    predicted = false,
  ): void {
    // Nothing pending: a frame with no movement costs no message, and a stroke
    // whose first sample never landed on the page must not be begun at all.
    // `stroke-end` is the exception — the worker needs it even when every sample
    // went out in earlier batches, or the stroke would never be committed.
    if (this.used === 0 && kind !== "stroke-end") return;
    if (this.buffer.length === 0) {
      throw new Error(
        "ink: flushed a buffer that was transferred to the worker",
      );
    }

    const payload: InkSamplePayload = { buffer: this.buffer, count: this.used };
    // `Transferable` is an `ArrayBuffer`, and this is one: the only other thing a
    // typed array's `.buffer` can be is a `SharedArrayBuffer`, which needs
    // COOP/COEP headers this app does not send (§6.2.13).
    const transfer =
      this.options.mode === "transfer"
        ? [this.buffer.buffer as ArrayBuffer]
        : [];
    this.options.post(
      kind === "samples"
        ? { type: kind, header, sample: payload, predicted }
        : { type: kind, header, sample: payload },
      transfer,
    );
    this.flushes += 1;
    this.used = 0;

    // Transferred memory has left, so the writer takes another buffer; cloned
    // memory never left, so the same one is simply refilled and a long stroke
    // allocates exactly once.
    if (transfer.length > 0) {
      this.lastHandedOff = payload.buffer;
      this.buffer = this.options.pool.acquire(this.options.capacity);
    }
  }
}

/** The worker's side: read a payload's samples by index, allocating nothing. */
export function readInkSamples(payload: InkSamplePayload): {
  count: number;
  x: (index: number) => number;
  y: (index: number) => number;
  pressure: (index: number) => number;
  t: (index: number) => number;
} {
  const { buffer, count } = payload;
  return {
    count,
    x: (index) => buffer[index * INK_SAMPLE_STRIDE]!,
    y: (index) => buffer[index * INK_SAMPLE_STRIDE + 1]!,
    pressure: (index) => buffer[index * INK_SAMPLE_STRIDE + 2]!,
    t: (index) => buffer[index * INK_SAMPLE_STRIDE + 3]!,
  };
}

/**
 * A walk over a payload's samples, allocating nothing.
 *
 * The worker's loop appends a batch to the live stroke's geometry at 120 Hz; an
 * iterator that allocated a sample object per point would be the same garbage
 * this protocol exists to avoid, one thread over.
 */
export function eachInkSample(
  payload: InkSamplePayload,
  visit: (x: number, y: number, pressure: number, t: number) => void,
): void {
  const { buffer, count } = payload;
  for (let index = 0; index < count; index += 1) {
    const at = index * INK_SAMPLE_STRIDE;
    visit(buffer[at]!, buffer[at + 1]!, buffer[at + 2]!, buffer[at + 3]!);
  }
}
