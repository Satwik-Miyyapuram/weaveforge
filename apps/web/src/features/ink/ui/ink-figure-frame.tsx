"use client";

/**
 * The frame primitives both figure tools share (§ink-figures): the eight
 * resize handles and the pointer drag that moves or resizes a box.
 */

import { useCallback, useRef } from "react";

import { FIGURE_HANDLES, type FigureHandle } from "@weaveforge/core";

/** A pointer drag in progress on the selected figure. */
export interface EditorDrag {
  pointerId: number;
  handle: FigureHandle | "move";
  from: { x: number; y: number };
  box: { x: number; y: number; w: number; h: number };
}

const CURSORS: Record<FigureHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/** Where a handle sits on its box, as CSS. */
function handleStyle(handle: FigureHandle): React.CSSProperties {
  const style: React.CSSProperties = { cursor: CURSORS[handle] };
  if (handle.includes("n")) style.top = 0;
  if (handle.includes("s")) style.bottom = 0;
  if (handle.includes("w")) style.left = 0;
  if (handle.includes("e")) style.right = 0;
  if (handle === "n" || handle === "s") style.left = "50%";
  if (handle === "e" || handle === "w") style.top = "50%";
  return style;
}

/** The eight resize handles on a frame, wired to one drag lifecycle. */
export function FrameHandles({
  begin,
  move,
  end,
}: {
  begin: (event: React.PointerEvent, handle: FigureHandle) => void;
  move: (event: React.PointerEvent) => void;
  end: (event: React.PointerEvent) => void;
}) {
  return FIGURE_HANDLES.map((handle) => (
    <span
      key={handle}
      className="ink-figure-handle"
      data-handle={handle}
      style={handleStyle(handle)}
      onPointerDown={(event) => begin(event, handle)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  ));
}

/** A pointer drag's lifecycle on a frame or a handle, shared by both tools. */
export function useFrameDrag(
  scale: number,
  onDrag: (held: EditorDrag, dx: number, dy: number, event: React.PointerEvent) => void,
  box: () => { x: number; y: number; w: number; h: number },
  onEnd?: (handle: FigureHandle | "move") => void,
) {
  const drag = useRef<EditorDrag | null>(null);
  const begin = useCallback(
    (event: React.PointerEvent, handle: FigureHandle | "move") => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      event.stopPropagation();
      // A pointer that is already gone (a pen lifted between the down and
      // this handler, a synthetic event) has no capture to take; the drag
      // still starts, it just ends at the first up that reaches the frame.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // see above
      }
      drag.current = {
        pointerId: event.pointerId,
        handle,
        from: { x: event.clientX, y: event.clientY },
        box: box(),
      };
    },
    [box],
  );
  const move = useCallback(
    (event: React.PointerEvent) => {
      const held = drag.current;
      if (!held || held.pointerId !== event.pointerId) return;
      event.preventDefault();
      onDrag(held, (event.clientX - held.from.x) / scale, (event.clientY - held.from.y) / scale, event);
    },
    [onDrag, scale],
  );
  const end = useCallback(
    (event: React.PointerEvent) => {
      const held = drag.current;
      if (held?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onEnd?.(held.handle);
    },
    [onEnd],
  );
  return { begin, move, end };
}
