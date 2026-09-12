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

import { useCallback, useRef, useState } from "react";

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
  /** A drag in progress: the selection is shown `dx, dy` page units from where it is. */
  onDragSelection?: (dx: number, dy: number) => void;
  /** Whether touch may draw at all, which is what `touch-action` follows. */
  penOnly: boolean;
  penSeen: boolean;
  /** One finger moved the page by `dx, dy` CSS pixels: scroll by that. */
  onPan?: (dx: number, dy: number) => void;
  /**
   * Two fingers moved apart or together: zoom by `factor` about the point
   * `clientX, clientY`, which is where the fingers are.
   */
  onPinch?: (factor: number, clientX: number, clientY: number) => void;
}

/** The eraser's cursor: a ring the size of a fingertip, hot spot at its centre. */
const ERASER_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.55)" stroke="#333" stroke-width="1.5"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="#333"/>' +
      "</svg>",
  ) +
  '") 12 12, crosshair';

/** Where each touch is, in client pixels, while it is down. */
type TouchPoint = { x: number; y: number };

/**
 * Take the pointer for an eraser sweep or a lasso loop. The same two steps the
 * pen path takes on a draw: without `preventDefault` Chromium on Windows reads a
 * pen-down as the start of a platform gesture, revokes the capture a few pixels
 * in and sends `pointercancel`, so the sweep erases one point and the loop never
 * closes. Capture can throw for a pointer the browser no longer tracks; that is
 * not worth aborting the handler over.
 */
function claimPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
  event.preventDefault();
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Already released or synthetic: the sweep still works without capture.
  }
}

function releasePointer(event: React.PointerEvent<HTMLCanvasElement>): void {
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  } catch {
    // Nothing to release.
  }
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
  onDragSelection,
  penOnly,
  penSeen,
  onPan,
  onPinch,
}: InkPageProps) {
  /** The last erase position, so a sweep is one segment per move and not a point. */
  const lastErase = useRef<{ x: number; y: number } | null>(null);
  /** The lasso path in page units, while it is being drawn. */
  const lasso = useRef<number[]>([]);
  /** The lasso as drawn so far, mirrored into state so the overlay can show it. */
  const [lassoPath, setLassoPath] = useState<readonly number[] | null>(null);
  const lassoFrame = useRef<number | null>(null);
  /** Where a selection drag began, while one is in progress. */
  const drag = useRef<{ x: number; y: number } | null>(null);
  /** The selection's live offset during a drag, in page units, for the overlay. */
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  /**
   * Fingers on the surface. One finger pans when touch is not drawing — a pen
   * has been seen, or the guard is up — and two fingers always pinch, whatever
   * the tool. The pen's own gate still sees the touch-down that starts a pinch,
   * so a finger stroke that was in progress is cancelled the way a palm is.
   */
  const touches = useRef(new Map<number, TouchPoint>());
  const gesture = useRef<"none" | "pan" | "pinch">("none");

  const width = Math.max(1, Math.round(pageSize.width * scale));
  const height = Math.max(1, Math.round(pageSize.height * scale));
  const fingerPans = penOnly || penSeen;

  /** One overlay update per frame, however fast the pointer reports. */
  const publishLasso = useCallback(() => {
    if (lassoFrame.current !== null) return;
    lassoFrame.current = requestAnimationFrame(() => {
      lassoFrame.current = null;
      setLassoPath(lasso.current.length >= 4 ? [...lasso.current] : null);
    });
  }, []);

  const touchDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
      const map = touches.current;
      map.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (map.size >= 2) {
        // The gate is told about the second finger so it drops the first as a
        // palm; from here on neither finger draws.
        if (gesture.current !== "pan" && !fingerPans) {
          penHandlers.onPointerDown(event);
        }
        gesture.current = "pinch";
        claimPointer(event);
        return true;
      }
      if (fingerPans) {
        gesture.current = "pan";
        claimPointer(event);
        return true;
      }
      gesture.current = "none";
      return false;
    },
    [fingerPans, penHandlers],
  );

  const touchMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
      const map = touches.current;
      const was = map.get(event.pointerId);
      if (!was) return false;
      const now = { x: event.clientX, y: event.clientY };
      if (gesture.current === "pinch" && map.size >= 2) {
        const other = [...map.entries()].find(
          ([id]) => id !== event.pointerId,
        )![1];
        const before = Math.hypot(was.x - other.x, was.y - other.y);
        const after = Math.hypot(now.x - other.x, now.y - other.y);
        const midBefore = { x: (was.x + other.x) / 2, y: (was.y + other.y) / 2 };
        const midAfter = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        map.set(event.pointerId, now);
        event.preventDefault();
        if (before > 0 && after > 0 && Math.abs(after - before) > 0.01) {
          onPinch?.(after / before, midAfter.x, midAfter.y);
        }
        const dx = midAfter.x - midBefore.x;
        const dy = midAfter.y - midBefore.y;
        if (dx !== 0 || dy !== 0) onPan?.(dx, dy);
        return true;
      }
      if (gesture.current === "pan") {
        map.set(event.pointerId, now);
        event.preventDefault();
        onPan?.(now.x - was.x, now.y - was.y);
        return true;
      }
      return false;
    },
    [onPan, onPinch],
  );

  const touchUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
      const map = touches.current;
      if (!map.has(event.pointerId)) return false;
      map.delete(event.pointerId);
      const handled = gesture.current !== "none";
      if (map.size === 0) gesture.current = "none";
      // A pinch that loses a finger becomes a pan rather than a stroke: the
      // remaining finger was never a pen.
      else if (gesture.current === "pinch") gesture.current = "pan";
      if (handled) releasePointer(event);
      return handled;
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch" && touchDown(event)) return;
      if (tool === "eraser") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        lastErase.current = at;
        claimPointer(event);
        onErase(at, at);
        return;
      }
      if (tool === "lasso") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        claimPointer(event);
        // Down inside the selected box is a drag; anywhere else starts a new loop.
        const b = selectionBounds;
        if (b && at.x >= b[0] && at.x <= b[2] && at.y >= b[1] && at.y <= b[3]) {
          drag.current = at;
          setDragOffset({ x: 0, y: 0 });
          return;
        }
        lasso.current = [at.x, at.y];
        publishLasso();
        return;
      }
      penHandlers.onPointerDown(event);
    },
    [
      onErase,
      penHandlers,
      project,
      publishLasso,
      selectionBounds,
      tool,
      touchDown,
    ],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch" && touchMove(event)) return;
      if (tool === "eraser") {
        if (!lastErase.current) return;
        event.preventDefault();
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
        event.preventDefault();
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        if (drag.current) {
          const dx = at.x - drag.current.x;
          const dy = at.y - drag.current.y;
          setDragOffset({ x: dx, y: dy });
          // The strokes follow the box: the worker draws them shifted.
          onDragSelection?.(dx, dy);
          return;
        }
        if (lasso.current.length === 0) return;
        lasso.current.push(at.x, at.y);
        publishLasso();
        return;
      }
      penHandlers.onPointerMove(event);
    },
    [
      onDragSelection,
      onErase,
      penHandlers,
      project,
      publishLasso,
      tool,
      touchMove,
    ],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch" && touchUp(event)) return;
      if (tool === "eraser") {
        lastErase.current = null;
        releasePointer(event);
        return;
      }
      if (tool === "lasso") {
        releasePointer(event);
        const from = drag.current;
        if (from) {
          drag.current = null;
          setDragOffset(null);
          // The move is one worker message at the end, so it is one undo entry.
          const to =
            event.type === "pointercancel"
              ? from
              : project(event.clientX, event.clientY);
          const dx = to ? to.x - from.x : 0;
          const dy = to ? to.y - from.y : 0;
          // Always, even by nothing: it ends the worker's drag preview.
          onMoveSelection?.(dx, dy);
          return;
        }
        const path = lasso.current;
        lasso.current = [];
        publishLasso();
        if (path.length >= 6) onLasso?.(path);
        return;
      }
      penHandlers.onPointerUp(event);
    },
    [onLasso, onMoveSelection, penHandlers, project, publishLasso, tool, touchUp],
  );

  const cursor =
    tool === "eraser"
      ? ERASER_CURSOR
      : tool === "lasso"
        ? "crosshair"
        : undefined;

  // The overlay is drawn in page units and scaled by the viewBox, so the lasso
  // and the selection box need no projection of their own.
  const box = selectionBounds;
  const shift = dragOffset ?? { x: 0, y: 0 };

  return (
    <div
      className="ink-page"
      data-page={pageIndex}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/*
        `touch-action: none` ensures the browser never attempts to interpret drawing
        gestures as scrolling or panning, preventing Chromium from dispatching pointercancel
        and dropping ink strokes (§3.3).
      */}
      <canvas
        ref={canvasRef}
        className={`ink-canvas paper-${paper}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          touchAction: "none",
          cursor,
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
      {(lassoPath || box) && (
        <svg
          className="ink-overlay"
          aria-hidden="true"
          width={width}
          height={height}
          viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
          preserveAspectRatio="none"
        >
          {lassoPath && (
            <polyline
              className="ink-lasso"
              points={pointsAttribute(lassoPath)}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {box && (
            <rect
              className="ink-selection"
              x={box[0] + shift.x - 20}
              y={box[1] + shift.y - 20}
              width={Math.max(1, box[2] - box[0] + 40)}
              height={Math.max(1, box[3] - box[1] + 40)}
              rx={12}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}

/** `x,y x,y …` for a polyline, from a flat list. */
function pointsAttribute(path: readonly number[]): string {
  let out = "";
  for (let i = 0; i + 1 < path.length; i += 2) {
    out += `${path[i]},${path[i + 1]} `;
  }
  return out.trim();
}
