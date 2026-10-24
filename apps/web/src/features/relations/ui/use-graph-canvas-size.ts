"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The canvas's pixel size: its wrap's width, and either the wrap's height
 * (`fill`) or the room the page has below the wrap's top edge.
 */
export function useGraphCanvasSize(
  wrapRef: RefObject<HTMLDivElement | null>,
  fill: boolean,
): { width: number; height: number } {
  const [width, setWidth] = useState(760);
  const [measuredH, setMeasuredH] = useState(560);
  /**
   * The height the *page* has room for, in normal (non-focus) mode.
   *
   * The old cap — `min(560px, 62% of the viewport)` — left the bottom of the
   * window dark on anything taller than a laptop, and shorter on a small one.
   * Measured instead: from the wrap's own top edge to the bottom of the
   * viewport, less a slice for the legend that sits under the canvas, so the
   * graph ends where the screen does whatever the header above it did. First
   * paint uses the old viewport math until the measurement lands.
   */
  const [availableH, setAvailableH] = useState<number | null>(null);

  useEffect(() => {
    if (fill) return;
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const vh = window.innerHeight;
      // Where the canvas starts — below the header, the warning and any
      // error line the screen has stacked above it.
      const top = el.getBoundingClientRect().top;
      // The legend row under the canvas and the shell's own breathing room.
      const reserve = 64;
      setAvailableH(Math.max(320, Math.min(Math.round(vh - reserve), Math.round(vh - top - reserve))));
    };
    measure();
    // A late layout shift (fonts, the warning mounting) moves the top edge.
    const late = window.setTimeout(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener("resize", measure);
    };
  }, [fill, wrapRef]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      setWidth(Math.max(280, Math.round(e.contentRect.width)));
      if (fill) setMeasuredH(Math.max(240, Math.round(e.contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill, wrapRef]);

  const height = fill
    ? measuredH
    : availableH ??
      (() => {
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        // Mobile: use more of the tall viewport; desktop caps at 560.
        const isNarrow = typeof window !== "undefined" && window.innerWidth < 900;
        return isNarrow
          ? Math.max(320, Math.round(vh * 0.72))
          : Math.min(560, Math.round(vh * 0.62));
      })();
  return { width, height };
}
