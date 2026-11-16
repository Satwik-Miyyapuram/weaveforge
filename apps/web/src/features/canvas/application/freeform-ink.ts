/**
 * Ink on a freeform page, stored as `wfInk` strokes in the `.canvas` file:
 * `{id, x, y, w, c, t, p, r}`. The origin `x, y` is in page pixels on 0.1 px;
 * `p` holds the points as integer offsets from the origin in tenths of a pixel
 * (`dx, dy` pairs); `r` holds one pressure per point, 0 to 255. `r` may be
 * missing or short (the Rust core and Excalidraw import write none): those
 * points read at constant pressure. A stroke without `t` is a pen stroke.
 *
 * TODO: the eraser's hit test lives here in TypeScript. Swap `strokeHits` for
 * the Rust `strokes_hit` once the core exposes it through wf-wasm.
 */

export interface InkStroke {
  id: string;
  x: number;
  y: number;
  w: number;
  c: string;
  t: string;
  p: number[];
  r?: number[];
}

export interface InkPoint {
  x: number;
  y: number;
  /** 0 (light) to 1 (full). */
  pressure: number;
}

/** The pressure of a point the stroke stores none for. */
const CONSTANT_PRESSURE = 0.5;

/** Keeps `-0` out of the file: it is the same number to JSON, but not to a test. */
function whole(value: number): number {
  return Math.round(value) + 0;
}

export function encodeStroke(input: {
  id: string;
  width: number;
  colour: string;
  points: readonly InkPoint[];
  tool?: string;
}): InkStroke {
  const first = input.points[0] ?? { x: 0, y: 0, pressure: 0 };
  const ox = whole(first.x * 10) / 10;
  const oy = whole(first.y * 10) / 10;
  const p: number[] = [];
  const r: number[] = [];
  for (const point of input.points) {
    p.push(whole((point.x - ox) * 10), whole((point.y - oy) * 10));
    r.push(whole(Math.min(1, Math.max(0, point.pressure)) * 255));
  }
  return { id: input.id, x: ox, y: oy, w: input.width, c: input.colour, t: input.tool ?? "pen", p, r };
}

export function decodeStroke(stroke: InkStroke): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i < stroke.p.length / 2; i++) {
    const pressure = stroke.r?.[i];
    points.push({
      x: stroke.x + (stroke.p[2 * i] ?? 0) / 10,
      y: stroke.y + (stroke.p[2 * i + 1] ?? 0) / 10,
      pressure: pressure === undefined ? CONSTANT_PRESSURE : pressure / 255,
    });
  }
  return points;
}

function distanceToSegment(point: { x: number; y: number }, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether the point is within `radius` of the stroke's line, counting half its width. */
export function strokeHits(stroke: InkStroke, point: { x: number; y: number }, radius: number): boolean {
  const points = decodeStroke(stroke);
  const reach = radius + stroke.w / 2;
  const [only] = points;
  if (points.length === 1 && only) return Math.hypot(point.x - only.x, point.y - only.y) <= reach;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && distanceToSegment(point, a, b) <= reach) return true;
  }
  return false;
}

/** The ids of the strokes the eraser at `point` touches. */
export function eraseHits(strokes: readonly InkStroke[], point: { x: number; y: number }, radius: number): string[] {
  return strokes.filter((stroke) => strokeHits(stroke, point, radius)).map((stroke) => stroke.id);
}

/** The topmost stroke (drawn last) under a press at `point`, for selecting it. */
export function strokeAt(strokes: readonly InkStroke[], point: { x: number; y: number }, radius: number): string | undefined {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke && strokeHits(stroke, point, radius)) return stroke.id;
  }
  return undefined;
}

function isStroke(value: unknown): value is Omit<InkStroke, "t"> & { t?: string } {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.c !== "string") return false;
  if (s.t !== undefined && typeof s.t !== "string") return false;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.w)) return false;
  if (!Array.isArray(s.p) || s.p.length === 0 || s.p.length % 2 !== 0 || !s.p.every(Number.isInteger)) return false;
  if (s.r === undefined) return true;
  return Array.isArray(s.r) && s.r.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
}

/** The well-formed strokes of a `wfInk` value; anything else is skipped, never thrown on. */
export function readInk(value: unknown): InkStroke[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStroke).map((stroke) => (stroke.t === undefined ? { ...stroke, t: "pen" } : (stroke as InkStroke)));
}

/** The items of a `wfInk` list that `readInk` skips, so an edit can write them back unchanged. */
export function unreadInk(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => !isStroke(item)) : [];
}
