import { logToApp } from "@/lib/error-report/app-log";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { InkChunkCodec, InkColour, InkNoteMeta, InkPaper } from "@weaveforge/core";
import type {
  DrawArea,
  EdgeStepResult,
  EraserSweepState as WasmEraserSweepState,
  InkRouteQuestion,
  Point,
  StrokeEdgeSplit as WasmStrokeEdgeSplit,
} from "@weaveforge/wasm";
import { INK_RENDER_COLOURS, type InkPalette } from "../render/parts-1";

// --- eraser-tip ---
/**
 * The pen's back tip, as an eraser.
 *
 * Windows digitizers report the Slim Pen's inverted end — and the eraser
 * barrel button — through the Pointer Events spec's fifth button: `button`
 * is `5` on the down that starts the contact, and the `buttons` bitmask
 * carries bit 5 (value `32`) for as long as the eraser end is the thing
 * touching the glass. Both spellings are the same fact, so both are read: a
 * driver that only sets one of them still works.
 *
 * A pen in the writing grip never reports either, so this never steals a
 * drawing stroke; and a hover with the pen inverted reports neither, so the
 * back tip erases only where the finger would — on contact.
 */
/** The `button` a down reports when the eraser end made the contact. */
export const PEN_ERASER_BUTTON = 5;

/** The `buttons` bit that stays set while the eraser end is in contact. */
export const PEN_ERASER_BIT = 32;

/** The pointer fields this reads; a `PointerEvent` satisfies it. */
export interface PenEraserEvent {
  pointerType: string;
  button?: number;
  buttons?: number;
}

/**
 * Eraser end: `readyCore().isPenEraserPointer(pointerType, button, buttons)`.
 * Touch and mouse never are; a hover (no buttons) never erases mid-air.
 */

/** The `buttons` bit a pen's barrel button sets while it is held. */
export const PEN_BARREL_BIT = 2;

/**
 * Barrel button: `readyCore().isPenBarrelPointer(pointerType, button, buttons)`.
 * The barrel selects (a lasso), as in OneNote, rather than drawing a stray stroke (E33).
 */

/** What a sweep needs from a pointer event; a React or DOM `PointerEvent` fits. */
export interface EraserSweepEvent extends PenEraserEvent {
  pointerId: number;
  currentTarget: unknown;
}

/** What a hover needs: which pointer, over which surface. */
export interface EraserHoverEvent {
  pointerId: number;
  currentTarget: unknown;
}

type Styled = { style: { cursor: string } };
const styled = (target: unknown): target is Styled =>
  typeof target === "object" && target !== null && "style" in target;

/**
 * One erase sweep, down to up: whether a down erases, which pointer owns the
 * sweep, and the eraser cursor while it lasts. Notes and the reader share it so
 * the back tip behaves the same on a sheet and on a PDF page.
 *
 * A hovering pen reports nothing that tells its ends apart (no button, no bit,
 * same tilt and size), so after a back-tip lift the cursor stays with that
 * pointer until it leaves the surface or the front tip touches down. Windows
 * gives each entry into range a fresh pointerId, so the stickiness ends there.
 */
export class EraserSweep {
  private wasm: WasmEraserSweepState | undefined;
  private target: Styled | null = null;
  private cursorBefore = "";

  constructor(private readonly cursor: string) {}

  /** The sweep state lives in Rust; built on first use, once the core is loaded. */
  private get state(): WasmEraserSweepState {
    if (!this.wasm) this.wasm = new (readyCore().EraserSweepState)();
    return this.wasm;
  }

  /**
   * Starts a sweep when the armed tool erases, or when `tipErases` and the
   * pen's back tip made the contact. False leaves the down to the caller.
   */
  begin(event: EraserSweepEvent, toolErases: boolean, tipErases: boolean): boolean {
    const action = this.state.begin(
      event.pointerId,
      toolErases,
      tipErases,
      tipErases && readyCore().isPenEraserPointer(event.pointerType, event.button, event.buttons),
    );
    if (action === "none") return false;
    this.show(event.currentTarget);
    return true;
  }

  /** Whether `pointerId` is the one sweeping. */
  owns(pointerId: number): boolean {
    return this.state.owns(pointerId);
  }

  /** Ends the sweep `pointerId` owns; false when it owned none. */
  end(pointerId: number): boolean {
    const action = this.state.end(pointerId);
    if (action === "none") return false;
    if (action === "restore") this.restoreCursor();
    return true;
  }

  /** A hover over `currentTarget`: the sticky pointer brings the eraser cursor along. */
  hover(event: EraserHoverEvent): void {
    if (this.state.hover(event.pointerId) !== "show" || this.target === event.currentTarget) return;
    this.show(event.currentTarget);
  }

  /** The pointer left the surface: its eraser cursor comes off, and returns on the next hover. */
  leave(pointerId: number): void {
    if (this.state.leave(pointerId) === "restore") this.restoreCursor();
  }

  /** A down that did not erase: the back tip is no longer the end in use. */
  release(pointerId: number): void {
    if (this.state.release(pointerId) === "restore") this.restoreCursor();
  }

  private show(target: unknown): void {
    this.restoreCursor();
    if (!styled(target)) return;
    this.target = target;
    this.cursorBefore = target.style.cursor;
    target.style.cursor = this.cursor;
  }

  // A surface that set its own cursor meanwhile (a tool change) keeps it.
  private restoreCursor(): void {
    if (this.target && this.target.style.cursor === this.cursor) this.target.style.cursor = this.cursorBefore;
    this.target = null;
  }
}

// --- ink-chunk-codec ---
/**
 * The codec a chunk is read and written with, on both sides of the worker.
 *
 * `deflate-raw` through `CompressionStream`, which every Chromium and Firefox
 * has and Safari 16.4+ does; brotli is **not** reachable from the web at all
 * (`CompressionStream` does not expose it, §4.3), which is why the desktop
 * build passes its own. `identity` — what a `null` here becomes — is for a
 * page small enough to have been stored raw.
 *
 * It is one module rather than two copies because the worker is no longer the
 * only writer: the host writes a page's chunk itself when the page's
 * background changes (§4.8), and a chunk written with one codec has to be
 * readable by the other. Absent `CompressionStream` this falls back to
 * identity, which decodes an uncompressed chunk correctly and refuses a
 * compressed one with the container's own error rather than silently
 * producing nothing.
 */
/** The codec the app stores its chunks with, by name. */
export const INK_CHUNK_CODEC_NAME = "deflate-raw" as const;

/** A codec by name, or `null` where this runtime cannot provide it. */
export function inkChunkCodec(
  name: "identity" | "deflate-raw" | undefined,
): InkChunkCodec | null {
  if (name !== "deflate-raw") return null;
  if (
    typeof CompressionStream !== "function" ||
    typeof DecompressionStream !== "function"
  )
    return null;
  return {
    id: "deflate-raw",
    compress: async (bytes) =>
      pipeThrough(new CompressionStream("deflate-raw"), bytes),
    decompress: async (bytes) =>
      pipeThrough(new DecompressionStream("deflate-raw"), bytes),
  };
}

/**
 * The codec this runtime can store with, or `undefined` to leave core on
 * identity — which is what every core call's parameter default means.
 */
export function availableInkChunkCodec(): InkChunkCodec | undefined {
  return inkChunkCodec(INK_CHUNK_CODEC_NAME) ?? undefined;
}

/** Push bytes through a transform stream and collect what comes out. */
export async function pipeThrough(
  stream: GenericTransformStream,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A corrupt input errors the stream: the reader below rejects with it, and
  // these two promises reject with the same error, which nobody else awaits.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value as Uint8Array);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// --- ink-chunk-store ---
/**
 * Where a note's stroke chunks live: the port, and the page loader over it.
 *
 * A chunk is one page's strokes, columnar binary, compressed (§4.3), and it is
 * addressed by the note's id and the chunk's ULID — never by page number, since
 * order is the note's metadata and identity is the file (§4.1). The store knows
 * nothing about pages; `loadInkPages` is what turns the note's declared order
 * plus whatever chunks exist into the page list the host shows.
 *
 * Three stores answer this port: the workspace folder's `.ink/<id>/` directory
 * when one is open, the encrypted blob bucket the vault's assets already use
 * otherwise, and memory for tests. The host cannot tell them apart, which is
 * the point — an ink note is an ink note whether it sits on disk or in the database.
 */
export interface InkChunkStore {
  /** The chunk's bytes, or `null` where no such chunk exists. Throws when the read itself failed. */
  read(noteId: string, chunkId: string): Promise<Uint8Array | null>;
  write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
  remove(noteId: string, chunkId: string): Promise<void>;
  /**
   * The chunk ids the store holds for a note, or `null` where it cannot say.
   *
   * A folder can list its directory; a blob bucket lists by prefix; some stores
   * cannot list at all and answer `null`, in which case the note's declared
   * order is the whole truth.
   */
  list(noteId: string): Promise<string[] | null>;
}

/** One page as the host loads it: its chunk id, its bytes, and its paper. */
export interface InkStoredPage {
  chunkId: string;
  chunk: Uint8Array | null;
  paper: InkPaper;
  /**
   * The chunk exists but could not be read. The page shows empty and must not
   * be saved: a save would replace the stored strokes with only the new ones.
   */
  unreadable?: boolean;
}

/**
 * The pages of a note, in the note's order, with orphans appended (§4.2).
 *
 * A note with no chunks is a valid one-page empty ink note, and gets a fresh
 * chunk id so its first save has somewhere to go. A declared page whose chunk
 * is missing is kept — empty — rather than dropped, since dropping it would
 * silently renumber the pages after it.
 */
export async function loadInkPages(
  store: InkChunkStore,
  noteId: string,
  meta: InkNoteMeta,
): Promise<InkStoredPage[]> {
  const present = (await store.list(noteId)) ?? [];
  // Declared order is kept even where a chunk is missing — a page that lost
  // its file is an empty page, not a vanished one — then the orphans follow.
  const order = typedCore().composeInkPageOrder(meta.pageOrder, present);
  if (order.length === 0) order.push(typedCore().newInkChunkId());
  const pages = await Promise.all(
    order.map(async (chunkId): Promise<InkStoredPage> => {
      try {
        return { chunkId, chunk: await store.read(noteId, chunkId), paper: meta.paper };
      } catch (err) {
        // Not "missing": the chunk may be there. One bad page must not stop
        // the rest from opening, so it is marked and the host leaves it alone.
        logToApp({ level: "error", source: "ink", message: `Could not read ink page ${chunkId} of ${noteId}`, detail: String(err) });
        return { chunkId, chunk: null, paper: meta.paper, unreadable: true };
      }
    }),
  );
  return pages;
}


/** A store that forgets on reload. Tests, and the fallback where nothing else is wired. */
export class MemoryInkChunkStore implements InkChunkStore {
  private readonly chunks = new Map<string, Uint8Array>();

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    return this.chunks.get(typedCore().inkChunkPath(noteId, chunkId)) ?? null;
  }

  async write(
    noteId: string,
    chunkId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    this.chunks.set(typedCore().inkChunkPath(noteId, chunkId), bytes.slice());
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    this.chunks.delete(typedCore().inkChunkPath(noteId, chunkId));
  }

  async list(noteId: string): Promise<string[]> {
    const prefix = typedCore().inkChunkPath(noteId, typedCore().newInkChunkId()).replace(/[^/]+$/, "");
    const ids: string[] = [];
    for (const path of this.chunks.keys()) {
      if (!path.startsWith(prefix)) continue;
      const id = readyCore().inkChunkIdOfFileName(path.slice(prefix.length));
      if (id) ids.push(id);
    }
    return ids.sort();
  }

  get size(): number {
    return this.chunks.size;
  }
}

// --- ink-gesture ---
/**
 * Where a pointer gesture goes, and where a stroke crosses the paper's edge.
 *
 * Notes and the reader route a down the same way — back tip first, then the
 * armed tool — and cut a stroke where it leaves the page, so one place decides
 * both and a bug in either shows up on both surfaces.
 */
/** The armed tool, as the gesture sees it. */
export type InkToolKind = "draw" | "eraser" | "lasso" | "region" | "none";

/** What a pointer's gesture does from down to up. */
export type InkRoute = "erase" | "intercept" | "drag" | "lasso" | "draw" | "region";

export interface InkDownContext {
  tool: InkToolKind;
  /** Whether the pen's back tip erases on this surface right now. */
  tipErases: boolean;
  /** The surface claims the down for itself (a figure drag); checked before drawing. */
  intercept?: () => boolean;
  /** With the lasso armed, whether the down lands on the current selection. */
  hitSelection?: () => boolean;
  /** Whether this pointer may draw at all (touch-to-draw off, palm, …). */
  admit?: () => boolean;
}

export class InkGesture {
  private readonly sweep: EraserSweep;
  private readonly routes = new Map<number, InkRoute>();

  constructor(eraserCursor: string) {
    this.sweep = new EraserSweep(eraserCursor);
  }

  /** Picks the route for a down and remembers it; null leaves the down to the caller. */
  down(event: EraserSweepEvent, ctx: InkDownContext): InkRoute | null {
    const route = this.pick(event, ctx);
    if (route !== "erase") this.sweep.release(event.pointerId);
    if (route) this.routes.set(event.pointerId, route);
    else this.routes.delete(event.pointerId);
    return route;
  }

  /** Drives the Rust route picker, answering each question from the context. */
  private pick(event: EraserSweepEvent, ctx: InkDownContext): InkRoute | null {
    const Picker = readyCore().InkRoutePicker;
    const picker = new Picker({
      tool: ctx.tool,
      tipErases: ctx.tipErases,
      penBarrel: readyCore().isPenBarrelPointer(event.pointerType, event.button, event.buttons),
      hasAdmit: ctx.admit !== undefined,
      hasHitSelection: ctx.hitSelection !== undefined,
      hasIntercept: ctx.intercept !== undefined,
    });
    let step = picker.start();
    while (step.kind === "ask") step = picker.answer(this.answer(step.question, event, ctx));
    return step.route;
  }

  /** The caller's answer to one picker question; the sweep questions also start the sweep. */
  private answer(question: InkRouteQuestion, event: EraserSweepEvent, ctx: InkDownContext): boolean {
    switch (question) {
      case "sweepTip":
        return this.sweep.begin(event, false, ctx.tipErases);
      case "admit":
        return ctx.admit?.() ?? true;
      case "hitSelection":
        return ctx.hitSelection?.() ?? false;
      case "sweepTool":
        return this.sweep.begin(event, ctx.tool === "eraser", false);
      case "intercept":
        return ctx.intercept?.() ?? false;
    }
  }

  /** The route `pointerId` is on, or null when it has none. */
  route(pointerId: number): InkRoute | null {
    return this.routes.get(pointerId) ?? null;
  }

  /** Ends `pointerId`'s gesture and returns the route it was on. */
  up(pointerId: number): InkRoute | null {
    const route = this.routes.get(pointerId) ?? null;
    this.routes.delete(pointerId);
    if (route === "erase") this.sweep.end(pointerId);
    return route;
  }

  /** A move with no gesture under way: keeps a lifted back tip's eraser cursor showing. */
  hover(event: EraserHoverEvent): void {
    if (!this.routes.has(event.pointerId)) this.sweep.hover(event);
  }

  /** The pointer left the surface (or the pen left range). */
  leave(pointerId: number): void {
    this.sweep.leave(pointerId);
  }
}

/** One move of a stroke against the paper's edge. */
export type EdgeStep = EdgeStepResult;

/**
 * Tracks one stroke against the drawable area: the move that leaves it ends
 * the stroke at the crossing, and the move that returns starts a new one there.
 * The split itself is Rust (`ink::gesture::StrokeEdgeSplit`); this holds it lazily.
 */
export class StrokeEdgeSplit {
  private core: WasmStrokeEdgeSplit | null = null;

  private get split(): WasmStrokeEdgeSplit {
    if (!this.core) {
      const Split = readyCore().StrokeEdgeSplit;
      this.core = new Split();
    }
    return this.core;
  }

  get outside(): boolean {
    return this.split.outside;
  }

  begin(at: Point): void {
    this.split.begin(at);
  }

  /** A null area means everywhere is paper. */
  move(at: Point, area: DrawArea | null): EdgeStep {
    return this.split.move(at, area);
  }

  /** Forgets the stroke; true when it ended off the paper. */
  end(): boolean {
    return this.split.end();
  }
}

// --- ink-trail ---
/**
 * The Delegated Ink Trail: the OS compositor draws the wet tail between the
 * last frame the worker presented and the pen tip (§6.2.6).
 *
 * This is one of two mutually exclusive low-latency paths, and the choice is
 * made once, before the canvas gets its context: with a presenter the canvas
 * is `desynchronized: false` and prediction is off; without one it is the
 * other way round. So the presenter is requested up front, by the pen hook,
 * and the answer is what the worker's `init` carries.
 *
 * Coded against the WICG shape — `navigator.ink.requestPresenter({
 * presentationArea })` and `updateInkTrailStartPoint(event, { color, diameter
 * })` — and nothing here throws when the API is absent: Firefox, Safari and a
 * test runner all get `null`, which is the fallback path and a no-op trail.
 */
/** The presenter, as this code uses it. The real one has more; a test needs this much. */
export interface InkPresenterLike {
  updateInkTrailStartPoint(event: PointerEvent, style: InkTrailStyle): void;
  /** The area the presenter was asked for; `null` on some implementations. */
  presentationArea?: Element | null;
  /** The older proposal's hint, when a platform still reports it. */
  expectedImprovement?: number;
}

/** The style the trail is drawn with, per event. */
export interface InkTrailStyle {
  /** A CSS colour. */
  color: string;
  /** In CSS pixels. */
  diameter: number;
}

/** `navigator`, as far as the trail reads it. */
export interface InkNavigatorLike {
  ink?: {
    requestPresenter(param?: {
      presentationArea?: Element;
    }): Promise<InkPresenterLike>;
  };
}

/**
 * Ask the platform for a presenter over `area`. `null` where there is none, or
 * the request is refused — never a throw, because the fallback path is the
 * ordinary one and an absent API is not an error.
 */
export async function requestInkPresenter(
  area: Element,
  nav: InkNavigatorLike | null | undefined = typeof navigator === "undefined"
    ? null
    : (navigator as unknown as InkNavigatorLike),
): Promise<InkPresenterLike | null> {
  const ink = nav?.ink;
  if (!ink || typeof ink.requestPresenter !== "function") return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
    const presenter = await Promise.race([
      ink.requestPresenter({ presentationArea: area }),
      timeout,
    ]);
    if (!presenter || typeof presenter.updateInkTrailStartPoint !== "function")
      return null;
    return presenter;
  } catch {
    return null;
  }
}

/** The trail's colour for a palette name: the renderer's own sRGB, as CSS. */
export function trailColour(
  colour: InkColour,
  alpha = 1,
  palette: InkPalette = INK_RENDER_COLOURS,
): string {
  return readyCore().paletteCss(palette, colour, alpha);
}

/**
 * The style for one live sample: colour from the tool, diameter from the
 * filtered width. A highlighter's trail is translucent like its ink.
 */
export function trailStyle(input: {
  colour: InkColour;
  tool: "pen" | "highlighter";
  width: number;
  pageWidthPx: number;
  /** The theme's colours; the light defaults when omitted. */
  palette?: InkPalette;
}): InkTrailStyle {
  return {
    color: trailColour(
      input.colour,
      readyCore().inkTrailAlpha(input.tool),
      input.palette,
    ),
    diameter: readyCore().trailDiameterPx(input.width, input.pageWidthPx),
  };
}

/**
 * Move the trail's start point for a dispatched event. A presenter that
 * throws — an untrusted event, a detached area — is dropped for the session,
 * which is the fallback path minus prediction: still correct, only slower.
 */
export function updateTrail(
  presenter: InkPresenterLike,
  event: PointerEvent,
  style: InkTrailStyle,
): boolean {
  try {
    presenter.updateInkTrailStartPoint(event, style);
    return true;
  } catch {
    return false;
  }
}
