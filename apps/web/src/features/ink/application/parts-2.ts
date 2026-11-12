import { readyCore, typedCore } from "@/lib/rust-core";
import {
  decodeInkChunk,
  encodeInkChunk,
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  type InkChunkCodec,
  type InkColour,
  type InkHand,
  type InkPaper,
  pageFromChunk,
} from "@weaveforge/core";
import type {
  FilteredNibSample as WasmFilteredNibSample,
  InkCaptureStream as WasmInkCaptureStream,
  NibFilter as WasmNibFilter,
  OneEuroFilter as WasmOneEuroFilter,
} from "@weaveforge/wasm";
import { createCanvas, openPdf, renderPdfPage, toPngBlob, toWebpBlob } from "./parts-3";
import type { PenPointerEvent } from "./use-pen-capture";

// --- native-bridge ---
/**
 * The native inking bridge (docs/internal/design/ink-native-bridges.md §1).
 *
 * A native shell — today the Android wrapper in `apps/android` — can lay a
 * hardware-rendered overlay over the page and take the stylus itself: the wet
 * stroke is drawn front-buffered at the digitiser's rate, the palm is refused
 * by the driver's own flags and by hover proximity, and when the pen lifts the
 * finished stroke comes back here as one flat array. The web app then runs the
 * same pipeline it runs for its own pointer events — the gate, the filter, the
 * worker — so the note is the same note whichever surface drew it.
 *
 * Nothing here is used unless the shell has installed itself on `window`; a
 * browser without a shell never sees any of it.
 */
/**
 * What the Android shell exposes through `addJavascriptInterface`. Only
 * primitives cross that boundary, which is why the viewport is five numbers
 * and not an object; the shape in the design note's §1.1 is realised by
 * {@link NativeInkBridge} on this side.
 */
interface AndroidInkingBridge {
  setViewport(
    left: number,
    top: number,
    width: number,
    height: number,
    dpr: number,
  ): void;
  clearViewport(): void;
  setTool(colourArgb: string, widthPx: number): void;
  setPenOnly(enabled: boolean): void;
  setHandedness(hand: string): void;
  clearOverlay(): void;
}

/** The shell, as the app sees it. */
export interface NativeInkBridge {
  readonly platform: "android";
  /** The ink page's box in CSS pixels; the overlay inks only inside it. */
  setViewport(box: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): void;
  /** No page on screen: every stylus event goes to the web view. */
  clearViewport(): void;
  setTool(input: {
    tool: "pen" | "highlighter";
    colour: InkColour;
    widthPx: number;
  }): void;
  setPenOnly(enabled: boolean): void;
  setHandedness(hand: InkHand): void;
  /** The overlay's wet stroke is gone; the worker has the committed one. */
  clearOverlay(): void;
}

/** The points a native stroke arrives as: `[x, y, pressure, t, …]` in view pixels. */
export type NativeStrokePoints = ArrayLike<number>;

declare global {
  interface Window {
    AndroidInkingBridge?: AndroidInkingBridge;
    onNativeStrokeComplete?: (points: NativeStrokePoints) => void;
  }
}

/** The bridge the shell installed, or `null` in a plain browser. */
export function nativeInkBridge(): NativeInkBridge | null {
  if (typeof window === "undefined") return null;
  const android = window.AndroidInkingBridge;
  if (!android || typeof android.setTool !== "function") return null;
  return {
    platform: "android",
    setViewport: (box) =>
      android.setViewport(
        box.left,
        box.top,
        box.width,
        box.height,
        window.devicePixelRatio || 1,
      ),
    clearViewport: () => android.clearViewport(),
    setTool: ({ tool, colour, widthPx }) =>
      android.setTool(
        argbHex(colour, tool === "highlighter" ? 0.35 : 1),
        widthPx,
      ),
    setPenOnly: (enabled) => android.setPenOnly(enabled),
    setHandedness: (hand) => android.setHandedness(hand),
    clearOverlay: () => android.clearOverlay(),
  };
}

/**
 * Install the handoff the shell calls on pen lift. Returns the uninstall; the
 * host mounts and unmounts it with the page, so a stroke arriving with no page
 * open is dropped rather than drawn on the wrong note.
 */
export function installNativeStrokeHandler(
  handler: (points: NativeStrokePoints) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.onNativeStrokeComplete = handler;
  return () => {
    if (window.onNativeStrokeComplete === handler)
      delete window.onNativeStrokeComplete;
  };
}

/**
 * A native stroke as the events the capture session already understands.
 *
 * The overlay's coordinates are view pixels from the window's top-left, which
 * is `clientX × dpr`; the timestamps are the device's uptime clock, which is
 * not `performance.now()`'s origin but is monotonic, and the filter only ever
 * looks at differences. Everything is a pen, since the overlay took nothing
 * else.
 */
export function nativeStrokeEvents(
  points: NativeStrokePoints,
  dpr: number,
  pointerId = -1,
): PenPointerEvent[] {
  // One wasm call per stroke at pen-lift: the scale, the pressure clamp and the
  // partial-tail drop are decided in Rust (`ink::native_stroke`).
  const samples = readyCore().inkFlatStrokeSamples(
    Float64Array.from(points),
    dpr,
  );
  const events: PenPointerEvent[] = [];
  for (let i = 0; i < samples.length; i += 4) {
    events.push({
      pointerId,
      pointerType: "pen",
      pressure: samples[i + 2]!,
      width: 1,
      height: 1,
      clientX: samples[i]!,
      clientY: samples[i + 1]!,
      t: samples[i + 3]!,
    });
  }
  return events;
}

/** `#AARRGGBB`, which is what Android's `Color.parseColor` reads. The Rust core's light theme. */
function argbHex(colour: InkColour, alpha: number): string {
  return readyCore().inkArgbHex(colour, alpha);
}

// --- one-euro-filter ---
/**
 * The 1-Euro filter: jitter damping that phases out with speed (D13).
 *
 * Revision 2 of the plan banned position filtering outright, on the grounds that
 * any filter adds lag to the pen. That is true of a *fixed* low-pass and false of
 * this one, which is why the plan retracted it. Casiez, Roussel and Vogel's
 * filter raises its own cutoff frequency with the signal's speed:
 *
 * ```
 * fc = minCutoff + beta · ‖dx/dt‖
 * ```
 *
 * so at the speed of deliberate writing the cutoff is a couple of hertz — which
 * damps a digitiser's grid quantisation and the hand's tremor — and at the speed
 * of a fast stroke it is hundreds of hertz, where the filter is very nearly the
 * identity and the lag is negligible. The result is a filter that is invisible
 * where lag would be felt and useful where staircasing would be seen.
 *
 * **One filter, one state.** The delegated trail needs a diameter *now* and the
 * worker needs the width it bakes into geometry. Filtering in two places — or in
 * one place and not the other — makes the wet tail and the dry ink disagree, and
 * the seam looks like a rendering bug rather than a data-flow one. So the filter
 * is created once, on the main thread, and the worker is handed its output.
 */
/** Cutoffs and speed coefficient for one channel. */
export interface OneEuroOptions {
  /**
   * Cutoff at zero speed, in hertz. Lower is smoother and laggier when the pen
   * is still — which is exactly when lag cannot be felt.
   */
  minCutoff: number;
  /**
   * How fast the cutoff rises with speed, in **hertz per (0.1 mm/ms)**.
   *
   * Not the paper's `0.007`. Casiez et al. state β against their own input units
   * (pixels per millisecond, and cursor speeds of a couple of those), and a
   * stroke here is measured in tenths of a millimetre, where handwriting runs at
   * 0.05–5 units/ms. Carrying 0.007 across would put the cutoff at 1.02 Hz at
   * 5 units/ms — the filter would damp a fast stroke exactly as hard as a still
   * pen, which is the lag revision 2 was right to fear. β is therefore tuned to
   * the *unit the samples are in*: see `position_options` in wf-core `ink::one_euro`.
   */
  beta: number;
  /** Cutoff for the internal derivative estimate, in hertz. */
  derivativeCutoff: number;
}

/**
 * One scalar channel, filtered. The state lives in the Rust core
 * (`ink::one_euro::OneEuroFilter`). The wasm handle is created on first use, not
 * in the constructor, so this class can be built before `loadCore()` resolves.
 */
export class OneEuroFilter {
  private core: WasmOneEuroFilter | undefined;

  constructor(private readonly options: OneEuroOptions) {}

  private get handle(): WasmOneEuroFilter {
    if (!this.core) this.core = new (readyCore().OneEuroFilter)(this.options);
    return this.core;
  }

  /** The last filtered value, or `null` before the first sample. */
  get last(): number | null {
    return this.handle.last;
  }

  /** The last estimated speed, in value units per millisecond. */
  get speed(): number {
    return this.handle.speed;
  }

  /** Forget everything. Called at pen-down: a new stroke is a new signal. */
  reset(): void {
    this.handle.reset();
  }

  filter(value: number, time: number): number {
    return this.handle.filter(value, time);
  }
}

/** One raw pen sample: position in 0.1 mm, pressure 0..1, time in ms. */
export interface NibSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

/** A filtered pen sample, with the velocity the taper reads. */
export type FilteredNibSample = WasmFilteredNibSample;

/**
 * Position and pressure filtered as one state (`ink::one_euro::NibFilter`).
 * Options default to the tuned position and pressure channels above.
 */
export class NibFilter {
  private core: WasmNibFilter | undefined;
  private readonly options: { position?: OneEuroOptions; pressure?: OneEuroOptions };

  /**
   * The wasm handle is created on first use, so construction may precede `loadCore()`.
   * Defaults are read on first use too, from the Rust core, never copied here.
   */
  constructor(
    options: { position?: OneEuroOptions; pressure?: OneEuroOptions } = {},
  ) {
    this.options = options;
  }

  private get handle(): WasmNibFilter {
    if (!this.core) {
      const core = readyCore();
      this.core = new core.NibFilter({
        position: this.options.position ?? core.inkPositionOptions(),
        pressure: this.options.pressure ?? core.inkPressureOptions(),
      });
    }
    return this.core;
  }

  /**
   * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
   * rather than filtered: the velocity taper is a drawing property.
   */
  get speed(): number {
    return this.handle.speed;
  }

  /** Start a new stroke: no state carries over from the last one. */
  reset(): void {
    this.handle.reset();
  }

  /** Snapshot the filter now; the returned function restores that snapshot. */
  save(): () => void {
    return this.handle.save();
  }

  filter(sample: NibSample): FilteredNibSample {
    return this.handle.filter(sample);
  }
}

/** Values per raw pointer sample: `x, y, pressure, t, timeStamp, flags` (`ink::capture`). */
export const CAPTURE_RAW_STRIDE = 6;
/** Raw flag: the stroke's first sample. Never de-duplicated. */
export const CAPTURE_FLAG_FIRST = 1;
/** Raw and output flag: a prediction. Moves the filter; never a real sample. */
export const CAPTURE_FLAG_PREDICTED = 2;
/** Raw and output flag: the dispatched event itself, not a coalesced one. */
export const CAPTURE_FLAG_DISPATCHED = 4;

/** One update's accepted samples, copied out of wasm. `samples` is `x, y, pressure, t` quadruples. */
export interface CaptureBatch {
  count: number;
  samples: Float64Array;
  flags: Uint8Array;
}

/**
 * The per-stroke capture filter (`ink::capture::CaptureStream`). Lazy like
 * {@link NibFilter}. One `consume` per pointer update, never per sample.
 */
export class CaptureStream {
  private core: WasmInkCaptureStream | undefined;

  private get handle(): WasmInkCaptureStream {
    if (!this.core) this.core = new (readyCore().InkCaptureStream)();
    return this.core;
  }

  /** A new stroke: the filter starts clean. */
  resetFilter(): void {
    this.handle.resetFilter();
  }

  /** The stroke ended or was dropped: the next sample is never a repeat of the last. */
  forgetLast(): void {
    this.handle.forgetLast();
  }

  /**
   * Filter one update. `raw` is flat `CAPTURE_RAW_STRIDE` values per sample, with
   * NaN for an absent `t`/`timeStamp` and for off-page coordinates; `now` is the
   * fallback time.
   */
  consume(raw: Float64Array, now: number): CaptureBatch {
    const batch = this.handle.consume(raw, now);
    try {
      return { count: batch.count, samples: batch.samples(), flags: batch.flags() };
    } finally {
      batch.free();
    }
  }
}

// --- page-background ---
/**
 * A page background from a file (§4.8, §5 of the explorer plan): a PDF page
 * or an image, laid on an A4 sheet.
 *
 * Every ink page is A4 — `INK_A4_WIDTH × INK_A4_HEIGHT` — so a note prints
 * as it is drawn and a stack of pages is one paper size. A source of another
 * shape is not stretched to fit: it is scaled to sit inside the sheet,
 * centred, on white. The placement is a pure function so a test can check it
 * without a canvas.
 *
 * The other half of the same subject is here too: the chunk a page is written
 * with when its background changes (§4.8's mirror of the text layer's
 * `![page background](vault:…)` in the sidecar's header) and the clipboard
 * payload a pasted screenshot arrives in.
 */
/** The sheet's raster: A4 at 200 dpi, 1654 × 2339. */
export const A4_RASTER_WIDTH = 1654;
export const A4_RASTER_HEIGHT = Math.round(
  (A4_RASTER_WIDTH * INK_A4_HEIGHT) / INK_A4_WIDTH,
);

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether `file` is something this can make a page of. */
export function isPageSource(file: { type: string; name: string }): boolean {
  return readyCore().inkIsPageSource(file.type, file.name);
}

export function isPdf(file: { type: string; name: string }): boolean {
  return readyCore().inkIsPdf(file.type, file.name);
}

/**
 * The A4 PNG for `file`: page `pdfPage` of a PDF, or the image itself. The
 * caller has already asked which page, when there is a choice.
 */
export async function pageBackgroundFromFile(
  file: File,
  pdfPage = 1,
): Promise<Blob> {
  if (isPdf(file)) {
    const bytes = await file.arrayBuffer();
    // Rendered at the sheet's width; a landscape page is then scaled down
    // to fit, which loses nothing at 200 dpi.
    const page = await renderPdfPage(bytes, pdfPage, A4_RASTER_WIDTH);
    return composeOnSheet(page, page.width, page.height);
  }
  if (typeof createImageBitmap !== "function")
    throw new Error("Images cannot be decoded here.");
  const image = await createImageBitmap(file);
  try {
    return await composeOnSheet(image, image.width, image.height);
  } finally {
    image.close();
  }
}

/**
 * The A4 PNGs for pages `numbers` of one PDF, in order. The document is parsed
 * once for all of them and closed when the caller stops, however it stops.
 */
export async function* pdfPageBackgrounds(
  bytes: ArrayBuffer,
  numbers: readonly number[],
  open: typeof openPdf = openPdf,
): AsyncGenerator<Blob> {
  const pdf = await open(bytes);
  try {
    for (const number of numbers) {
      const page = await pdf.render(number, A4_RASTER_WIDTH);
      yield await composeOnSheet(page, page.width, page.height);
    }
  } finally {
    await pdf.close();
  }
}

/**
 * An image file as an attachment of its *own* size — a figure, not a page.
 *
 * A page background is composed onto an A4 sheet because it is the page; a
 * figure is content placed *on* a page, so its bytes keep the image's own
 * shape and size and the placement is the note's text (§figure).
 *
 * The encoding is WebP where the browser can make one — half to two-thirds
 * of PNG for the photos and screenshots that get pasted in — and PNG where it
 * cannot. Safari's canvas answers a WebP request with PNG bytes, so the
 * extension follows what the bytes really are, never the request. Quality
 * 0.9 lossy is fine here: a figure sits on the page like a photograph pasted
 * in a notebook, it is not the layer the pen writes over.
 */
export async function figureImageFromFile(
  file: File,
): Promise<{ blob: Blob; ext: "webp" | "png" }> {
  if (isPdf(file)) throw new Error("A PDF is a page, not a figure.");
  if (typeof createImageBitmap !== "function")
    throw new Error("Images cannot be decoded here.");
  const image = await createImageBitmap(file);
  try {
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) throw new Error("A 2D context could not be created for the image.");
    context.drawImage(image, 0, 0);
    const { blob, type } = await toWebpBlob(canvas);
    return { blob, ext: type === "image/webp" ? "webp" : "png" };
  } finally {
    image.close();
  }
}

/**
 * An image file's pixel size, for a figure's first box: the placement is
 * chosen from the image's own aspect, so a portrait photo does not land in a
 * landscape frame.
 */
export async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const image = await createImageBitmap(file);
  try {
    return { width: image.width, height: image.height };
  } finally {
    image.close();
  }
}

async function composeOnSheet(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const sheet = createCanvas(A4_RASTER_WIDTH, A4_RASTER_HEIGHT);
  const context = sheet.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context) throw new Error("A 2D context could not be created for the page.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, A4_RASTER_WIDTH, A4_RASTER_HEIGHT);
  const box = readyCore().placeOnSheet(width, height, A4_RASTER_WIDTH, A4_RASTER_HEIGHT);
  context.drawImage(source, box.x, box.y, box.width, box.height);
  return toPngBlob(sheet);
}

/* -------------------------------------------------------------------------
 * The same fact in the sidecar's header
 * ---------------------------------------------------------------------- */

export interface PageBackgroundChunkOptions {
  /**
   * The 1-based attachment index for the page, or `0` for none — what
   * `inkAttachmentIndex` answers for the body the text layer made.
   */
  background: number;
  /** The page's paper, kept as the chunk had it. */
  paper: InkPaper;
  /**
   * The sheet to open with when the page has no chunk yet, in 0.1 mm. An
   * inserted PDF page keeps its own aspect ratio, so this is the page's size
   * and not always A4.
   */
  size?: { width: number; height: number };
  /** The codec the page's chunk is stored with; identity when absent. */
  codec?: InkChunkCodec;
}

/**
 * A page's chunk with its background set — strokes, lines and paper kept.
 *
 * The page's geometry comes from the chunk it already has, decoded and packed
 * again through core, so a background change cannot disturb a stroke: the only
 * field this decides is `background`. A page with no chunk yet is a blank one
 * at `size` (A4 when the caller does not say), which is the page an inserted
 * image becomes.
 *
 * This runs on the main thread on purpose. It is a background change — an
 * upload, a re-raster and a prompt already stand in front of it — and never
 * the pen path, which is the only place §6.2.2 forbids the work.
 */
export async function pageChunkWithBackground(
  chunk: Uint8Array | null,
  options: PageBackgroundChunkOptions,
): Promise<Uint8Array> {
  const { background, paper, size, codec } = options;
  const page = chunk
    ? pageFromChunk(await decodeInkChunk(chunk, codec))
    : {
        ...typedCore().blankInkPage(paper),
        ...typedCore().clampInkPageSize(
          size?.width ?? INK_A4_WIDTH,
          size?.height ?? INK_A4_HEIGHT,
        ),
      };
  return encodeInkChunk(
    {
      ...page,
      paper,
      background: Number.isFinite(background)
        ? Math.max(0, Math.min(255, Math.round(background)))
        : 0,
    },
    codec,
  );
}

/* -------------------------------------------------------------------------
 * A screenshot, pasted
 * ---------------------------------------------------------------------- */

/**
 * The clipboard payload this reads: the item list of a `paste` event.
 *
 * A structural type rather than `DataTransfer` so a test can hand it a plain
 * object — Node has no `DataTransfer` — and so the host can pass the event's
 * `clipboardData` without a cast.
 */
export interface ClipboardPayloadLike {
  readonly items: ArrayLike<{
    readonly kind: string;
    readonly type: string;
    getAsFile(): File | null;
  }>;
}

/**
 * The first image a clipboard payload carries, or `null`.
 *
 * A screenshot arrives as an item whose `kind` is `"file"` and whose type is an
 * image MIME — `image/png` from the Windows snipping tool and from Chromium's
 * own copy, `image/jpeg` from a phone — and `getAsFile()` is what turns it into
 * something the page raster can read. Text pasted into the note editor has no
 * such item, which is how the two pastes stay apart.
 */
export function imageFileFromClipboard(
  data: ClipboardPayloadLike | null | undefined,
): File | null {
  const items = data?.items;
  if (!items) return null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}
