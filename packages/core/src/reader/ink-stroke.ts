/**
 * Ink geometry: capture filtering, simplification, and stroke width.
 *
 * Handwriting is the one annotation kind whose storage cost is set by the input
 * device rather than by the document. A pointer fires far faster than a hand
 * moves, so a raw capture stores hundreds of near-identical points per stroke —
 * a page of notes becomes megabytes of JSON in `reader_annotations`, which is
 * exactly the unbounded growth `docs/storage/growth.md` warns about. Everything
 * here exists to keep a stroke's stored size proportional to its *shape*, not to
 * how long the pen was down or how fast the device reports.
 *
 * Three independent budgets, applied in order:
 *   1. capture   — points closer together than the pen's own jitter are dropped
 *                  before they ever reach state ({@link shouldAppendInkPoint}).
 *   2. save      — Ramer–Douglas–Peucker removes points the curve implies, and
 *                  coordinates are rounded to the precision a PDF point has
 *                  ({@link compactInkPath}).
 *   3. hard cap  — whatever survives is forced under {@link INK_MAX_POINTS} by
 *                  simplifying harder, so no single stroke can be unbounded.
 *
 * All coordinates are flat `[x, y, x, y, …]` in PDF user space, matching
 * Zotero's `annotationPosition.paths`.
 */

/**
 * Minimum gap between consecutive captured points, in PDF units (≈ points).
 *
 * A stylus reports at 120–240 Hz; at reading speed most of those samples land
 * inside the width of the nib. Anything below this is noise being paid for.
 */
export const INK_MIN_POINT_DISTANCE = 0.75;

/**
 * Ramer–Douglas–Peucker tolerance in PDF units: the furthest a dropped point
 * may sit from the line that replaces it. A third of a point is below what the
 * eye resolves at normal zoom, and typically removes 80–90% of a stroke.
 */
export const INK_SIMPLIFY_TOLERANCE = 0.35;

/** Coordinate decimals kept. A PDF point is ~0.35 mm; 1/100 of one is plenty. */
export const INK_COORD_DECIMALS = 2;

/**
 * Hardest cap on one stroke. Reached only by a stroke that is genuinely long
 * and wiggly; the tolerance is raised until the stroke fits rather than the
 * tail being cut, so the shape degrades gracefully instead of losing its end.
 */
export const INK_MAX_POINTS = 400;

/**
 * How many strokes one annotation row may hold before the next stroke starts a
 * new row. Grouping is what stops a written sentence becoming twenty rows and
 * twenty sidebar entries; this bound stops it becoming one unbounded row.
 */
export const INK_MAX_PATHS_PER_ANNOTATION = 64;

/** Idle gap after which a stroke is treated as starting a new annotation. */
export const INK_GROUP_WINDOW_MS = 2_000;

export const INK_DEFAULT_WIDTH = 2;
export const INK_MIN_WIDTH = 0.75;
export const INK_MAX_WIDTH = 24;

/** Nib width of the highlighter tool, in PDF units. */
export const HIGHLIGHTER_WIDTH = 14;

/**
 * At or above this width an ink stroke is painted as a highlighter: translucent
 * and multiplied over the page rather than drawn on top of it.
 *
 * Zotero's ink annotation carries a `width` and nothing else — there is no
 * "tool" field to write back, and inventing one would either be dropped on sync
 * or corrupt the item for Zotero's own reader. Deriving the look from the width
 * keeps a highlighter a plain Zotero ink annotation that happens to be thick.
 */
export const HIGHLIGHTER_MIN_WIDTH = 8;

export function isHighlighterInk(width: number | undefined): boolean {
  return typeof width === "number" && width >= HIGHLIGHTER_MIN_WIDTH;
}

export function clampInkWidth(width: number): number {
  if (!Number.isFinite(width)) return INK_DEFAULT_WIDTH;
  return Math.min(INK_MAX_WIDTH, Math.max(INK_MIN_WIDTH, width));
}

/**
 * Stroke width for a pointer's reported pressure.
 *
 * A mouse reports `0.5` while a button is down (and `0` otherwise), so only a
 * real pen ever produces anything else — which is why a flat width made pen
 * input look identical to mouse input. Pressure is applied per *stroke*, not
 * per point: per-point widths would mean storing a third number alongside every
 * x,y, half again the size of every stroke, and Zotero has nowhere to put it.
 * One width per stroke costs nothing and still makes a light stroke thin and a
 * pressed one thick.
 */
export function inkWidthForPressure(
  pressure: number | undefined,
  base = INK_DEFAULT_WIDTH,
): number {
  // 0 means "device does not report pressure"; 0.5 is the mouse/unknown default.
  if (typeof pressure !== "number" || !Number.isFinite(pressure) || pressure <= 0) {
    return clampInkWidth(base);
  }
  if (pressure === 0.5) return clampInkWidth(base);
  // Half width at a feather touch, double at full press, linear between.
  const factor = 0.5 + Math.min(Math.max(pressure, 0), 1) * 1.5;
  return clampInkWidth(base * factor);
}

/** Mean of the pressures seen during a stroke, ignoring non-reporting samples. */
export function meanPressure(samples: readonly number[]): number | undefined {
  const usable = samples.filter((p) => Number.isFinite(p) && p > 0);
  if (usable.length === 0) return undefined;
  return usable.reduce((sum, p) => sum + p, 0) / usable.length;
}

/**
 * Whether a captured point is far enough from the last one to be worth storing.
 * The first point of a stroke always is.
 */
export function shouldAppendInkPoint(
  path: readonly number[],
  x: number,
  y: number,
  minDistance = INK_MIN_POINT_DISTANCE,
): boolean {
  if (path.length < 2) return true;
  const lastX = path[path.length - 2]!;
  const lastY = path[path.length - 1]!;
  return Math.hypot(x - lastX, y - lastY) >= minDistance;
}

function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clamped = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy));
}

/**
 * Ramer–Douglas–Peucker over a flat point list.
 *
 * Iterative rather than recursive: a 4,000-point stroke recursing per point can
 * exhaust the stack in a browser, and losing the whole annotation to a
 * RangeError is a far worse outcome than a slightly larger stroke.
 */
export function simplifyInkPath(
  path: readonly number[],
  tolerance = INK_SIMPLIFY_TOLERANCE,
): number[] {
  const count = Math.floor(path.length / 2);
  if (count <= 2 || tolerance <= 0) return [...path].slice(0, count * 2);

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const ax = path[first * 2]!;
    const ay = path[first * 2 + 1]!;
    const bx = path[last * 2]!;
    const by = path[last * 2 + 1]!;
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(path[i * 2]!, path[i * 2 + 1]!, ax, ay, bx, by);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worst > tolerance && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(path[i * 2]!, path[i * 2 + 1]!);
  }
  return out;
}

/** Round coordinates to `decimals`, dropping the float noise a device emits. */
export function quantizeInkPath(
  path: readonly number[],
  decimals = INK_COORD_DECIMALS,
): number[] {
  const factor = 10 ** decimals;
  const out: number[] = [];
  for (const value of path) {
    if (!Number.isFinite(value)) return [];
    out.push(Math.round(value * factor) / factor);
  }
  return out;
}

/**
 * Storage-ready form of a captured stroke: simplified, rounded, and guaranteed
 * to be under {@link INK_MAX_POINTS} points. Returns `[]` for anything that is
 * not a drawable stroke, which callers treat as "nothing to save".
 */
export function compactInkPath(
  path: readonly number[],
  options?: { tolerance?: number; maxPoints?: number; decimals?: number },
): number[] {
  const maxPoints = options?.maxPoints ?? INK_MAX_POINTS;
  const decimals = options?.decimals ?? INK_COORD_DECIMALS;
  let tolerance = options?.tolerance ?? INK_SIMPLIFY_TOLERANCE;

  const even = [...path].slice(0, Math.floor(path.length / 2) * 2);
  if (even.length < 4 || even.some((n) => !Number.isFinite(n))) return [];

  let simplified = quantizeInkPath(simplifyInkPath(even, tolerance), decimals);
  // Doubling the tolerance roughly halves the surviving points, so this ends
  // after a handful of rounds even for a pathological scribble.
  let guard = 0;
  while (simplified.length / 2 > maxPoints && guard < 12) {
    tolerance *= 2;
    simplified = quantizeInkPath(simplifyInkPath(even, tolerance), decimals);
    guard += 1;
  }
  if (simplified.length / 2 > maxPoints) {
    // Still over budget: keep an evenly spaced subset so the stroke keeps its
    // full extent rather than stopping halfway.
    const count = Math.floor(simplified.length / 2);
    const step = count / maxPoints;
    const out: number[] = [];
    for (let i = 0; i < maxPoints; i++) {
      const index = Math.min(count - 1, Math.floor(i * step));
      out.push(simplified[index * 2]!, simplified[index * 2 + 1]!);
    }
    // The true end point matters more than an evenly spaced one.
    out[out.length - 2] = simplified[(count - 1) * 2]!;
    out[out.length - 1] = simplified[(count - 1) * 2 + 1]!;
    return out;
  }
  return simplified.length >= 4 ? simplified : [];
}

/** Estimated stored size of a path, in JSON characters. Used by tests/budgets. */
export function inkPathJsonSize(path: readonly number[]): number {
  return JSON.stringify(path).length;
}

export interface InkGroupCandidate {
  pageIndex: number;
  color: string;
  width: number;
  /** Strokes the target annotation already holds. */
  pathCount: number;
  /** When the group last took a stroke. */
  lastAt: number;
}

/**
 * Whether a new stroke belongs to the annotation a group is building.
 *
 * Grouping is not cosmetic: one row per stroke meant a written sentence was
 * twenty rows to store, twenty entries in the sidebar, and twenty deletes to
 * undo it. Strokes drawn in the same breath, in the same colour and nib, on the
 * same page, are one mark.
 */
export function canJoinInkGroup(
  group: InkGroupCandidate | null,
  next: { pageIndex: number; color: string; width: number; at: number },
  windowMs = INK_GROUP_WINDOW_MS,
): boolean {
  if (!group) return false;
  if (group.pathCount >= INK_MAX_PATHS_PER_ANNOTATION) return false;
  if (group.pageIndex !== next.pageIndex) return false;
  if (group.color !== next.color) return false;
  if (group.width !== next.width) return false;
  return next.at - group.lastAt <= windowMs;
}

/** Squared distance from a point to a segment — hit-testing without a sqrt. */
function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return perpendicularDistance(px, py, ax, ay, bx, by);
}

/**
 * True when `(x, y)` lies within `radius` of any segment of any path. Used by
 * the eraser and by move-drag hit detection, both of which must match what the
 * user sees rather than a bounding box.
 */
export function inkPathsHitTest(
  paths: readonly (readonly number[])[],
  x: number,
  y: number,
  radius: number,
): boolean {
  for (const path of paths) {
    const count = Math.floor(path.length / 2);
    if (count === 0) continue;
    if (count === 1) {
      if (Math.hypot(x - path[0]!, y - path[1]!) <= radius) return true;
      continue;
    }
    for (let i = 0; i + 1 < count; i++) {
      const d = pointSegmentDistance(
        x,
        y,
        path[i * 2]!,
        path[i * 2 + 1]!,
        path[(i + 1) * 2]!,
        path[(i + 1) * 2 + 1]!,
      );
      if (d <= radius) return true;
    }
  }
  return false;
}

/** Translate every path by `(dx, dy)`, keeping stored precision. */
export function translateInkPaths(
  paths: readonly (readonly number[])[],
  dx: number,
  dy: number,
  decimals = INK_COORD_DECIMALS,
): number[][] {
  const factor = 10 ** decimals;
  const round = (n: number) => Math.round(n * factor) / factor;
  return paths.map((path) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      out.push(round(path[i]! + dx), round(path[i + 1]! + dy));
    }
    return out;
  });
}

/** Bounding box `[x1, y1, x2, y2]` of a set of paths, or null when empty. */
export function inkPathsBounds(
  paths: readonly (readonly number[])[],
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i += 2) {
      const x = path[i]!;
      const y = path[i + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [minX, minY, maxX, maxY];
}
