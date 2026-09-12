"use client";

/**
 * The page surface: the paper, the canvas, and the pointer routing that is not the
 * pen's.
 *
 * Presentational by design. Everything stateful — the worker, the tool, the
 * viewport — lives in {@link InkHost}, which passes the pen's handlers in. What
 * stays here is what needs to be *at* the element: the box the quadrant rule reads,
 * the coordinate projection, and the eraser's sweep, which has to know where the
 * pointer was as well as where it is.
 *
 * The eraser is not the pen: it erases rather than draws, and it must keep working
 * when the pointer is a mouse. So it is routed here and the host turns each swept
 * segment into one worker message — the pick happens off the main thread (§6.2.2),
 * which is why this component sends coordinates and not stroke indices.
 */

import { useCallback, useRef } from "react";

import type { InkBarTool } from "./ink-bar";

export interface InkPageProps {
  pageIndex: number;
  /** Page size in 0.1 mm. */
  pageSize: { width: number; height: number };
  /** CSS pixels per 0.1 mm, from the host's fit. */
  scale: number;
  paper: string;
  tool: InkBarTool | "shape";
  /** Client coordinates to page units in 0.1 mm, `null` off the page. */
  project: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
  /** The pen's own handlers, from `usePenCapture`. */
  penHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  };
  /** The canvas, for the host to measure and to transfer. */
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** One erase sweep, in page units. */
  onErase: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => void;
  /** A lasso is a region rather than a stroke; the host decides what it means. */
  onLasso?: (path: readonly number[]) => void;
  /**
   * The current selection's box in page units, `null` when nothing is selected.
   * A lasso pointer-down inside it drags the selection instead of drawing a
   * new loop.
   */
  selectionBounds?: readonly [number, number, number, number] | null;
  /** The drag ended: the selection moved by `dx, dy` page units. */
  onMoveSelection?: (dx: number, dy: number) => void;
  /** Whether touch may draw at all, which is what `touch-action` follows. */
  penOnly: boolean;
  penSeen: boolean;
}

export function InkPage({
  pageIndex,
  pageSize,
  scale,
  paper,
  tool,
  project,
  penHandlers,
  canvasRef,
  onErase,
  onLasso,
  selectionBounds,
  onMoveSelection,
  penOnly,
  penSeen,
}: InkPageProps) {
  /** The last erase position, so a sweep is one segment per move and not a point. */
  const lastErase = useRef<{ x: number; y: number } | null>(null);
  /** The lasso path in page units, while it is being drawn. */
  const lasso = useRef<number[]>([]);
  /** Where a selection drag began, while one is in progress. */
  const drag = useRef<{ x: number; y: number } | null>(null);

  const width = Math.max(1, Math.round(pageSize.width * scale));
  const height = Math.max(1, Math.round(pageSize.height * scale));

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === "eraser") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        lastErase.current = at;
        event.currentTarget.setPointerCapture(event.pointerId);
        onErase(at, at);
        return;
      }
      if (tool === "lasso") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        // Down inside the selected box is a drag; anywhere else starts a new loop.
        const b = selectionBounds;
        if (b && at.x >= b[0] && at.x <= b[2] && at.y >= b[1] && at.y <= b[3]) {
          drag.current = at;
          return;
        }
        lasso.current = [at.x, at.y];
        return;
      }
      penHandlers.onPointerDown(event);
    },
    [onErase, penHandlers, project, selectionBounds, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === "eraser") {
        if (!lastErase.current) return;
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        // One segment per move rather than one point: a 240 Hz pen moves several
        // millimetres between events, and a point query per event would leave
        // un-erased gaps along the sweep.
        onErase(lastErase.current, at);
        lastErase.current = at;
        return;
      }
      if (tool === "lasso") {
        if (drag.current) return;
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        lasso.current.push(at.x, at.y);
        return;
      }
      penHandlers.onPointerMove(event);
    },
    [onErase, penHandlers, project, tool],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === "eraser") {
        lastErase.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        return;
      }
      if (tool === "lasso") {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const from = drag.current;
        if (from) {
          drag.current = null;
          // The move is one worker message at the end, so it is one undo entry.
          const to =
            event.type === "pointercancel"
              ? from
              : project(event.clientX, event.clientY);
          const dx = to ? to.x - from.x : 0;
          const dy = to ? to.y - from.y : 0;
          if (dx !== 0 || dy !== 0) onMoveSelection?.(dx, dy);
          return;
        }
        const path = lasso.current;
        lasso.current = [];
        if (path.length >= 6) onLasso?.(path);
        return;
      }
      penHandlers.onPointerUp(event);
    },
    [onLasso, onMoveSelection, penHandlers, project, tool],
  );

  return (
    <div className="ink-page" data-page={pageIndex}>
      {/*
        `touch-action` follows the same rule the reader learned: while a pen is in
        use — or the wrist guard is on — touch must not scroll the canvas, because
        the hand would move the page under the pen. Otherwise a finger scrolls a long
        page, which is what a finger is for (§3.3).
      */}
      <canvas
        ref={canvasRef}
        className={`ink-canvas paper-${paper}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          touchAction: penOnly || penSeen ? "none" : "pan-y",
        }}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={`Ink page ${pageIndex + 1}, drawing surface`}
        role="img"
      />
    </div>
  );
}
