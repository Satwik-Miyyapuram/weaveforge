"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { EXPLORER_ROW_PX, type ExplorerViewport } from "../application/explorer-window";

/** Scroll is measured in steps of this many rows, so a scroll re-renders every few rows, not every pixel. */
const MEASURE_STEP_PX = 4 * EXPLORER_ROW_PX;

/** The painted row with this key, if it is painted. */
export function findRow(list: HTMLElement | null, key: string): HTMLElement | null {
  return list?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`) ?? null;
}

/**
 * The part of each section's rows on screen, keyed by section id.
 *
 * A section's rows scroll with `.explorer-body`, or inside their own list when
 * that list is the one that overflows, so the view is the overlap of the two
 * boxes measured from the list's first row. A collapsed section has no box and
 * so an empty view.
 */
function measureViews(body: HTMLElement): Record<string, ExplorerViewport> {
  const outer = body.getBoundingClientRect();
  const views: Record<string, ExplorerViewport> = {};
  for (const list of body.querySelectorAll<HTMLElement>("[data-section-rows]")) {
    const box = list.getBoundingClientRect();
    const origin = box.top - list.scrollTop;
    const top = Math.max(outer.top, box.top) - origin;
    const bottom = Math.min(outer.bottom, box.bottom) - origin;
    const from = Math.floor(top / MEASURE_STEP_PX) * MEASURE_STEP_PX;
    views[list.dataset.sectionRows!] = {
      scrollTop: from,
      height: Math.max(0, Math.ceil((bottom - from) / MEASURE_STEP_PX) * MEASURE_STEP_PX),
      rowsTop: 0,
    };
  }
  return views;
}

function sameViews(a: Record<string, ExplorerViewport> | null, b: Record<string, ExplorerViewport>) {
  if (!a) return false;
  const keys = Object.keys(b);
  return (
    keys.length === Object.keys(a).length &&
    keys.every((k) => a[k]?.scrollTop === b[k]!.scrollTop && a[k]?.height === b[k]!.height)
  );
}

/**
 * Measures which explorer rows are on screen (M04).
 *
 * `bodyRef` goes on the scroller, and each section's row list carries
 * `data-section-rows`. `views` is null until measured, so the first paint
 * shows the first rows of each section. A row a key press moved to that is not
 * painted yet is handed to `focusOncePainted` and focused after the render
 * that paints it.
 */
export function useExplorerWindow(listRef: React.RefObject<HTMLElement | null>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<Record<string, ExplorerViewport> | null>(null);
  const pendingFocus = useRef<string | null>(null);

  // Re-measured after every render (a filter, a fold or new files move the
  // rows), and on scroll and resize; it sets state only when the view changed.
  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const next = measureViews(body);
    setViews((current) => (sameViews(current, next) ? current : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const key = pendingFocus.current;
    const row = key ? findRow(listRef.current, key) : null;
    if (row) {
      pendingFocus.current = null;
      row.focus();
    }
  });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    // Scroll does not bubble; a capturing listener also hears a section list
    // that scrolls on its own.
    body.addEventListener("scroll", measure, { capture: true, passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(body);
    return () => {
      body.removeEventListener("scroll", measure, { capture: true });
      resize.disconnect();
    };
  }, [measure]);

  const focusOncePainted = useCallback((key: string) => {
    pendingFocus.current = key;
  }, []);

  return { bodyRef, views, focusOncePainted };
}
