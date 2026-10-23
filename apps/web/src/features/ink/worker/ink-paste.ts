import type { InkStroke } from "@weaveforge/core";

import type { InkWorkerEvent } from "../application/capture-protocol";
import type { InkBounds } from "../application/page-buffer";
import { reportHistory, reportState, type InkPageState } from "./ink-page-logic";

/** Add pasted strokes as one undoable draw, and select them so they can be moved. */
export function addStrokes(
  state: InkPageState,
  strokes: readonly InkStroke[],
  post: (event: InkWorkerEvent) => void,
  ensureLoop: () => void,
): void {
  const added: number[] = [];
  let bounds: InkBounds | null = null;
  for (const stroke of strokes) {
    const index = state.buffer.append(stroke);
    const geometry = state.buffer.stroke(index);
    if (!geometry) continue;
    state.renderer?.appendStroke(geometry, index);
    added.push(index);
    const b = geometry.bounds;
    bounds = bounds
      ? [Math.min(bounds[0], b[0]), Math.min(bounds[1], b[1]), Math.max(bounds[2], b[2]), Math.max(bounds[3], b[3])]
      : [b[0], b[1], b[2], b[3]];
  }
  if (added.length === 0) return;
  state.index?.invalidate();
  state.history.push({ kind: "draw", indices: added });
  state.redone = [];
  state.selection = added;
  state.renderer?.setSelection(added, { x: 0, y: 0 });
  ensureLoop();
  reportState(state, post);
  reportHistory(state, post);
  post({ type: "selected", indices: added, bounds });
}
