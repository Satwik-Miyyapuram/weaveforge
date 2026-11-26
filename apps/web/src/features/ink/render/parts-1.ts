import { readyCore } from "@/lib/rust-core";
import type { InkColour, InkTool } from "@weaveforge/core";
import type { InkStrokeGeometry } from "../application/parts-3";

// --- ink-palette ---
/**
 * The ink palette: the `INK_COLOURS` as linear-ish sRGB triples the
 * renderers draw with.
 *
 * Strokes store a colour *name* — "text", "accent" — and the name resolves to a
 * value at draw time, so a page written in the light theme reads in the dark
 * one without rewriting a byte (§6.1). The values therefore have to come from
 * the live theme: the host reads the CSS tokens the toolbar swatches are painted
 * with and posts them to the worker, which has no document of its own. What is
 * here is the light theme's defaults, for the first frame and for the tests.
 *
 * The colour maths (CSS and hex, the name lookup, the parse, the palette
 * comparison) is the Rust core's, reached through `readyCore()`. This module
 * keeps the palette data and the DOM read of the theme.
 */
export type InkRgb = [number, number, number];
export type InkPalette = Record<InkColour, InkRgb>;

/** The light theme's tokens, as the renderer's defaults. */
export const INK_RENDER_COLOURS: InkPalette = {
  text: [0.13, 0.14, 0.16],
  accent: [0.23, 0.42, 0.86],
  warn: [0.85, 0.55, 0.09],
  good: [0.16, 0.6, 0.36],
  info: [0.2, 0.55, 0.72],
  danger: [0.79, 0.24, 0.24],
  // The marker colours, `--ink-*` in base.css: the reader's eight, so a note
  // and a paper written in "yellow" are the same yellow.
  yellow: [1, 0.83, 0],
  red: [1, 0.4, 0.4],
  green: [0.37, 0.7, 0.21],
  blue: [0.18, 0.66, 0.9],
  purple: [0.64, 0.54, 0.9],
  pink: [0.9, 0.43, 0.93],
  orange: [0.95, 0.6, 0.22],
  grey: [0.67, 0.67, 0.67],
};

/** The CSS custom property each ink colour is the value of. */
export const INK_COLOUR_TOKENS: Record<InkColour, string> = {
  text: "--text",
  accent: "--accent",
  warn: "--s-warn",
  good: "--s-good",
  info: "--s-info",
  danger: "--s-danger",
  yellow: "--ink-yellow",
  red: "--ink-red",
  green: "--ink-green",
  blue: "--ink-blue",
  purple: "--ink-purple",
  pink: "--ink-pink",
  orange: "--ink-orange",
  grey: "--ink-grey",
};

/**
 * Read the theme's palette off the document: a probe element is given each
 * token as its colour and the computed value read back, which is the one way
 * to resolve a token through `color-mix()` and friends. Runs on the main
 * thread only; the worker is handed the result.
 */
export function readThemePalette(doc: Document): InkPalette {
  const probe = doc.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  doc.body.appendChild(probe);
  const palette: InkPalette = { ...INK_RENDER_COLOURS };
  try {
    for (const colour of Object.keys(INK_COLOUR_TOKENS) as InkColour[]) {
      probe.style.color = `var(${INK_COLOUR_TOKENS[colour]})`;
      const parsed = readyCore().parseCssColour(getComputedStyle(probe).color);
      if (parsed) palette[colour] = parsed;
    }
  } finally {
    probe.remove();
  }
  return palette;
}

// --- ink-renderer ---
/** Which renderer is actually drawing. Reported in the status bar. */
export type InkBackend = "webgl2" | "canvas2d" | "none";

/** A translation in page units: where a dragged selection is shown before it lands. */
export interface InkShift {
  x: number;
  y: number;
}

/** How wide the selection halo is, in device pixels, either side of the ink. */
export const INK_SELECTION_HALO_PX = 3;

/**
 * How page units map to the canvas: `css = page * scale + offset`, then
 * `device = css * dpr`. The offset is where the page's corner sits in the
 * canvas, in CSS pixels — negative once the view has scrolled into the page.
 */
export interface InkViewTransform {
  /** CSS pixels per 0.1 mm unit. */
  scale: number;
  /** CSS pixels. */
  offsetX: number;
  offsetY: number;
  devicePixelRatio: number;
}

/** A snapshot of what the renderer is doing, for a status bar or a test. */
export interface InkRenderStats {
  backend: InkBackend;
  /** Strokes resident. */
  strokes: number;
  /** Segments resident — what the draw call iterates. */
  segments: number;
  /** Instances drawn in the last frame. */
  drawn: number;
  /** The AA margin the quads are inflated by, in device pixels. */
  marginPx: number;
}

/** The live stroke, as the renderer takes it: one growing polyline. */
export interface InkLiveStroke {
  header: { strokeId: number; width: number; tool: InkTool; colour: InkColour };
  /** Absolute x per point, in 0.1 mm. */
  x: Float32Array;
  /** Absolute y per point. */
  y: Float32Array;
  /** Pressure per point, 0–255. */
  pressure: Uint8Array;
  /** How many of those points are real rather than predicted. */
  realCount: number;
  /**
   * The first point that differs from the last frame's (smoothing, a packer
   * revision or a replaced predicted tail can move earlier points). Absent:
   * assume only the newest points moved.
   */
  changedFrom?: number;
}

/** A decoded page image, as both renderers can consume it. */
export type InkBackgroundImage = ImageBitmap;

export interface InkRenderer {
  readonly backend: InkBackend;
  /** What the renderer is doing: strokes, segments, the backend. */
  readonly renderStats: InkRenderStats;
  /** Page size and paper, in 0.1 mm. */
  setPage(size: { width: number; height: number }, paper: string): void;
  /**
   * The theme's colours for the six ink names. Posted by the host whenever the
   * theme changes; strokes keep their names and are redrawn in the new values.
   */
  setPalette(palette: InkPalette): void;
  /**
   * The page's background image — an inserted PDF page (§4.8) — stretched to
   * the page and drawn under every stroke, on screen and in an export. `null`
   * clears it. The renderer keeps the image; the caller does not close it.
   */
  setBackground(image: InkBackgroundImage | null): void;
  /**
   * Replace every stroke. The page load path, and the rebuild after a loss.
   *
   * Position is identity: `strokes[i]` is the buffer's stroke `i`, and a `null`
   * is a dead one whose index is still taken. That is what lets `removeStroke`
   * be given a buffer index rather than a position the renderer would have to
   * translate.
   */
  setStrokes(strokes: readonly (InkStrokeGeometry | null)[]): void;
  /**
   * Add one committed stroke without rebuilding anything.
   *
   * `index` is the buffer's; omitted, the renderer assigns the next one, which
   * is the same number so long as the two have been kept in step.
   */
  appendStroke(stroke: InkStrokeGeometry, index?: number): void;
  /** Stop drawing one stroke. `index` is the buffer's, not a position. */
  removeStroke(index: number): void;
  /** The stroke under the pen, redrawn incrementally (D6). */
  setLive(stroke: InkLiveStroke | null): void;
  /**
   * The lasso's selection: these strokes are drawn with a halo, shifted by
   * `shift` page units while a drag is in progress. Empty clears it.
   */
  setSelection(indices: readonly number[], shift: InkShift): void;
  /**
   * The sheet's SVG now draws every stroke below `count` (buffer indices), so
   * the on-screen frame may leave them out. Until the page says so, a stroke
   * just committed stays on the canvas: the SVG shows it a message and a
   * render later, and dropping it sooner blinks it out for a frame.
   */
  setShown(count: number): void;
  setTransform(transform: InkViewTransform): void;
  /** Resize the drawing surface. CSS pixels; the renderer applies the DPR. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** Paint one frame. */
  draw(): void;
  /**
   * Render the page to PNG at `scale`, for export (§6.2.12).
   *
   * Off an offscreen target, never by reading back the live canvas: a readback
   * from the drawing surface is what `preserveDrawingBuffer` costs, and Chromium
   * demotes a Canvas 2D surface it sees read from. The returned blob is the only
   * thing that leaves.
   *
   * `transparent` omits the sheet of white behind the ink: the caller is
   * composing the page over the paper itself — figures first, then this —
   * because figures are DOM the worker does not know about, and the sheet's
   * white would cover them.
   */
  capture(scale: number, transparent?: boolean): Promise<Blob | null>;
  /** Everything the renderer holds, released. */
  dispose(): void;
}

/**
 * The most device pixels a page canvas is given. The canvas covers the whole
 * page, so at 4× zoom on a 2× display an A4 page would want 8700 × 12300 px —
 * 430 MB of colour alone, plus the stencil — and the GPU refuses the
 * allocation, which shows as the ink vanishing at some zoom level. Above this
 * budget the backing store's pixel ratio is lowered instead (`backingRatio`),
 * so the page stays drawn, slightly softer than the display could show.
 * 20 M px is 80 MB of colour: 4000 × 5000, or the page at ~2.4× on this
 * machine's 1.25× display, before any softening.
 */
export const INK_MAX_BACKING_PIXELS = 20_000_000;

/** The largest single dimension a backing store is allowed, under WebGL's floor. */
export const INK_MAX_BACKING_DIMENSION = 8192;

/**
 * The pixel ratio a canvas of `cssWidth × cssHeight` is given: the display's,
 * unless the backing store would exceed `INK_MAX_BACKING_PIXELS` or
 * `INK_MAX_BACKING_DIMENSION`, in which case as much of it as fits.
 */
export function backingRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): number {
  return readyCore().inkBackingRatio(cssWidth, cssHeight, devicePixelRatio);
}
