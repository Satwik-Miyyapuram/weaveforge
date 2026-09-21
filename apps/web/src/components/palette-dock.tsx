"use client";

/**
 * Where the floating pen palette sits in focus mode, and the two handles it
 * carries there: one to move it, one to fold it.
 *
 * Both writing surfaces — the ink note's bar and the PDF reader's pen rail —
 * float the same palette once the chrome is gone, and a hand that parks it in
 * the bottom-right corner on a note expects to find it there on a paper too.
 * So the dock is one preference, per user, kept in `localStorage` under one
 * key, and every palette reads and writes the same one.
 *
 * Eight docks: the four corners and the middle of each edge. The palette runs
 * as a column on the left and right edges (and in the corners, where a column
 * keeps clear of the page's top and bottom) and as a row along the top and
 * bottom, so it never covers more of the page than it has to.
 */

import { useCallback, useEffect, useState } from "react";

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
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
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

/**
 * The move handle: a 3×3 grid of docks, the centre left empty, that opens
 * from the palette's grip. Hidden outside focus mode by CSS, like the fold.
 */
export function PaletteDockButton({
  dock,
  onDock,
}: {
  dock: PaletteDock;
  onDock: (dock: PaletteDock) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ink-dock")) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);
  // The grid in reading order, with the empty centre in the middle.
  const cells: (PaletteDock | null)[] = [
    "top-left",
    "top",
    "top-right",
    "left",
    null,
    "right",
    "bottom-left",
    "bottom",
    "bottom-right",
  ];
  return (
    <div className="ink-dock">
      <button
        type="button"
        className="ink-tool ink-tool-icon-only ink-bar-dock"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Move the palette (${DOCK_LABEL[dock]})`}
        aria-label="Move the palette"
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
      {open && (
        <div className="ink-dock-grid" role="menu" aria-label="Palette position">
          {cells.map((cell, i) =>
            cell ? (
              <button
                key={cell}
                type="button"
                role="menuitemradio"
                className="ink-dock-cell"
                aria-checked={dock === cell}
                aria-label={DOCK_LABEL[cell]}
                title={DOCK_LABEL[cell]}
                onClick={() => {
                  onDock(cell);
                  setOpen(false);
                }}
              />
            ) : (
              <span key={`empty-${i}`} className="ink-dock-cell ink-dock-cell--empty" aria-hidden />
            ),
          )}
        </div>
      )}
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
