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
import { figureCornerHit } from "@weaveforge/core";

import { InkGesture, StrokeEdgeSplit } from "../application/ink-gesture";
import {
  claimPointer,
  ERASER_CURSOR,
  inkToolCursor,
  pointsAttribute,
  releasePointer,
  type TouchPoint,
} from "./ink-page-pointer";
import type { InkPageProps } from "./ink-page-props";
import { inkSheetRuleStyle } from "./ink-sheet-underlay";

export type { InkPageProps } from "./ink-page-props";

/** A figure's corner, for the resize hit-test. */
type FigureCorner = "nw" | "ne" | "se" | "sw";

export function InkPage({
  pageIndex,
  pageSize,
  scale,
  ink,
  paper,
  tool,
  project,
  penHandlers,
  canvasRef,
  sheetRef,
  view,
  onErase,
  onLasso,
  selectionBounds,
  onMoveSelection,
  onDragSelection,
  penOnly,
  penSeen,
  onPan,
  onPinch,
  onDropFile,
  below,
  figures = [],
  onFigureChange,
  onFigureActivate,
  onFigureDrop,
  editingFigure = null,
  above,
  ensurePage,
  penActive,
}: InkPageProps) {
  /** The last erase position, so a sweep is one segment per move and not a point. */
  const lastErase = useRef<{ x: number; y: number } | null>(null);
  /** Whether an image or PDF file is currently being dragged over the sheet. */
  const [isDragOver, setIsDragOver] = useState(false);
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
   * A figure drag in progress, by the figure's index and its corner — `null`
   * corner is a move. The `from` point and box are where the gesture began,
   * so each move is a placement against the origin rather than a delta of
   * deltas. The pen never starts one of these: it draws (a pen over a
   * photograph is a note), and this is the mouse's and the trackpad's path.
   */
  const figureDrag = useRef<{
    index: number;
    corner: FigureCorner | null;
    from: { x: number; y: number };
    box: { x: number; y: number; w: number; h: number };
    aspect: number;
  } | null>(null);
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
  // The whole pane, not the sheet's part of it: the canvas is docked to the
  // scroller's viewport (see the render below), so the neighbouring pages'
  // visible parts are its surface too.
  const viewWidth = Math.max(1, Math.round(view.width));
  const viewHeight = Math.max(1, Math.round(view.height));
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

  /** Each pointer's route from down to up; shared with the reader. */
  const inkGesture = useRef(new InkGesture(ERASER_CURSOR));
  /** A finger that landed on a figure and selected it: nothing to draw. */
  const figureTap = useRef(false);

  /**
   * The figure a pointer-down at `at` is over, and which corner — the corner
   * test runs first because a corner is inside the box too. Corners are in
   * CSS pixels (12, about the smallest a hand can own) converted to page
   * units, and generous: a hit is `corner + slack`, half the corner again.
   */
  const figureAt = useCallback(
    (at: { x: number; y: number }):
      | { index: number; corner: FigureCorner | null }
      | null => {
      const hit = figureCornerHit(scale);
      for (let index = figures.length - 1; index >= 0; index -= 1) {
        const one = figures[index];
        if (!one || index === editingFigure) continue;
        const nw = Math.hypot(at.x - one.x, at.y - one.y) <= hit;
        const ne = Math.hypot(at.x - (one.x + one.w), at.y - one.y) <= hit;
        const se =
          Math.hypot(at.x - (one.x + one.w), at.y - (one.y + one.h)) <= hit;
        const sw = Math.hypot(at.x - one.x, at.y - (one.y + one.h)) <= hit;
        if (nw || ne || se || sw) {
          return { index, corner: nw ? "nw" : ne ? "ne" : se ? "se" : "sw" };
        }
        if (
          at.x >= one.x &&
          at.x <= one.x + one.w &&
          at.y >= one.y &&
          at.y <= one.y + one.h
        ) {
          return { index, corner: null };
        }
      }
      return null;
    },
    [editingFigure, figures, scale],
  );

  /** The stroke against the live sheet's top and bottom; shared with the reader. */
  const edge = useRef(new StrokeEdgeSplit());

  /** The same pointer event moved to `at`. */
  const atPoint = (
    event: React.PointerEvent<HTMLCanvasElement>,
    at: { x: number; y: number },
  ): React.PointerEvent<HTMLCanvasElement> =>
    // The synthetic event is a plain object, so a prototype-chained copy
    // works; the native one is not (its getters reject a foreign `this`),
    // and the capture reads the sample's position from the synthetic one.
    Object.create(event, { clientX: { value: at.x }, clientY: { value: at.y } }) as React.PointerEvent<HTMLCanvasElement>;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch" && touchDown(event)) return;
      edge.current.begin({ x: event.clientX, y: event.clientY });
      // Before anything projects: the page under the pointer becomes the live
      // one, so `project` below measures the sheet that is about to be drawn on.
      ensurePage?.(event.clientX, event.clientY);
      let figureHit: { index: number; corner: FigureCorner | null; from: { x: number; y: number } } | null = null;
      // The pen's back tip erases whatever the bar says (eraser-tip.ts): the
      // decision is made once, here, and the route keeps it to the end.
      const route = inkGesture.current.down(event, {
        tool: tool === "eraser" ? "eraser" : tool === "lasso" ? "lasso" : "draw",
        tipErases: tool !== "lasso",
        // A mouse over a figure reaches the figure, not the ink: with a writing
        // tool the mouse drags the figure, the same division of labour as the
        // pen (notes) and the hand (paper). Alt reaches the ink under it.
        intercept: () => {
          if (event.pointerType !== "mouse" || event.altKey || !onFigureChange) return false;
          const at = project(event.clientX, event.clientY);
          const hit = at !== null ? figureAt(at) : null;
          if (hit && at && figures[hit.index]) figureHit = { ...hit, from: at };
          return figureHit !== null;
        },
        // Down inside the selected box is a drag; anywhere else starts a new loop.
        hitSelection: () => {
          const at = project(event.clientX, event.clientY);
          const b = selectionBounds;
          return !!(at && b && at.x >= b[0] && at.x <= b[2] && at.y >= b[1] && at.y <= b[3]);
        },
      });
      if (route === "erase") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        lastErase.current = at;
        claimPointer(event);
        onErase(at, at);
        return;
      }
      if (route === "intercept" && figureHit) {
        const { index, corner, from } = figureHit;
        const one = figures[index]!;
        claimPointer(event);
        // Selecting is the click; the drag that may follow is a bonus.
        onFigureActivate?.(index);
        figureDrag.current = {
          index,
          corner,
          from,
          box: { x: one.x, y: one.y, w: one.w, h: one.h },
          aspect: one.w / Math.max(1, one.h),
        };
        return;
      }
      if (route === "drag" || route === "lasso") {
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        claimPointer(event);
        if (route === "drag") {
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
      ensurePage,
      figureAt,
      figures,
      onErase,
      onFigureActivate,
      onFigureChange,
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
      if (figureTap.current) return;
      const route = inkGesture.current.route(event.pointerId);
      if (route === "erase") {
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
      const held = figureDrag.current;
      if (held) {
        event.preventDefault();
        const at = project(event.clientX, event.clientY);
        if (!at) return;
        const dx = at.x - held.from.x;
        const dy = at.y - held.from.y;
        if (held.corner === null) {
          // A move keeps the box and goes where the pointer goes. Sideways it
          // is clamped to the paper; up and down it may leave the page for
          // the one above or below, and the drop decides where it lands
          // (§useFigureDrop).
          onFigureChange?.(held.index, {
            x: Math.round(
              Math.min(
                Math.max(held.box.x + dx, -held.box.w / 2),
                pageSize.width - held.box.w / 2,
              ),
            ),
            y: Math.round(held.box.y + dy),
            w: held.box.w,
            h: held.box.h,
          });
          return;
        }
        // A corner resize: the opposite corner holds still and the dragged one
        // follows the pointer. The aspect the image came with holds too — a
        // photo does not become a different photo by being resized — unless
        // Shift is held, which is a deliberate distortion. When the aspect
        // holds, whichever axis the pointer moved further along wins and the
        // other follows, so the corner never lags the hand.
        const signX = held.corner === "ne" || held.corner === "se" ? 1 : -1;
        const signY = held.corner === "se" || held.corner === "sw" ? 1 : -1;
        const growW = held.box.w + signX * dx;
        const growH = held.box.h + signY * dy;
        let w = Math.max(30, Math.round(growW));
        let h = Math.max(30, Math.round(growH));
        if (!event.shiftKey) {
          const movedW = Math.abs(growW - held.box.w) / Math.max(1, held.box.w);
          const movedH = Math.abs(growH - held.box.h) / Math.max(1, held.box.h);
          if (movedW >= movedH) {
            w = Math.max(30, Math.round(growW));
            h = Math.max(30, Math.round(w / held.aspect));
          } else {
            h = Math.max(30, Math.round(growH));
            w = Math.max(30, Math.round(h * held.aspect));
          }
        }
        // The opposite corner is the anchor: the dragged side is the one that
        // moves, the far edge stays where the figure began.
        const x =
          held.corner === "nw" || held.corner === "sw"
            ? held.box.x + held.box.w - w
            : held.box.x;
        const y =
          held.corner === "nw" || held.corner === "ne"
            ? held.box.y + held.box.h - h
            : held.box.y;
        onFigureChange?.(held.index, { x: Math.round(x), y: Math.round(y), w, h });
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
      // A stroke that leaves the live sheet is cut at its top or bottom edge,
      // and the pen's travel through the gap between pages leaves no mark. The
      // page under the pen becomes the live one, and the stroke starts again
      // where the pen crosses onto it. Sideways the paper is open: the writing
      // margin is part of the sheet.
      if (route === "draw" && ensurePage && (penActive?.() || edge.current.outside)) {
        const box = sheetRef.current?.getBoundingClientRect();
        const area = box ? { left: -Infinity, right: Infinity, top: box.top, bottom: box.bottom } : null;
        const step = edge.current.move({ x: event.clientX, y: event.clientY }, area);
        if (step.kind === "exit") {
          penHandlers.onPointerUp(atPoint(event, step.at));
          ensurePage(event.clientX, event.clientY);
          return;
        }
        if (step.kind === "outside") {
          ensurePage(event.clientX, event.clientY);
          return;
        }
        if (step.kind === "enter") {
          // Not forwarded as a move: its coalesced samples lie in the gap.
          penHandlers.onPointerDown(atPoint(event, step.at));
          return;
        }
      } else {
        edge.current.begin({ x: event.clientX, y: event.clientY });
      }
      penHandlers.onPointerMove(event);
    },
    [
      ensurePage,
      penActive,
      sheetRef,
      onDragSelection,
      onErase,
      onFigureChange,
      pageSize.width,
      penHandlers,
      project,
      publishLasso,
      tool,
      touchMove,
    ],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const route = inkGesture.current.up(event.pointerId);
      edge.current.end();
      if (event.pointerType === "touch" && touchUp(event)) return;
      if (figureTap.current) {
        figureTap.current = false;
        releasePointer(event);
        return;
      }
      if (figureDrag.current) {
        // The move already wrote each placement as it happened; all that is
        // left is to let go, and to say where it was let go of — a move past
        // the page's edge lands on the page it was dropped on.
        const held = figureDrag.current;
        figureDrag.current = null;
        releasePointer(event);
        if (held.corner === null) onFigureDrop?.(held.index);
        return;
      }
      if (route === "erase") {
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
    [onFigureDrop, onLasso, onMoveSelection, penHandlers, project, publishLasso, tool, touchUp],
  );

  // One table for both surfaces that carry ink (`ink-page-pointer.ts`), so the
  // eraser and the ink dot are the same on a sheet and a paper.
  const cursor = inkToolCursor(tool, ink);

  // The overlay is drawn in page units and scaled by the viewBox, so the lasso
  // and the selection box need no projection of their own.
  const box = selectionBounds;
  const shift = dragOffset ?? { x: 0, y: 0 };

  return (
    <div
      className="ink-page ink-page-live"
      data-page={pageIndex}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/*
        The canvas's dock: sticky at the top of the rail's full-height live
        layer, so the canvas covers the pane wherever the scroll is — over
        this sheet, the gap, and the next page's visible part alike. A pen
        that lands anywhere in the pane lands on the canvas, never on the
        static ink beneath, where the browser would read a pen-down as the
        start of a scroll. `touch-action: none` ensures the browser never
        attempts to interpret drawing gestures as scrolling or panning,
        preventing Chromium from dispatching pointercancel and dropping ink
        strokes (§3.3).
      */}
      <div className="ink-canvas-dock">
        <canvas
          ref={canvasRef}
          className="ink-canvas"
          style={{
            width: `${viewWidth}px`,
            height: `${viewHeight}px`,
            touchAction: "none",
            cursor,
          }}
          width={viewWidth}
          height={viewHeight}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(event) => {
            // The double-click is the figure's controls: a click the figure
            // can receive, because a single one is a drag the page routes.
            const at = project(event.clientX, event.clientY);
            const hit = at !== null ? figureAt(at) : null;
            if (hit) onFigureActivate?.(hit.index);
          }}
          onContextMenu={(event) => event.preventDefault()}
          aria-label={`Ink page ${pageIndex + 1}, drawing surface`}
          role="img"
        />
      </div>
      {/* The sheet, at its slot: `--ink-slot-top` is set by the rail. */}
      <div className="ink-page-row">
      <div
        ref={sheetRef}
        className={`ink-sheet paper-${paper}${isDragOver ? " is-drag-over" : ""}`}
        style={{ width: `${width}px`, height: `${height}px`, ...inkSheetRuleStyle(scale) }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!isDragOver) setIsDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && onDropFile)
            onDropFile(file, project(e.clientX, e.clientY));
        }}
      >
      {below}
      {above}
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
      </div>
    </div>
  );
}
