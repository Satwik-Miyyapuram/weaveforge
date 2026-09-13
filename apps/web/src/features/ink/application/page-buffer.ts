/**
 * One page's geometry, as the renderer and the picker need it.
 *
 * The plan's §6.2.3 splits the work deliberately: the sidecar holds `Int16`
 * deltas and the page decodes once, on demand, into parallel arrays the GPU can
 * take as they are. This is that decode plus the two things the pen path needs
 * afterwards — appending a finished stroke without rebuilding anything, and
 * marking a stroke dead without moving memory (§6.2.4's tombstone).
 *
 * **Per-stroke typed arrays rather than one flat buffer.** A flat arena with a
 * stroke table is what §6.2.11's memory budget eventually wants, and it is the
 * right shape for a page whose strokes never change. What it is not good at is
 * this screen's actual pattern: strokes are appended one at a time as the user
 * writes, and removing one must not disturb the others. An array of small typed
 * arrays gives that for free, costs one allocation per stroke at append time
 * (never on the sample path), and keeps `stroke(i)` a single indirection. The
 * flat form stays available behind this interface if a profile ever asks for it.
 */

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  inkEnumValue,
  INK_COLOURS,
  INK_SHAPES,
  INK_TOOLS,
  type InkColour,
  type InkLineRecord,
  type InkPage,
  type InkShape,
  type InkStroke,
  type InkTool,
} from "@weaveforge/core";

/** Bounding box as `[minX, minY, maxX, maxY]`, in 0.1 mm. */
export type InkBounds = [number, number, number, number];

/** One stroke as the buffer holds it: absolute, typed, with its own bounds. */
export interface InkStrokeGeometry {
  /** Absolute x per point, in 0.1 mm. */
  x: Float32Array;
  /** Absolute y per point, parallel to {@link x}. */
  y: Float32Array;
  /** Pressure per point, 0–255, parallel to {@link x}. */
  pressure: Uint8Array;
  /** Base nib width in 0.1 mm, before per-point pressure and velocity. */
  width: number;
  tool: InkTool;
  colour: InkColour;
  shape: InkShape;
  /** The line this stroke belongs to, or `-1` when it was never segmented. */
  line: number;
  bounds: InkBounds;
}

/** The empty bounding box, which is what a stroke with no points has. */
export const EMPTY_BOUNDS: InkBounds = [0, 0, 0, 0];

/** The bounding box of two parallel coordinate arrays. */
export function boundsOf(x: Float32Array, y: Float32Array): InkBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    const px = x[i]!;
    const py = y[i]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minX)) return [...EMPTY_BOUNDS];
  return [minX, minY, maxX, maxY];
}

/** Whether two bounding boxes overlap at all, `slack` growing one of them. */
export function boundsIntersect(
  a: InkBounds,
  b: InkBounds,
  slack = 0,
): boolean {
  return (
    a[0] - slack <= b[2] + slack &&
    a[2] + slack >= b[0] - slack &&
    a[1] - slack <= b[3] + slack &&
    a[3] + slack >= b[1] - slack
  );
}

/** Whether `point` is inside a box, `slack` growing the box. */
export function boundsContain(
  box: InkBounds,
  x: number,
  y: number,
  slack = 0,
): boolean {
  return (
    x >= box[0] - slack &&
    x <= box[2] + slack &&
    y >= box[1] - slack &&
    y <= box[3] + slack
  );
}

/** A stroke as it arrives from the pen: absolute points, before simplification. */
export interface IncomingStroke {
  points: readonly number[];
  pressures: readonly number[];
  width: number;
  tool: InkTool;
  colour: InkColour;
  shape?: InkShape;
  line?: number;
}

/**
 * A page's strokes, live.
 *
 * Liveness is a parallel `Uint8Array` rather than a splice, because the eraser
 * runs at 120–240 events a second and removing from the middle of an array of
 * 5 000 strokes is a copy per removal (§6.2.4). Dead strokes stay in place with
 * their bit cleared: `stroke(i)` refuses them, the index skips them, and the
 * renderer stops drawing them the moment the bit goes. Compaction is a rebuild-time
 * concern, not a gesture-time one.
 */
export class InkPageBuffer {
  readonly width: number;
  readonly height: number;
  readonly paper: InkPage["paper"];
  readonly lines: readonly InkLineRecord[];

  private strokes: InkStrokeGeometry[] = [];
  private alive: Uint8Array = new Uint8Array(0);
  /** Strokes ever added, dead ones included. Monotonic, so indices are stable. */
  private added = 0;
  /**
   * The page's background as the chunk header records it: the 1-based index of
   * the attachment in the note's body, or 0 for none (§4.3, §4.8).
   *
   * It is a field rather than a constant because the host can change a page's
   * image while the page is loaded, and the next save has to write the new
   * index — the strokes are the only thing a save is *about*, not the only
   * thing it writes.
   */
  private background = 0;

  constructor(page: InkPage) {
    const size = { width: page.width, height: page.height };
    this.width = size.width || INK_A4_WIDTH;
    this.height = size.height || INK_A4_HEIGHT;
    this.paper = page.paper;
    this.lines = page.lines;
    this.background = page.background ?? 0;
    for (const stroke of page.strokes) this.append(stroke);
  }

  /** The attachment index the page would be saved with. */
  get backgroundIndex(): number {
    return this.background;
  }

  /** Set it, clamped to the byte the chunk header holds. */
  setBackgroundIndex(index: number): void {
    this.background = Number.isFinite(index)
      ? Math.max(0, Math.min(255, Math.round(index)))
      : 0;
  }

  /**
   * The page a buffer wraps, ready to be packed back into a chunk.
   *
   * Dead strokes are dropped here rather than in the buffer: this is the save path,
   * which is allowed to be the expensive one, and a chunk has no concept of a
   * tombstone — "erased" and "never there" are the same thing on disk.
   */
  toPage(): InkPage {
    return {
      width: this.width,
      height: this.height,
      paper: this.paper,
      background: this.background,
      strokes: this.liveStrokes().map(fromGeometry),
      lines: [...this.lines],
    };
  }

  /** Strokes ever added, dead ones included. What the index is sized against. */
  get capacity(): number {
    return this.strokes.length;
  }

  /** Strokes still alive. */
  get liveCount(): number {
    let count = 0;
    for (let i = 0; i < this.alive.length; i += 1)
      if (this.alive[i]) count += 1;
    return count;
  }

  /** The stroke at an index, or `null` when it is missing or erased. */
  stroke(index: number): InkStrokeGeometry | null {
    if (index < 0 || index >= this.strokes.length) return null;
    return this.alive[index] ? this.strokes[index]! : null;
  }

  /**
   * Every slot, dead ones as `null`, so position equals buffer index.
   *
   * What a renderer is rebuilt from: it keys removal on the buffer's index, and
   * a list with the dead strokes squeezed out would shift every index after the
   * first tombstone.
   */
  allStrokes(): (InkStrokeGeometry | null)[] {
    const out: (InkStrokeGeometry | null)[] = [];
    for (let i = 0; i < this.strokes.length; i += 1) {
      out.push(this.alive[i] ? this.strokes[i]! : null);
    }
    return out;
  }

  /** Every stroke still alive, in the order they were added. */
  liveStrokes(): InkStrokeGeometry[] {
    const out: InkStrokeGeometry[] = [];
    for (let i = 0; i < this.strokes.length; i += 1) {
      if (this.alive[i]) out.push(this.strokes[i]!);
    }
    return out;
  }

  /**
   * Add a finished stroke and answer its index.
   *
   * The index is stable for the life of the buffer: a later erase clears a bit
   * rather than shifting anything, so the R-tree's leaf order and the renderer's
   * instance ranges both keep meaning what they meant when they were built.
   */
  append(stroke: IncomingStroke | InkStroke): number {
    const geometry = toGeometry(stroke);
    const index = this.strokes.length;
    this.strokes.push(geometry);
    if (index >= this.alive.length) {
      const grown = new Uint8Array(Math.max(64, this.alive.length * 2));
      grown.set(this.alive);
      this.alive = grown;
    }
    this.alive[index] = 1;
    this.added += 1;
    return index;
  }

  /** Mark a stroke dead. O(1), no allocation, no index rebuild (§6.2.4). */
  erase(index: number): boolean {
    if (index < 0 || index >= this.alive.length || !this.alive[index])
      return false;
    this.alive[index] = 0;
    return true;
  }

  /** Bring an erased stroke back, for undo. */
  restore(index: number): boolean {
    if (index < 0 || index >= this.alive.length || this.alive[index])
      return false;
    this.alive[index] = 1;
    return true;
  }

  /** Whether a stroke is still there. The eraser and the index both ask. */
  isAlive(index: number): boolean {
    return index >= 0 && index < this.alive.length && this.alive[index] === 1;
  }

  /**
   * Drop dead strokes and renumber.
   *
   * Called at a gesture boundary and never during one: everything that holds an
   * index — the R-tree, the GPU instance ranges, an undo record — has to be told
   * about the new numbering, so it is one deliberate pass rather than a habit.
   */
  compact(): Map<number, number> {
    const remap = new Map<number, number>();
    const kept: InkStrokeGeometry[] = [];
    for (let i = 0; i < this.strokes.length; i += 1) {
      if (!this.alive[i]) continue;
      remap.set(kept.length, i);
      kept.push(this.strokes[i]!);
    }
    this.strokes = kept;
    this.alive = new Uint8Array(Math.max(64, kept.length));
    this.alive.fill(1, 0, kept.length);
    return remap;
  }

  /** The whole page's bounds, or an empty box for a blank page. */
  bounds(): InkBounds {
    let box: InkBounds | null = null;
    for (let i = 0; i < this.strokes.length; i += 1) {
      if (!this.alive[i]) continue;
      const stroke = this.strokes[i]!;
      box = box
        ? [
            Math.min(box[0], stroke.bounds[0]),
            Math.min(box[1], stroke.bounds[1]),
            Math.max(box[2], stroke.bounds[2]),
            Math.max(box[3], stroke.bounds[3]),
          ]
        : [...stroke.bounds];
    }
    return box ?? [...EMPTY_BOUNDS];
  }
}

/**
 * Build the buffer's form of a stroke.
 *
 * Two shapes arrive here and both are common: a stroke from the sidecar (already
 * simplified, already absolute) and one from the pen (absolute, and simplified by
 * the worker before it got this far). So this is a copy into typed arrays plus a
 * bounding box, and no simplification — where "simplify before committing" lives
 * is the worker, per §4.4.
 */
export function toGeometry(
  stroke: IncomingStroke | InkStroke,
): InkStrokeGeometry {
  const count = Math.floor(stroke.points.length / 2);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const pressure = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = stroke.points[i * 2] ?? 0;
    y[i] = stroke.points[i * 2 + 1] ?? 0;
    const reported = stroke.pressures?.[i];
    pressure[i] =
      typeof reported === "number" && Number.isFinite(reported)
        ? Math.max(0, Math.min(255, Math.round(reported)))
        : 0;
  }
  return {
    x,
    y,
    pressure,
    width: stroke.width,
    tool: stroke.tool,
    colour: stroke.colour,
    shape: "shape" in stroke && stroke.shape ? stroke.shape : "none",
    line: "lineIndex" in stroke ? stroke.lineIndex : (stroke.line ?? -1),
    bounds: count === 0 ? [...EMPTY_BOUNDS] : boundsOf(x, y),
  };
}

/** The geometry back as the model's stroke, for packing a chunk. */
export function fromGeometry(stroke: InkStrokeGeometry): InkStroke {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let i = 0; i < stroke.x.length; i += 1) {
    points.push(stroke.x[i]!, stroke.y[i]!);
    pressures.push(stroke.pressure[i]!);
  }
  return {
    points,
    pressures,
    width: stroke.width,
    tool: stroke.tool,
    colour: stroke.colour,
    t0: 0,
    shape: stroke.shape,
    lineIndex: stroke.line,
  };
}

/** The tool/colour/shape at an index, for a chunk read without the model. */
export function geometryMeta(stroke: InkStrokeGeometry): {
  tool: InkTool;
  colour: InkColour;
  shape: InkShape;
} {
  return {
    tool: inkEnumValue(INK_TOOLS, INK_TOOLS.indexOf(stroke.tool)),
    colour: inkEnumValue(INK_COLOURS, INK_COLOURS.indexOf(stroke.colour)),
    shape: inkEnumValue(INK_SHAPES, INK_SHAPES.indexOf(stroke.shape)),
  };
}
