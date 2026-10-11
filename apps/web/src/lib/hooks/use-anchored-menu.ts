"use client";

import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from "react";

export interface MenuRect {
  left: number;
  width: number;
  /** Set when the menu opens downward. */
  top?: number;
  /** Set when it opens upward, measured from the viewport bottom. */
  bottom?: number;
}

const MARGIN = 8;

/**
 * Pins a portalled `position: fixed` menu to its trigger in viewport coordinates.
 *
 * An absolutely positioned menu is clipped by any ancestor that scrolls or hides
 * overflow (the PDF toolbar, the phone filter row), so the menu lives on <body>.
 * It opens upward when there is less than `maxHeight` below and more room above,
 * is nudged back inside the viewport after it renders, and follows scroll/resize.
 * `remeasure` re-runs the nudge when the menu's content (and so its width) changes.
 */
export function useAnchoredMenu(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  maxHeight: number,
  remeasure?: unknown,
) {
  const [rect, setRect] = useState<MenuRect | null>(null);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < maxHeight && r.top > below;
    setRect({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [triggerRef, maxHeight]);

  // Width is only known after paint; settles in one pass since a menu inside the margin sets no state.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.getBoundingClientRect();
    if (!el) return;
    const overflowRight = el.right - (window.innerWidth - MARGIN);
    const overflowLeft = MARGIN - el.left;
    const dx = overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0;
    if (dx === 0) return;
    setRect((prev) => (prev ? { ...prev, left: prev.left + dx } : prev));
  }, [open, listRef, rect?.left, rect?.width, remeasure]);

  // Capture phase catches scrolls in the nested containers the trigger sits in.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return { rect, up: rect?.bottom != null, place };
}

/** Inline style for a menu placed by `useAnchoredMenu`. */
export function anchoredMenuStyle(rect: MenuRect): CSSProperties {
  return {
    left: rect.left,
    minWidth: rect.width,
    ...(rect.top != null ? { top: rect.top } : {}),
    ...(rect.bottom != null ? { bottom: rect.bottom } : {}),
  };
}
