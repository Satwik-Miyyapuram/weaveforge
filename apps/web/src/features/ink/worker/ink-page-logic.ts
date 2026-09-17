/// <reference lib="webworker" />

/**
 * Pure page-model logic for the ink worker: load, store, undo, redo,
 * erase and selection handling.
 *
 * Extracted from `ink-worker.ts` so the page geometry, stroke indices
 * and history manipulation stay apart from the worker's message pump
 * and rendering loop.
 */

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  decodeInkChunk,
  encodeInkChunk,
  pageFromChunk,
  type InkChunkCodec,
  type InkPage,
} from "@weaveforge/core";

import type {
  InkWorkerEvent,
  InkWorkerMessage,
} from "../application/capture-protocol";
import {
  InkPageBuffer,
  boundsOf,
  type InkBounds,
} from "../application/page-buffer";
import { InkStrokeIndex } from "../application/stroke-index";
import type { InkRenderer } from "../render/ink-renderer";

/** One undoable step. `indices` are buffer indices; a move also carries its delta. */
export type HistoryStep =
  | { kind: "erase"; indices: number[] }
  | { kind: "draw"; indices: number[] }
  | { kind: "move"; indices: number[]; dx: number; dy: number };

export interface InkPageState {
  pageIndex: number;
  buffer: InkPageBuffer;
  index: InkStrokeIndex | null;
  renderer: InkRenderer | null;
  codec: InkChunkCodec | null;
  history: HistoryStep[];
  redone: HistoryStep[];
  selection: number[];
  loading: boolean;
  background: ImageBitmap | null;
}

/** Tell the main thread what the page now holds. */
export function reportState(
  state: {
    pageIndex: number;
    buffer: InkPageBuffer;
    renderer: InkRenderer | null;
  },
  post: (event: InkWorkerEvent) => void,
): void {
  const stats = state.renderer?.renderStats;
  post({
    type: "page-state",
    pageIndex: state.pageIndex,
    strokes: state.buffer.liveCount,
    segments: stats?.segments ?? 0,
    backend: state.renderer?.backend ?? "none",
    width: state.buffer.width,
    height: state.buffer.height,
  });
}

/** Tell the bar how deep undo and redo go. */
export function reportHistory(
  state: { history: HistoryStep[]; redone: HistoryStep[] },
  post: (event: InkWorkerEvent) => void,
): void {
  post({
    type: "history",
    undo: state.history.length,
    redo: state.redone.length,
  });
}

/** Load a page's bytes into the buffer and the renderer. */
export async function loadPage(
  state: InkPageState,
  message: Extract<InkWorkerMessage, { type: "load-page" }>,
  post: (event: InkWorkerEvent) => void,
): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  try {
    state.pageIndex = message.pageIndex;
    // The whole decode happens here, off the main thread, which is the reason the
    // protocol carries bytes rather than a parsed page.
    const model = message.chunk
      ? pageFromChunk(
          await decodeInkChunk(
            message.chunk instanceof Uint8Array
              ? message.chunk
              : new Uint8Array(message.chunk),
            state.codec ?? undefined,
          ),
        )
      : {
          width: INK_A4_WIDTH,
          height: INK_A4_HEIGHT,
          paper: "blank" as const,
          background: 0,
          strokes: [],
          lines: [],
        };
    installPage(state, model, post);
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.loading = false;
  }
}

/** Put a page model in place of the current one: buffer, index, renderer, history. */
export function installPage(
  state: InkPageState,
  model: InkPage,
  post: (event: InkWorkerEvent) => void,
): void {
  state.buffer = new InkPageBuffer(model);
  // One rebuild per page load, which is where a packed tree belongs: not during a
  // gesture, and not per stroke (§6.2.4).
  state.index = new InkStrokeIndex(state.buffer);
  state.index.rebuild();
  state.history = [];
  state.redone = [];
  state.selection = [];
  state.renderer?.setPage(
    { width: model.width, height: model.height },
    model.paper,
  );
  state.renderer?.setBackground(state.background);
  state.renderer?.setStrokes(state.buffer.allStrokes());
  state.renderer?.setSelection([], { x: 0, y: 0 });
  reportState(state, post);
  reportHistory(state, post);
  post({ type: "selected", indices: [], bounds: null });
}

/** Pack the page as the sidecar stores it, and hand the bytes over. */
export async function savePage(
  state: Pick<InkPageState, "buffer" | "pageIndex" | "codec">,
  requestId: number,
  post: (event: InkWorkerEvent, transfer?: Transferable[]) => void,
): Promise<void> {
  const page = state.buffer.toPage();
  const strokes = page.strokes.length;
  if (strokes === 0) {
    post({
      type: "page-saved",
      requestId,
      pageIndex: state.pageIndex,
      bytes: null,
      strokes,
    });
    return;
  }
  const bytes = await encodeInkChunk(page, state.codec ?? undefined);
  post(
    {
      type: "page-saved",
      requestId,
      pageIndex: state.pageIndex,
      bytes,
      strokes,
    },
    [bytes.buffer],
  );
}

/** Take a set of strokes out, as one history step, and tell the screen. */
export function eraseIndices(
  state: InkPageState,
  indices: readonly number[],
  post: (event: InkWorkerEvent) => void,
  kind: "erase" | "draw" = "erase",
): number[] {
  const removed: number[] = [];
  for (const index of indices) {
    if (state.buffer.erase(index)) {
      state.renderer?.removeStroke(index);
      removed.push(index);
    }
  }
  if (removed.length > 0) {
    if (kind === "erase") {
      state.history.push({ kind: "erase", indices: removed });
      state.redone = [];
    }
    state.index?.invalidate();
    post({ type: "erased", indices: removed });
    reportState(state, post);
    reportHistory(state, post);
  }
  return removed;
}

/** Bring erased strokes back, re-uploading each at its own index. */
export function restoreIndices(
  state: InkPageState,
  indices: readonly number[],
  post: (event: InkWorkerEvent) => void,
): void {
  for (const index of indices) {
    if (!state.buffer.restore(index)) continue;
    const geometry = state.buffer.stroke(index);
    if (geometry) state.renderer?.appendStroke(geometry, index);
  }
  state.index?.invalidate();
  reportState(state, post);
}

/** Translate strokes in place. The geometry is the buffer's own, so it is edited. */
export function translateIndices(
  state: InkPageState,
  indices: readonly number[],
  dx: number,
  dy: number,
  post: (event: InkWorkerEvent) => void,
): void {
  for (const index of indices) {
    const geometry = state.buffer.stroke(index);
    if (!geometry) continue;
    for (let i = 0; i < geometry.x.length; i += 1) {
      geometry.x[i] = geometry.x[i]! + dx;
      geometry.y[i] = geometry.y[i]! + dy;
    }
    geometry.bounds = boundsOf(geometry.x, geometry.y);
    state.renderer?.removeStroke(index);
    state.renderer?.appendStroke(geometry, index);
  }
  state.index?.invalidate();
  reportState(state, post);
}

/**
 * Whether a point is inside a closed polygon, by the even-odd rule.
 *
 * `polygon` is flat `[x, y, …]` in page units. The lasso is a hand-drawn loop,
 * so the polygon is closed implicitly from its last point back to its first.
 */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: readonly number[],
): boolean {
  const count = polygon.length / 2;
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = polygon[i * 2]!;
    const yi = polygon[i * 2 + 1]!;
    const xj = polygon[j * 2]!;
    const yj = polygon[j * 2 + 1]!;
    const crosses =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Select what a lasso loop enclosed: strokes with most of their points inside. */
export function lasso(
  state: InkPageState,
  polygon: readonly number[],
  post: (event: InkWorkerEvent) => void,
  ensureLoop: () => void,
): void {
  if (polygon.length < 6) {
    state.selection = [];
    state.renderer?.setSelection([], { x: 0, y: 0 });
    post({ type: "selected", indices: [], bounds: null });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygon.length; i += 2) {
    minX = Math.min(minX, polygon[i]!);
    maxX = Math.max(maxX, polygon[i]!);
    minY = Math.min(minY, polygon[i + 1]!);
    maxY = Math.max(maxY, polygon[i + 1]!);
  }
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const box: InkBounds = [minX, minY, maxX, maxY];
  const chosen: number[] = [];
  let bounds: InkBounds | null = null;
  for (const candidate of index.nearBox(box)) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry || geometry.x.length === 0) continue;
    let inside = 0;
    for (let i = 0; i < geometry.x.length; i += 1) {
      if (pointInPolygon(geometry.x[i]!, geometry.y[i]!, polygon)) inside += 1;
    }
    if (inside * 2 < geometry.x.length) continue;
    chosen.push(candidate);
    const b = geometry.bounds;
    bounds = bounds
      ? [
          Math.min(bounds[0], b[0]),
          Math.min(bounds[1], b[1]),
          Math.max(bounds[2], b[2]),
          Math.max(bounds[3], b[3]),
        ]
      : [b[0], b[1], b[2], b[3]];
  }
  state.selection = chosen;
  state.renderer?.setSelection(chosen, { x: 0, y: 0 });
  ensureLoop();
  post({ type: "selected", indices: chosen, bounds });
}

/** Erase along a swept segment, and report what went. */
export function erase(
  state: InkPageState,
  from: { x: number; y: number },
  to: { x: number; y: number },
  post: (event: InkWorkerEvent) => void,
): void {
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const candidates = index.nearSegment(from.x, from.y, to.x, to.y);
  const removed: number[] = [];
  for (const candidate of candidates) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry) continue;
    // A bounds hit is a candidate, not a hit: the eraser matches what the user sees,
    // so the path decides. The nib's radius is the eraser's own from §6.3.
    if (!strokeNearPoint(geometry, from, to)) continue;
    removed.push(candidate);
  }
  eraseIndices(state, removed, post);
}

/**
 * Whether a stroke passes near a swept segment.
 *
 * The index returned candidates by bounding box; this is the exact test, and it is
 * the *only* place a pick decides anything. It is deliberately the same shape as the
 * reader's `inkPathsHitTest` — distance from the point to each segment — because the
 * two features must agree about what "under the eraser" means.
 */
export function strokeNearPoint(
  stroke: { x: Float32Array; y: Float32Array },
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius = 30,
): boolean {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius),
  );
  const r2 = radius * radius;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const px = from.x + (to.x - from.x) * t;
    const py = from.y + (to.y - from.y) * t;
    // Distance to each *segment*, not each vertex: a packed stroke keeps only the
    // points that bend, so a straight line is two vertices a page apart.
    if (stroke.x.length === 1) {
      const dx = stroke.x[0]! - px;
      const dy = stroke.y[0]! - py;
      if (dx * dx + dy * dy <= r2) return true;
      continue;
    }
    for (let i = 0; i + 1 < stroke.x.length; i += 1) {
      if (
        distanceToSegmentSquared(
          px,
          py,
          stroke.x[i]!,
          stroke.y[i]!,
          stroke.x[i + 1]!,
          stroke.y[i + 1]!,
        ) <= r2
      ) {
        return true;
      }
    }
  }
  return false;
}

export function distanceToSegmentSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const length2 = vx * vx + vy * vy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length2));
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return dx * dx + dy * dy;
}

/** Undo the last action (erase, draw, or move). */
export function undo(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
): void {
  const step = state.history.pop();
  if (!step) return;
  if (step.kind === "erase") restoreIndices(state, step.indices, post);
  else if (step.kind === "draw") eraseIndices(state, step.indices, post, "draw");
  else translateIndices(state, step.indices, -step.dx, -step.dy, post);
  state.redone.push(step);
  reportHistory(state, post);
}

/** Redo the last undone action. */
export function redo(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
): void {
  const step = state.redone.pop();
  if (!step) return;
  if (step.kind === "erase") eraseIndices(state, step.indices, post, "draw");
  else if (step.kind === "draw") restoreIndices(state, step.indices, post);
  else translateIndices(state, step.indices, step.dx, step.dy, post);
  state.history.push(step);
  reportHistory(state, post);
}

/** Clear the current selection. */
export function clearSelection(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
  ensureLoop: () => void,
): void {
  state.selection = [];
  state.renderer?.setSelection([], { x: 0, y: 0 });
  post({ type: "selected", indices: [], bounds: null });
  ensureLoop();
}

/** Erase the selected strokes. */
export function deleteSelection(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
): void {
  const indices = state.selection;
  state.selection = [];
  state.renderer?.setSelection([], { x: 0, y: 0 });
  eraseIndices(state, indices, post);
  post({ type: "selected", indices: [], bounds: null });
}

/** Update the drag preview offset for the current selection. */
export function dragSelection(
  state: InkPageState,
  dx: number,
  dy: number,
  ensureLoop: () => void,
): void {
  if (state.selection.length === 0) return;
  state.renderer?.setSelection(state.selection, { x: dx, y: dy });
  ensureLoop();
}

/** Move the selected strokes by (dx, dy). */
export function moveSelection(
  state: InkPageState,
  dx: number,
  dy: number,
  post: (event: InkWorkerEvent) => void,
  ensureLoop: () => void,
): void {
  // The drag preview ends with the move, whether or not it went anywhere.
  state.renderer?.setSelection(state.selection, { x: 0, y: 0 });
  ensureLoop();
  if (state.selection.length === 0 || (dx === 0 && dy === 0)) return;
  translateIndices(state, state.selection, dx, dy, post);
  state.history.push({
    kind: "move",
    indices: [...state.selection],
    dx,
    dy,
  });
  state.redone = [];
  reportHistory(state, post);
}
