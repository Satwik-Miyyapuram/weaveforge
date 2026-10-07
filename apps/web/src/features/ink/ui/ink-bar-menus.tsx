"use client";

/**
 * The bar's two drop-downs: print/export, and the page layout the ink sits on.
 *
 * They live beside the bar rather than inside it because a menu owns state the
 * bar does not care about — which list is open, where it had to be shifted to
 * stay inside the toolbar, and which click closes it — and because the bar is
 * long enough without them.
 *
 * Both are drawn only when their handlers are handed over, so the PDF reader,
 * which prints nothing and has no paper of its own, shows neither.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type InkPaper } from "@weaveforge/core";

/**
 * One drop-down's own state: open or not, and the two refs it needs.
 *
 * The bar wraps, so a button can sit at the left end of a row on a narrow pane
 * and at the right end of one on a wide one — a fixed `left` or `right`
 * therefore hangs the list off the edge about half the time, and the pane clips
 * it (`overflow: hidden`, so a floating menu cannot escape it). Measured rather
 * than guessed, before the paint, and clamped to the bar rather than to the
 * window because the bar is what the clipping ancestor is sized to.
 */
export function useBarMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The list may be portalled out of the menu, so it counts as inside too.
      if (!menuRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const list = listRef.current;
    if (!menu || !list) return;

    const place = () => {
      const mr = menu.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 8;
      const lw = lr.width || 240;
      const lh = lr.height || 260;

      const palette = menu.closest<HTMLElement>(".ink-palette");
      const dock = palette?.getAttribute("data-dock") ?? "";

      let top = mr.bottom + 6;
      let left = mr.right - lw;

      if (dock === "left" || (dock.includes("left") && mr.left < 100)) {
        left = mr.right + 6;
        top = mr.top;
      } else if (dock === "right" || (dock.includes("right") && mr.right > vw - 100)) {
        left = mr.left - lw - 6;
        top = mr.top;
      } else if (dock === "bottom" || mr.top > vh / 2) {
        top = mr.top - lh - 6;
      }

      left = Math.max(pad, Math.min(left, vw - lw - pad));
      top = Math.max(pad, Math.min(top, vh - lh - pad));

      setPos({ top: Math.round(top), left: Math.round(left) });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return { open, setOpen, menuRef, listRef, pos };
}

export interface PrintMenuProps {
  onPrint: () => void;
  onExportPng: () => void;
  /** Vector export; absent, the item is not offered. */
  onExportSvg?: () => void;
}

export interface PaperMenuProps {
  paper: InkPaper;
  onPaper: (paper: InkPaper) => void;
}
