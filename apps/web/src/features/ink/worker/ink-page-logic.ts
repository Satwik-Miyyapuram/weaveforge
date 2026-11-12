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
  errorMessage,
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
  boundsUnion,
  fromGeometry,
  type InkBounds,
} from "../application/parts-3";
import { ERASER_RADIUS, InkStrokeIndex } from "../application/stroke-index";
import type { InkRenderer } from "../render/parts-1";
import { readyCore } from "@/lib/rust-core";

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
  /** The latest `load-page` that arrived while one was in flight (19-06). */
  pendingLoad: Extract<InkWorkerMessage, { type: "load-page" }> | null;
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
    ink: state.buffer.liveStrokes().map(fromGeometry),
    ids: state.buffer.liveIndices(),
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

/**
 * Load a page's bytes into the buffer and the renderer. A load that arrives
 * while one is in flight waits; of several that wait, only the latest runs, so
 * quick page turns end on the last page asked for (19-06).
 *
 * The page index moves with the page, only once it is decoded: until then
 * saves and models still answer for the old page, and a page that fails to
 * decode leaves the old one as it was (19-03).
 */
export async function loadPage(
  state: InkPageState,
  message: Extract<InkWorkerMessage, { type: "load-page" }>,
  post: (event: InkWorkerEvent) => void,
): Promise<void> {
  if (state.loading) {
    state.pendingLoad = message;
    return;
  }
  state.loading = true;
  try {
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
    state.pageIndex = message.pageIndex;
    installPage(state, model, post, message.shown);
  } catch (error) {
    post({
      type: "error",
      message: errorMessage(error),
    });
  } finally {
    state.loading = false;
  }
  const queued = state.pendingLoad;
  if (queued) {
    state.pendingLoad = null;
    await loadPage(state, queued, post);
  }
}

/** Put a page model in place of the current one: buffer, index, renderer, history. */
export function installPage(
  state: InkPageState,
  model: InkPage,
  post: (event: InkWorkerEvent) => void,
  shown = 0,
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
  // The canvas draws what the sheet does not yet; drawing both doubles the ink.
  state.renderer?.setShown(Math.min(shown, model.strokes?.length ?? 0));
  state.renderer?.setSelection([], { x: 0, y: 0 });
  reportState(state, post);
  reportHistory(state, post);
  post({ type: "selected", indices: [], bounds: null });
}

/** Pack the page as the sidecar stores it, and hand the bytes over. */
export async function savePage(
  state: Pick<InkPageState, "buffer" | "pageIndex" | "codec" | "loading">,
  requestId: number,
  post: (event: InkWorkerEvent, transfer?: Transferable[]) => void,
): Promise<void> {
  // Taken with the page, before the encode yields: a load may move the index
  // meanwhile, and the bytes belong to the page packed here (19-02).
  const pageIndex = state.pageIndex;
  const page = state.buffer.toPage();
  const strokes = page.strokes.length;
  if (strokes === 0) {
    post({
      type: "page-saved",
      requestId,
      pageIndex,
      bytes: null,
      strokes,
      cleared: !state.loading,
    });
    return;
  }
  const bytes = await encodeInkChunk(page, state.codec ?? undefined);
  post(
    {
      type: "page-saved",
      requestId,
      pageIndex,
      bytes,
      strokes,
      cleared: false,
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
    if (kind === "erase") recordHistoryStep(state, { kind: "erase", indices: removed });
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
  const core = readyCore();
  const loop = Float64Array.from(polygon);
  const box = Array.from(core.inkPolygonBounds(loop)) as InkBounds;
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const chosen: number[] = [];
  let bounds: InkBounds | null = null;
  for (const candidate of index.nearBox(box)) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry || geometry.x.length === 0) continue;
    // Rust: `hit_test::lasso_keeps` (at least half the points inside the loop).
    if (!core.inkLassoKeeps(geometry.x, geometry.y, loop)) continue;
    chosen.push(candidate);
    bounds = boundsUnion(bounds, geometry.bounds);
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
  radius = ERASER_RADIUS,
): void {
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const candidates = index.nearSegment(from.x, from.y, to.x, to.y, radius);
  const removed: number[] = [];
  for (const candidate of candidates) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry) continue;
    // A bounds hit is a candidate, not a hit: the eraser matches what the user sees,
    // so the path decides. The nib's radius is the eraser's own from §6.3.
    if (!strokeNearPoint(geometry, from, to, radius)) continue;
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
  radius = ERASER_RADIUS,
): boolean {
  // Rust: `hit_test::stroke_near_segment`. Distance to each *segment*, not each vertex.
  return readyCore().inkStrokeNearSegment(
    stroke.x,
    stroke.y,
    from.x,
    from.y,
    to.x,
    to.y,
    radius,
  );
}

/** The page action an undo or redo asks for; decided by `wf_core::ink::stroke_history`. */
type StrokeAction = {
  op: "restore" | "erase" | "translate";
  indices: number[];
  dx?: number;
  dy?: number;
};

/** Record a fresh edit on the undo log; a new edit clears redo. */
export function recordHistoryStep(state: InkPageState, step: HistoryStep): void {
  stepStrokeHistory(state, { op: "record", step });
}

/** Run one request on the undo log (Rust decides), and keep its stacks. */
function stepStrokeHistory(
  state: InkPageState,
  op: { op: "record"; step: HistoryStep } | { op: "undo" } | { op: "redo" },
): StrokeAction | null {
  const out = readyCore().inkStrokeHistoryStep(
    { history: state.history, redone: state.redone },
    op,
  );
  state.history = out.stacks.history;
  state.redone = out.stacks.redone;
  return out.action;
}

/** Apply the page side of an undo or redo. */
function applyStrokeAction(
  state: InkPageState,
  action: StrokeAction,
  post: (event: InkWorkerEvent) => void,
): void {
  if (action.op === "restore") restoreIndices(state, action.indices, post);
  else if (action.op === "erase") eraseIndices(state, action.indices, post, "draw");
  else translateIndices(state, action.indices, action.dx ?? 0, action.dy ?? 0, post);
}

/** Undo the last action (erase, draw, or move). */
export function undo(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
): void {
  const action = stepStrokeHistory(state, { op: "undo" });
  if (!action) return;
  applyStrokeAction(state, action, post);
  reportHistory(state, post);
}

/** Redo the last undone action. */
export function redo(
  state: InkPageState,
  post: (event: InkWorkerEvent) => void,
): void {
  const action = stepStrokeHistory(state, { op: "redo" });
  if (!action) return;
  applyStrokeAction(state, action, post);
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
  recordHistoryStep(state, {
    kind: "move",
    indices: [...state.selection],
    dx,
    dy,
  });
  reportHistory(state, post);
}
