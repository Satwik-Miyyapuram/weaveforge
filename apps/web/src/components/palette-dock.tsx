"use client";

/**
 * Where the floating pen palette sits in focus mode, and the two handles it
 * carries there: one to move it, one to fold it.
 *
 * Both writing surfaces — the ink note's bar and the PDF reader's pen palette —
 * float the same palette once the chrome is gone, and a hand that parks it in
 * the bottom-right corner on a note expects to find it there on a paper too.
 * So the dock is one preference, per user, kept in `localStorage` under one
 * key, and every palette reads and writes the same one.
 *
 * The grip is dragged, not configured: the palette follows the hand and, on
 * release, snaps to the nearest of eight anchors. There is no menu of
 * positions — a list of corners is a second way to say what the drag already
 * says, and it is the slower one.
 *
 * Eight docks: the four corners and the middle of each edge. The palette runs
 * as a column on the left and right edges (and in the corners, where a column
 * keeps clear of the page's top and bottom) and as a row along the top and
 * bottom, so it never covers more of the page than it has to.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const PALETTE_DOCKS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export type PaletteDock = (typeof PALETTE_DOCKS)[number];

export const DEFAULT_PALETTE_DOCK: PaletteDock = "left";

const DOCK_KEY = "weaveforge.ink.palette-dock";
/** Fired on the window when a palette moves, so another mounted one follows. */
const DOCK_EVENT = "weaveforge:palette-dock";

const DOCK_LABEL: Record<PaletteDock, string> = {
  "top-left": "top left",
  top: "top",
  "top-right": "top right",
  left: "left",
  right: "right",
  "bottom-left": "bottom left",
  bottom: "bottom",
  "bottom-right": "bottom right",
};

/** Whether the palette runs as a row (top and bottom edges) or a column. */
export function isRowDock(dock: PaletteDock): boolean {
  return dock === "top" || dock === "bottom";
}

export function parsePaletteDock(raw: unknown): PaletteDock {
  return PALETTE_DOCKS.find((d) => d === raw) ?? DEFAULT_PALETTE_DOCK;
}

function readDock(): PaletteDock {
  try {
    return parsePaletteDock(window.localStorage.getItem(DOCK_KEY));
  } catch {
    return DEFAULT_PALETTE_DOCK;
  }
}

export function usePaletteDock(): [PaletteDock, (dock: PaletteDock) => void] {
  // The default on the server render; the stored choice replaces it on mount
  // so the static export and the first client paint agree.
  const [dock, setDockState] = useState<PaletteDock>(DEFAULT_PALETTE_DOCK);
  useEffect(() => {
    setDockState(readDock());
    const follow = () => setDockState(readDock());
    window.addEventListener(DOCK_EVENT, follow);
    window.addEventListener("storage", follow);
    return () => {
      window.removeEventListener(DOCK_EVENT, follow);
      window.removeEventListener("storage", follow);
    };
  }, []);
  const setDock = useCallback((next: PaletteDock) => {
    setDockState(next);
    try {
      window.localStorage.setItem(DOCK_KEY, next);
    } catch {
      /* private mode: the choice lasts the session */
    }
    window.dispatchEvent(new Event(DOCK_EVENT));
  }, []);
  return [dock, setDock];
}

/** Pointer travel below this is a tap on the grip, not a drag of the palette. */
const DRAG_SLOP_PX = 6;

/**
 * The dock nearest to where a dragged palette was let go: the one of the
 * eight anchors closest to the palette's centre, in the container's box.
 */
export function nearestPaletteDock(
  centre: { x: number; y: number },
  box: { width: number; height: number },
): PaletteDock {
  const anchors: Record<PaletteDock, { x: number; y: number }> = {
    "top-left": { x: 0, y: 0 },
    top: { x: box.width / 2, y: 0 },
    "top-right": { x: box.width, y: 0 },
    left: { x: 0, y: box.height / 2 },
    right: { x: box.width, y: box.height / 2 },
    "bottom-left": { x: 0, y: box.height },
    bottom: { x: box.width / 2, y: box.height },
    "bottom-right": { x: box.width, y: box.height },
  };
  let best: PaletteDock = DEFAULT_PALETTE_DOCK;
  let bestDistance = Infinity;
  for (const dock of PALETTE_DOCKS) {
    const a = anchors[dock];
    const d = (a.x - centre.x) ** 2 + (a.y - centre.y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = dock;
    }
  }
  return best;
}

/**
 * The move handle: a drag carries the whole palette under the pointer and, on
 * release, snaps it to the nearest of the eight docks. Hidden outside focus
 * mode by CSS, like the fold.
 *
 * While dragging, the palette is positioned by inline `left`/`top` (never a
 * transform, which would become the containing block of the colour menu's
 * fixed panel) and marked `data-dragging`, so its transitions pause.
 */
export function PaletteDockButton({
  dock,
  onDock,
}: {
  dock: PaletteDock;
  onDock: (dock: PaletteDock) => void;
}) {
  // The drag in progress, if any; `moved` flips once the pointer has left
  // the slop radius, and from then on the release is a drop.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    palette: HTMLElement;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const palette = event.currentTarget.closest<HTMLElement>(".ink-palette");
    if (!palette) return;
    const rect = palette.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      palette,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      if (
        Math.abs(event.clientX - drag.startX) < DRAG_SLOP_PX &&
        Math.abs(event.clientY - drag.startY) < DRAG_SLOP_PX
      ) {
        return;
      }
      drag.moved = true;
      drag.palette.setAttribute("data-dragging", "");
    }
    const container = drag.palette.offsetParent as HTMLElement | null;
    const box = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const style = drag.palette.style;
    style.inset = "auto";
    style.margin = "0";
    style.left = `${event.clientX - drag.offsetX - box.left}px`;
    style.top = `${event.clientY - drag.offsetY - box.top}px`;
    event.preventDefault();
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    const palette = drag.palette;
    const container = palette.offsetParent as HTMLElement | null;
    const box = container?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const rect = palette.getBoundingClientRect();
    const style = palette.style;
    style.inset = "";
    style.margin = "";
    style.left = "";
    style.top = "";
    palette.removeAttribute("data-dragging");
    if (cancelled) return;
    onDock(
      nearestPaletteDock(
        { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top },
        box,
      ),
    );
  };

  return (
    <div className="ink-dock">
      <button
        type="button"
        className="ink-tool ink-tool-icon-only ink-bar-dock"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        title={`Drag the palette to a corner or an edge (it is at the ${DOCK_LABEL[dock]})`}
        aria-label="Move the palette: drag it"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v18M3 12h18" />
          <path d="M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3" />
          <path d="M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
        </svg>
      </button>
    </div>
  );
}

/** The fold handle: the palette shrinks to its tools, OneNote's way. */
export function PaletteFoldButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ink-tool ink-tool-icon-only ink-bar-collapse"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? "Show all tools" : "Fold the tools away"}
      aria-label={collapsed ? "Show all tools" : "Fold the tools away"}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
      </svg>
    </button>
  );
}
